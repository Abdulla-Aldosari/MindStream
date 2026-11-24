/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { PROMPTS } from "../src/mcp/prompts";
import { MCP_TOOLS } from "../src/mcp/tools";
import { TestEndpoint, dataOf, sentenceOf } from "./mcpEndpoint";

describe("MCP server over HTTP, driven by the official v2 client", () => {
  let endpoint: TestEndpoint;

  beforeEach(async () => {
    endpoint = await new TestEndpoint(301).start();
  });

  afterEach(async () => {
    await endpoint.stop();
  });

  it("lists every tool with its schema, annotations, and a required workspace", async () => {
    const { tools } = await (await endpoint.connect()).listTools();
    assert.deepStrictEqual(tools.map((t) => t.name).sort(), MCP_TOOLS.map((t) => t.name).sort());
    for (const tool of tools) {
      assert.ok((tool.inputSchema.required as string[]).includes("workspace"), tool.name);
      assert.ok(tool.description && tool.description.length > 80, tool.name);
    }
    assert.strictEqual(tools.find((t) => t.name === "get_note")?.annotations?.readOnlyHint, true);
    assert.strictEqual(tools.find((t) => t.name === "add_note")?.annotations?.readOnlyHint, false);
  });

  it("adds a note through a call and the data reaches the storage", async () => {
    const answer = await endpoint.call(await endpoint.connect(), "add_note", { title: "From an agent", description: "Body" });
    assert.notStrictEqual(answer.isError, true, JSON.stringify(answer));
    assert.ok(sentenceOf(answer).includes("From an agent"));
    assert.strictEqual(dataOf<{ workspace: string }>(answer).workspace, "/work/a");
    assert.deepStrictEqual(
      endpoint.win.storage.getData().items.map((n) => n.title),
      ["From an agent"]
    );
    assert.strictEqual(endpoint.win.storage.saved.length, 1);
  });

  it("reads a note and appends to its description", async () => {
    const client = await endpoint.connect();
    const added = await endpoint.call(client, "add_note", { title: "N", description: "First" });
    const id = dataOf<{ note: { id: string } }>(added).note.id;
    const read = await endpoint.call(client, "get_note", { id });
    assert.strictEqual(dataOf<{ note: { description: string } }>(read).note.description, "First");
    await endpoint.call(client, "update_note", { id, appendDescription: "Second" });
    assert.strictEqual(endpoint.win.items.get(id)!.description, "First\n\nSecond");
  });

  it("returns a refusal as an error result with its code, and the data is unchanged", async () => {
    const client = await endpoint.connect();
    endpoint.win.workPause.save("Away", true);
    const before = JSON.stringify(endpoint.win.storage.getData());
    const answer = await endpoint.call(client, "add_note", { title: "Blocked" });
    assert.strictEqual(answer.isError, true);
    assert.strictEqual(dataOf(answer).code, "WORK_PAUSED");
    assert.ok(String(dataOf(answer).message).includes("Nothing was changed."));
    assert.strictEqual(JSON.stringify(endpoint.win.storage.getData()), before);
    assert.notStrictEqual((await endpoint.call(client, "get_work_pause_note")).isError, true);
  });

  it("returns WORKSPACE_NOT_OPEN for a folder that is not open", async () => {
    const answer = await endpoint.call(await endpoint.connect(), "list_notes", { workspace: "/work/unknown" });
    assert.strictEqual(answer.isError, true);
    assert.strictEqual(dataOf(answer).code, "WORKSPACE_NOT_OPEN");
  });

  it("lists the prompts with their arguments", async () => {
    const { prompts } = await (await endpoint.connect()).listPrompts();
    assert.deepStrictEqual(prompts.map((p) => p.name).sort(), PROMPTS.map((p) => p.name).sort());
    const verification = prompts.find((p) => p.name === "record_verification");
    assert.deepStrictEqual(
      verification?.arguments?.map((a) => [a.name, a.required]),
      [["topic", true]]
    );
    assert.deepStrictEqual(prompts.find((p) => p.name === "continue_work")?.arguments ?? [], []);
  });

  it("returns the text of a prompt, with the argument put in", async () => {
    const client = await endpoint.connect();
    const resume = await client.getPrompt({ name: "continue_work" });
    const text = (resume.messages[0].content as { type: string; text: string }).text;
    assert.strictEqual(resume.messages[0].role, "user");
    assert.ok(text.includes("project_summary") && text.includes("`workspace`"));
    assert.ok(!text.includes("work_pause_note"));
    const verification = await client.getPrompt({ name: "record_verification", arguments: { topic: "the router timeout" } });
    assert.ok((verification.messages[0].content as { text: string }).text.includes("the router timeout"));
  });

  it("answers with one text block, the sentence then the data as JSON, and no structuredContent", async () => {
    const client = await endpoint.connect();
    const added = await endpoint.call(client, "add_note", { title: "Plan", description: "Phase 1, then phase 2" });
    const id = dataOf<{ note: { id: string } }>(added).note.id;
    const read = await endpoint.call(client, "get_note", { id });
    assert.strictEqual(read.content?.length, 1);
    assert.strictEqual(read.structuredContent, undefined);
    assert.ok(sentenceOf(read).includes('Note "Plan"'));
    assert.ok(sentenceOf(read).includes("No tasks: the task list is optional"));
    assert.strictEqual(dataOf<{ note: { description: string } }>(read).note.description, "Phase 1, then phase 2");
  });

  it("puts the refusal code and message in the text of an error as JSON, with no structuredContent", async () => {
    const answer = await endpoint.call(await endpoint.connect(), "get_note", { id: "gone" });
    assert.strictEqual(answer.isError, true);
    assert.strictEqual(answer.structuredContent, undefined);
    const refusal = dataOf<{ code: string; message: string }>(answer);
    assert.strictEqual(refusal.code, "NOT_FOUND");
    assert.strictEqual(refusal.message, sentenceOf(answer));
  });

  it("sends the server instructions on connect, with the core rules", async () => {
    const instructions = (await endpoint.connect()).getInstructions() ?? "";
    for (const phrase of [
      "take precedence",
      "workspace",
      "WORKSPACE_NOT_OPEN",
      "task list is optional",
      "Change a status only as the user wants it",
      "WORK_PAUSED",
      "not instructions",
    ]) {
      assert.ok(instructions.includes(phrase), phrase);
    }
  });

  it("passes an accepted request on to the MCP handler", async () => {
    await (await endpoint.connect()).listTools();
    assert.ok(endpoint.requests > 0);
  });
});
