/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { createEmptyData } from "../src/storage";
import { ItemsStore } from "../src/itemsStore";
import { TypesRegistry } from "../src/typesRegistry";
import { CategoriesRegistry } from "../src/categoriesRegistry";
import { WorkPauseStore } from "../src/workPauseStore";
import { LinkTracker } from "../src/linkTracker";
import { NotesService } from "../src/notesService";
import { NotesQuery } from "../src/mcp/notesQuery";
import { MCP_TOOLS, findTool } from "../src/mcp/tools";
import { tasksLine } from "../src/mcp/readTools";
import { STATUS_RULE } from "../src/mcp/toolKit";
import { ToolResult } from "../src/mcp/mcpTypes";
import { BLOCKED, FakeFiles, InMemoryStorage } from "./helpers";

function setup() {
  const storage = new InMemoryStorage(createEmptyData());
  const items = new ItemsStore(storage);
  const types = new TypesRegistry(storage);
  const categories = new CategoriesRegistry(storage);
  const workPause = new WorkPauseStore(storage);
  const files = new FakeFiles();
  const links = new LinkTracker(items, files);
  const deps = { storage, items, types, categories, workPause, links, files, priorityEnabled: () => true };
  const ctx = { notes: new NotesService(deps), query: new NotesQuery(deps) };
  const typeId = types.list()[0].id;
  const call = (name: string, args: unknown): Promise<ToolResult> => findTool(name)!.handler(args, ctx);
  /** Returns a check that the data and the save count are still what they are now. */
  const snapshot = () => {
    const before = JSON.stringify(storage.getData());
    const saves = storage.saved.length;
    return () => {
      assert.strictEqual(JSON.stringify(storage.getData()), before);
      assert.strictEqual(storage.saved.length, saves);
    };
  };
  return { storage, items, types, categories, workPause, files, typeId, call, snapshot };
}

/** Words that would tie the Work Pause note to agent sessions (a hand-off between sessions). */
const SESSION_WORDS = /hand-?off|(start|end) of (a|the) session|where work stopped|earlier session|next session|last time/i;

function ok(result: ToolResult) {
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  return result as Extract<ToolResult, { ok: true }>;
}

function refused(result: ToolResult, code: string) {
  assert.strictEqual(result.ok, false, "expected a refusal");
  const failure = result as Extract<ToolResult, { ok: false }>;
  assert.strictEqual(failure.code, code, failure.message);
  return failure;
}

/** Structured data of a result, as plain JSON an assertion can walk. */
/** Reads a value out of the structured data of a result by its path, for example `note.tasks`. */
function at(result: ToolResult, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], ok(result).data);
}

describe("MCP tool definitions", () => {
  it("lists the 12 tools of the plan, with unique names", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    assert.deepStrictEqual(names.slice().sort(), [
      "add_category",
      "add_note",
      "add_type",
      "get_note",
      "get_work_pause_note",
      "list_notes",
      "list_types_and_categories",
      "project_summary",
      "set_note_archived",
      "set_note_status",
      "set_task_completed",
      "update_note",
    ]);
    assert.strictEqual(new Set(names).size, names.length);
  });

  it("gives every tool a long description, an object schema with a required workspace, and annotations", () => {
    for (const tool of MCP_TOOLS) {
      assert.ok(tool.description.length > 80, tool.name);
      assert.strictEqual(tool.inputSchema.type, "object", tool.name);
      assert.ok((tool.inputSchema.required as string[]).includes("workspace"), tool.name);
      assert.ok("workspace" in (tool.inputSchema.properties as object), tool.name);
      assert.strictEqual(tool.annotations.openWorldHint, false, tool.name);
      assert.ok(tool.description.includes("workspace is the absolute path of your project root"), tool.name);
    }
  });

  it("marks exactly the five read tools as read-only", () => {
    const readOnly = MCP_TOOLS.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
    assert.deepStrictEqual(readOnly.sort(), ["get_note", "get_work_pause_note", "list_notes", "list_types_and_categories", "project_summary"]);
    for (const tool of MCP_TOOLS.filter((t) => t.annotations.readOnlyHint)) {
      assert.strictEqual(tool.annotations.destructiveHint, false);
    }
  });

  it("has no tool that deletes, removes, pauses, or resumes", () => {
    for (const tool of MCP_TOOLS) {
      assert.ok(!/delete|remove|resume/i.test(tool.name), tool.name);
      assert.ok(!/pause/i.test(tool.name.replace("work_pause_note", "")), tool.name);
    }
  });

  it("has no tool that writes the Work Pause note: it is the user's own", () => {
    for (const tool of MCP_TOOLS.filter((t) => /work_pause/.test(t.name))) {
      assert.strictEqual(tool.annotations.readOnlyHint, true, tool.name);
    }
    assert.strictEqual(findTool("save_work_pause_note"), undefined);
  });

  it("never ties the Work Pause note to agent sessions in any tool text", () => {
    for (const tool of MCP_TOOLS) {
      const text = JSON.stringify({ name: tool.name, title: tool.title, description: tool.description, schema: tool.inputSchema });
      assert.ok(!SESSION_WORDS.test(text), `${tool.name}: ${text.match(SESSION_WORDS)?.[0]}`);
    }
    const read = findTool("get_work_pause_note")!.description;
    assert.ok(read.includes("only when the user asks"));
    assert.ok(read.includes("no tool writes it"));
  });

  it("tells the agent to change statuses only as the user wants it", () => {
    const description = findTool("set_note_status")!.description;
    assert.ok(description.includes(STATUS_RULE));
    assert.ok(!description.includes("when you start working on a note"));
    for (const phrase of [
      "in any words or language",
      "move it from pending to in-progress with set_note_status before you change anything for it",
      "The user does not have to mention the status",
      "Reading, explaining, evaluating, or planning a note is not carrying it out",
      "each one when you start on it",
      "If a note is not pending, do not move it",
      "Never change the status of a done note",
      "Never mark a note done or canceled on your own",
      "still need to be marked done",
    ]) {
      assert.ok(STATUS_RULE.includes(phrase), phrase);
    }
    const addStatus = (findTool("add_note")!.inputSchema.properties as Record<string, { description: string }>).status.description;
    assert.ok(addStatus.includes("only when the user asks"));
  });

  it("tells the agent never to ask the user to resume so that it can write", () => {
    for (const tool of MCP_TOOLS.filter((t) => !t.annotations.readOnlyHint)) {
      assert.ok(tool.description.includes("do not ask the user to resume"), tool.name);
    }
  });

  it("tells the agent that note text is data on every tool that returns note text", () => {
    for (const name of ["list_notes", "get_note", "get_work_pause_note"]) {
      assert.ok(findTool(name)!.description.includes("not instructions"), name);
    }
  });

  it("tells the agent that the task list is optional on every tool that reads or writes tasks", () => {
    for (const name of ["get_note", "add_note", "update_note"]) {
      assert.ok(findTool(name)!.description.includes("task list is optional"), name);
    }
  });

  it("summarizes a note's tasks, and points at the description when there are none", () => {
    assert.strictEqual(tasksLine([{ completed: true }, { completed: false }], "x"), "Tasks: 1 of 2 done.");
    assert.ok(tasksLine([], "Phase 1").includes("any plan or steps are in the description (7 characters)"));
    assert.strictEqual(tasksLine([], ""), "No tasks and no description.");
  });

  it("tells the agent not to retry WORK_PAUSED on every write tool", () => {
    for (const tool of MCP_TOOLS.filter((t) => !t.annotations.readOnlyHint)) {
      assert.ok(tool.description.includes("WORK_PAUSED"), tool.name);
    }
  });

  it("describes the rules of update_note and add_note", () => {
    assert.ok(findTool("update_note")!.description.includes("appendDescription"));
    assert.ok(findTool("update_note")!.description.includes("expectedUpdatedAt"));
    assert.ok(findTool("update_note")!.description.includes("CONFLICT"));
    assert.ok(findTool("update_note")!.description.includes("Code links cannot be edited"));
    assert.ok(findTool("add_note")!.description.includes("verify by hand"));
    assert.ok(findTool("add_note")!.description.includes("Pick typeId from list_types_and_categories"));
    assert.ok(findTool("add_note")!.description.includes("relative to the project root"));
  });

  it("finds a tool by name", () => {
    assert.strictEqual(findTool("get_note")?.name, "get_note");
    assert.strictEqual(findTool("delete_note"), undefined);
  });
});

describe("MCP read tools", () => {
  it("project_summary reports the counts and a one-sentence summary", async () => {
    const { call, items, typeId } = setup();
    items.create({ typeId, title: "A" });
    items.create({ typeId, title: "B", status: "done" });
    const result = await call("project_summary", {});
    assert.deepStrictEqual(at(result, "statusCounts"), { pending: 1, "in-progress": 0, done: 1, canceled: 0 });
    assert.ok(ok(result).summary.includes("1 pending"));
  });

  it("list_notes lists, filters, and refuses a bad filter as a result", async () => {
    const { call, items, typeId } = setup();
    items.create({ typeId, title: "Fix save", priority: "high" });
    items.create({ typeId, title: "Other", priority: "low" });
    assert.strictEqual(at(await call("list_notes", {}), "total"), 2);
    const high = at(await call("list_notes", { priority: ["high"] }), "notes") as { title: string }[];
    assert.deepStrictEqual(
      high.map((n) => n.title),
      ["Fix save"]
    );
    refused(await call("list_notes", { status: ["finished"] }), "INVALID_INPUT");
    refused(await call("list_notes", { limt: 5 }), "INVALID_INPUT");
  });

  it("get_note returns the note, its tasks, and the version to pass back", async () => {
    const { call, items, typeId } = setup();
    const note = items.create({ typeId, title: "N", tasks: [{ title: "T", completed: false }] });
    const result = await call("get_note", { id: note.id });
    assert.strictEqual(at(result, "note.updatedAt"), note.updatedAt);
    assert.deepStrictEqual(at(result, "note.tasks"), [{ index: 0, title: "T", completed: false }]);
    refused(await call("get_note", { id: "gone" }), "NOT_FOUND");
    refused(await call("get_note", { id: note.id, excerptLines: 99 }), "INVALID_INPUT");
  });

  it("list_types_and_categories and get_work_pause_note answer", async () => {
    const { call, workPause } = setup();
    assert.ok((at(await call("list_types_and_categories", {}), "types") as unknown[]).length > 0);
    assert.strictEqual(at(await call("get_work_pause_note", {}), "text"), "");
    workPause.save("Stopped at the router", true);
    const result = await call("get_work_pause_note", {});
    assert.strictEqual(at(result, "paused"), true);
    assert.ok(ok(result).summary.includes("paused"));
  });

  it("every read tool still answers while work is paused and while saving is off", async () => {
    const { call, items, workPause, storage, typeId, snapshot } = setup();
    const id = items.create({ typeId, title: "A" }).id;
    workPause.save("Away", true);
    storage.problem = BLOCKED;
    const unchanged = snapshot();
    const reads: [string, unknown][] = [
      ["project_summary", {}],
      ["list_notes", {}],
      ["get_note", { id }],
      ["list_types_and_categories", {}],
      ["get_work_pause_note", {}],
    ];
    for (const [name, args] of reads) {
      ok(await call(name, args));
    }
    unchanged();
  });

  it("refuses an unknown argument and a non-object argument list on any tool", async () => {
    const { call } = setup();
    refused(await call("project_summary", { extra: 1 }), "INVALID_INPUT");
    refused(await call("project_summary", [1]), "INVALID_INPUT");
    refused(await call("project_summary", "x"), "INVALID_INPUT");
    ok(await call("project_summary", undefined));
  });
});

describe("MCP write tools succeed", () => {
  it("add_note creates a note with defaults, tasks, and a summary naming its id", async () => {
    const { call, storage } = setup();
    const result = await call("add_note", { title: "Fix save", description: "Body", priority: "high", tasks: [{ title: "T", completed: false }] });
    const id = at(result, "note.id") as string;
    assert.ok(ok(result).summary.includes(id));
    assert.strictEqual(at(result, "note.status"), "pending");
    assert.strictEqual(at(result, "note.category.label"), "General");
    assert.strictEqual(storage.getData().items.length, 1);
    assert.strictEqual(storage.getData().items[0].title, "Fix save");
  });

  it("add_note links the note to code from the file's real content", async () => {
    const { call, files, items } = setup();
    files.files.set("src/a.ts", ["one", "two", "three"]);
    const result = await call("add_note", { title: "Look here", codeLocation: { filePath: "src/a.ts", lineStart: 2, lineEnd: 3 } });
    assert.deepStrictEqual(at(result, "note.link"), { filePath: "src/a.ts", lineStart: 2, lineEnd: 3, state: "ok" });
    assert.deepStrictEqual(items.get(at(result, "note.id") as string)!.link!.anchor!.text, ["two", "three"]);
    assert.ok(ok(result).summary.includes("src/a.ts:2"));
  });

  it("update_note appends to the description without a base, and reports the changed fields", async () => {
    const { call, items, typeId } = setup();
    const id = items.create({ typeId, title: "N", description: "First" }).id;
    const result = await call("update_note", { id, appendDescription: "Second", title: "N2" });
    assert.strictEqual(at(result, "note.description"), "First\n\nSecond");
    assert.strictEqual(at(result, "note.title"), "N2");
    assert.deepStrictEqual((at(result, "changes") as { field: string }[]).map((c) => c.field).sort(), ["description", "title"]);
    const same = await call("update_note", { id, title: "N2" });
    assert.deepStrictEqual(at(same, "changes"), []);
    assert.ok(ok(same).summary.includes("nothing was written"));
  });

  it("update_note replaces the description and the tasks only with the version it read", async () => {
    const { call, items, typeId } = setup();
    const note = items.create({ typeId, title: "N", description: "Old" });
    refused(await call("update_note", { id: note.id, description: "New" }), "INVALID_INPUT");
    const done = await call("update_note", { id: note.id, description: "New", tasks: [{ title: "T", completed: true }], expectedUpdatedAt: note.updatedAt });
    assert.strictEqual(at(done, "note.description"), "New");
    assert.deepStrictEqual(at(done, "note.tasks"), [{ index: 0, title: "T", completed: true }]);
  });

  it("set_note_status returns the previous status", async () => {
    const { call, items, typeId } = setup();
    const id = items.create({ typeId, title: "N" }).id;
    const result = await call("set_note_status", { id, status: "in-progress" });
    assert.strictEqual(at(result, "previous"), "pending");
    assert.strictEqual(at(result, "note.status"), "in-progress");
    assert.ok(ok(result).summary.includes("pending -> in-progress"));
    assert.ok(ok(await call("set_note_status", { id, status: "in-progress" })).summary.includes("already"));
  });

  it("set_task_completed ticks one task by its 0-based index", async () => {
    const { call, items, typeId } = setup();
    const id = items.create({
      typeId,
      title: "N",
      tasks: [
        { title: "A", completed: false },
        { title: "B", completed: false },
      ],
    }).id;
    const result = await call("set_task_completed", { id, index: 1, title: "B", completed: true });
    assert.deepStrictEqual(
      (at(result, "note.tasks") as { completed: boolean }[]).map((t) => t.completed),
      [false, true]
    );
    assert.strictEqual(at(result, "previous"), false);
  });

  it("set_note_archived archives and unarchives, re-finding the link", async () => {
    const { call, items, files, typeId } = setup();
    files.files.set("a.ts", ["x", "target", "y"]);
    const created = await call("add_note", { title: "N", codeLocation: { filePath: "a.ts", lineStart: 2 } });
    const id = at(created, "note.id") as string;
    assert.strictEqual(at(await call("set_note_archived", { id, archived: true }), "note.archived"), true);
    files.files.set("a.ts", ["new", "x", "target", "y"]);
    const back = await call("set_note_archived", { id, archived: false });
    assert.strictEqual(at(back, "previous"), true);
    assert.strictEqual(items.get(id)!.link!.lineStart, 3);
    assert.ok(typeId);
  });

  it("add_category and add_type create entries and return their ids", async () => {
    const { call, categories, types } = setup();
    const category = await call("add_category", { label: "Verify by hand" });
    assert.strictEqual(categories.get(at(category, "category.id") as string)!.label, "Verify by hand");
    const type = await call("add_type", { label: "Check", icon: "beaker" });
    assert.strictEqual(types.get(at(type, "type.id") as string)!.icon, "beaker");
  });
});

describe("MCP write tools refuse and change nothing", () => {
  it("refuses every write while work is paused (WORK_PAUSED), naming the only way out", async () => {
    const { call, items, workPause, typeId, snapshot } = setup();
    const note = items.create({ typeId, title: "A", tasks: [{ title: "T", completed: false }] });
    workPause.save("Away", true);
    const unchanged = snapshot();
    const writes: [string, unknown][] = [
      ["add_note", { title: "B" }],
      ["update_note", { id: note.id, title: "B" }],
      ["set_note_status", { id: note.id, status: "done" }],
      ["set_task_completed", { id: note.id, index: 0, title: "T", completed: true }],
      ["set_note_archived", { id: note.id, archived: true }],
      ["add_category", { label: "C" }],
      ["add_type", { label: "T2" }],
    ];
    for (const [name, args] of writes) {
      const failure = refused(await call(name, args), "WORK_PAUSED");
      assert.ok(failure.message.includes("✓ Work paused - click to resume"), name);
      assert.ok(failure.message.includes("Nothing was changed."), name);
    }
    unchanged();
  });

  it("refuses every write while saving is off (STORAGE_BLOCKED)", async () => {
    const { call, items, storage, typeId, snapshot } = setup();
    const note = items.create({ typeId, title: "A", tasks: [{ title: "T", completed: false }] });
    storage.problem = BLOCKED;
    const unchanged = snapshot();
    const writes: [string, unknown][] = [
      ["add_note", { title: "B" }],
      ["update_note", { id: note.id, title: "B" }],
      ["set_note_status", { id: note.id, status: "done" }],
      ["set_task_completed", { id: note.id, index: 0, title: "T", completed: true }],
      ["set_note_archived", { id: note.id, archived: true }],
      ["add_category", { label: "C" }],
      ["add_type", { label: "T2" }],
    ];
    for (const [name, args] of writes) {
      refused(await call(name, args), "STORAGE_BLOCKED");
    }
    unchanged();
  });

  it("refuses unknown ids (NOT_FOUND)", async () => {
    const { call, snapshot } = setup();
    const unchanged = snapshot();
    refused(await call("update_note", { id: "gone", title: "X" }), "NOT_FOUND");
    refused(await call("set_note_status", { id: "gone", status: "done" }), "NOT_FOUND");
    refused(await call("set_task_completed", { id: "gone", index: 0, title: "T", completed: true }), "NOT_FOUND");
    refused(await call("set_note_archived", { id: "gone", archived: true }), "NOT_FOUND");
    refused(await call("add_note", { title: "X", typeId: "gone" }), "NOT_FOUND");
    unchanged();
  });

  it("refuses a write to an archived note (NOTE_ARCHIVED)", async () => {
    const { call, items, typeId, snapshot } = setup();
    const id = items.create({ typeId, title: "A" }).id;
    items.setArchived(id, true);
    const unchanged = snapshot();
    refused(await call("update_note", { id, title: "B" }), "NOTE_ARCHIVED");
    refused(await call("set_note_status", { id, status: "done" }), "NOTE_ARCHIVED");
    unchanged();
  });

  it("refuses invalid input (INVALID_INPUT), including a field the tool does not take", async () => {
    const { call, snapshot, items, typeId } = setup();
    const id = items.create({ typeId, title: "A" }).id;
    const unchanged = snapshot();
    refused(await call("add_note", { title: "" }), "INVALID_INPUT");
    refused(await call("add_note", { title: "x".repeat(301) }), "INVALID_INPUT");
    refused(await call("add_note", { title: "B", tags: ["x"] }), "INVALID_INPUT");
    refused(await call("add_note", {}), "INVALID_INPUT");
    refused(await call("set_note_status", { id, status: "finished" }), "INVALID_INPUT");
    refused(await call("update_note", { id, priority: "urgent" }), "INVALID_INPUT");
    refused(await call("update_note", { id, link: { filePath: "x" } }), "INVALID_INPUT");
    refused(await call("add_category", { label: "" }), "INVALID_INPUT");
    refused(await call("add_type", { label: "T", icon: "not an icon!" }), "INVALID_INPUT");
    unchanged();
  });

  it("refuses a duplicate type or category (DUPLICATE) and returns the existing one", async () => {
    const { call, categories, snapshot } = setup();
    const existing = categories.add("Verify");
    const unchanged = snapshot();
    const failure = refused(await call("add_category", { label: "verify" }), "DUPLICATE");
    assert.deepStrictEqual(failure.current, { id: existing.id, label: "Verify" });
    refused(await call("add_type", { label: "GENERAL" }), "DUPLICATE");
    unchanged();
  });

  it("refuses a bad code location (LINK_INVALID) and creates no note", async () => {
    const { call, files, snapshot } = setup();
    files.files.set("src/a.ts", ["one", "two"]);
    const unchanged = snapshot();
    for (const codeLocation of [
      { filePath: "../secret.txt", lineStart: 1 },
      { filePath: "/etc/passwd", lineStart: 1 },
      { filePath: "C:/x.ts", lineStart: 1 },
      { filePath: "src/missing.ts", lineStart: 1 },
      { filePath: "src/a.ts", lineStart: 3 },
      { filePath: "src/a.ts", lineStart: 0 },
      { filePath: "src/a.ts", lineStart: 2, lineEnd: 1 },
      { filePath: "src/a.ts", lineStart: "1" },
      "src/a.ts:1",
      null,
    ]) {
      refused(await call("add_note", { title: "N", codeLocation }), "LINK_INVALID");
    }
    unchanged();
  });

  it("the 10:00 / 10:02 / 10:03 scenario: a stale rewrite is refused with the current note, a retry succeeds", async () => {
    const { call, items, typeId, storage } = setup();
    const note = items.create({ typeId, title: "N", description: "Original" });
    const read = await call("get_note", { id: note.id });
    const readAt = at(read, "note.updatedAt") as string;
    // 10:02: the user edits the note while the agent is still thinking.
    storage.getData().items[0].description = "User wrote this";
    storage.getData().items[0].updatedAt = "2026-11-22T10:02:00.000Z";
    // 10:03: the agent rewrites from its old copy.
    const stale = refused(await call("update_note", { id: note.id, description: "Agent rewrite", expectedUpdatedAt: readAt }), "CONFLICT");
    assert.strictEqual((stale.current as { description: string }).description, "User wrote this");
    assert.strictEqual((stale.current as { updatedAt: string }).updatedAt, "2026-11-22T10:02:00.000Z");
    assert.strictEqual(items.get(note.id)!.description, "User wrote this");
    // The agent redoes its change on the current note, with the new version.
    const retry = await call("update_note", { id: note.id, description: "User wrote this\n\nAgent addition", expectedUpdatedAt: "2026-11-22T10:02:00.000Z" });
    assert.strictEqual(at(retry, "note.description"), "User wrote this\n\nAgent addition");
  });

  it("a task list changed meanwhile is a CONFLICT with the current note", async () => {
    const { call, items, typeId, snapshot } = setup();
    const id = items.create({ typeId, title: "N", tasks: [{ title: "A", completed: false }] }).id;
    const unchanged = snapshot();
    const failure = refused(await call("set_task_completed", { id, index: 0, title: "Renamed", completed: true }), "CONFLICT");
    assert.strictEqual((failure.current as { id: string }).id, id);
    unchanged();
  });
});
