/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { TestWindow, at, makeRegistryDir, refused } from "./mcpWindow";

const titles = (w: TestWindow) => w.storage.getData().items.map((n) => n.title);

describe("workspace router: routing among three windows in one process", () => {
  let registry: ReturnType<typeof makeRegistryDir>;
  let alive: Set<number>;
  let a: TestWindow;
  let b: TestWindow;
  let c: TestWindow;

  beforeEach(async () => {
    registry = makeRegistryDir();
    alive = new Set();
    a = await new TestWindow("/work/a", 101, registry.dir, alive).open();
    b = await new TestWindow("/work/b", 102, registry.dir, alive).open();
    c = await new TestWindow("/work/c", 103, registry.dir, alive).open();
  });

  afterEach(async () => {
    await Promise.all([a, b, c].map((w) => w.close()));
    registry.remove();
  });

  it("runs a call for its own folder locally and reports the folder it served", async () => {
    const result = await a.dispatcher()("add_note", { workspace: "/work/a", title: "Local" });
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(at(result, "workspace"), "/work/a");
    assert.deepStrictEqual(titles(a), ["Local"]);
    assert.strictEqual(b.storage.getData().items.length, 0);
  });

  it("forwards a call for another window's folder and writes only that window's storage", async () => {
    const result = await a.dispatcher()("add_note", { workspace: "/work/b", title: "For B" });
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(at(result, "workspace"), "/work/b");
    assert.deepStrictEqual(titles(b), ["For B"]);
    assert.strictEqual(a.storage.getData().items.length, 0);
    assert.strictEqual(c.storage.getData().items.length, 0);
  });

  it("never writes another window's storage from the router window", async () => {
    await a.dispatcher()("add_note", { workspace: "/work/b", title: "One" });
    await a.dispatcher()("add_note", { workspace: "/work/c", title: "Two" });
    assert.strictEqual(a.storage.saved.length, 0);
    assert.strictEqual(b.storage.saved.length, 1);
    assert.strictEqual(c.storage.saved.length, 1);
  });

  it("serves a subfolder of an open folder and picks the longest folder among nested ones", async () => {
    const nested = await new TestWindow("/work/a/packages/app", 104, registry.dir, alive).open();
    try {
      await a.dispatcher()("add_note", { workspace: "/work/a/packages/app/src", title: "Deep" });
      assert.deepStrictEqual(titles(nested), ["Deep"]);
      await a.dispatcher()("add_note", { workspace: "/work/a/docs", title: "Shallow" });
      assert.deepStrictEqual(titles(a), ["Shallow"]);
    } finally {
      await nested.close();
    }
  });

  it("finds a window that opened after the registry was cached", async () => {
    const dispatch = a.dispatcher();
    await dispatch("list_notes", { workspace: "/work/a" });
    const late = await new TestWindow("/work/late", 105, registry.dir, alive).open();
    try {
      const result = await dispatch("add_note", { workspace: "/work/late", title: "Late" });
      assert.strictEqual(result.ok, true, JSON.stringify(result));
      assert.strictEqual(late.storage.getData().items.length, 1);
    } finally {
      await late.close();
    }
  });

  it("answers WORKSPACE_NOT_OPEN with the open folders when no window serves the folder", async () => {
    const failure = refused(await a.dispatcher()("list_notes", { workspace: "/work/elsewhere" }), "WORKSPACE_NOT_OPEN");
    for (const folder of ["/work/a", "/work/b", "/work/c"]) {
      assert.ok(failure.message.includes(folder), folder);
    }
    assert.ok(failure.message.includes("Nothing was changed."));
    assert.ok(failure.message.includes("Open it in VS Code"));
  });

  it("never matches a folder that only shares a prefix", async () => {
    refused(await a.dispatcher()("list_notes", { workspace: "/work/a-other" }), "WORKSPACE_NOT_OPEN");
    refused(await a.dispatcher()("list_notes", { workspace: "/work" }), "WORKSPACE_NOT_OPEN");
  });

  it("refuses a missing or relative workspace and an unknown tool as INVALID_INPUT", async () => {
    const dispatch = a.dispatcher();
    refused(await dispatch("list_notes", {}), "INVALID_INPUT");
    refused(await dispatch("list_notes", { workspace: "work/a" }), "INVALID_INPUT");
    refused(await dispatch("list_notes", { workspace: 7 }), "INVALID_INPUT");
    refused(await dispatch("list_notes", undefined), "INVALID_INPUT");
    refused(await dispatch("delete_note", { workspace: "/work/a" }), "INVALID_INPUT");
  });

  it("refuses a write of the Work Pause note (no such tool) and leaves the user's note unchanged", async () => {
    a.workPause.save("Away for a month: finish the router tests first.");
    const before = JSON.stringify(a.storage.getData());
    const saves = a.storage.saved.length;
    refused(await a.dispatcher()("save_work_pause_note", { workspace: "/work/a", text: "Agent text" }), "INVALID_INPUT");
    assert.strictEqual(JSON.stringify(a.storage.getData()), before);
    assert.strictEqual(a.storage.saved.length, saves);
  });

  it("returns a refusal of the other window unchanged: WORK_PAUSED", async () => {
    b.workPause.save("Away", true);
    const failure = refused(await a.dispatcher()("add_note", { workspace: "/work/b", title: "Blocked" }), "WORK_PAUSED");
    assert.ok(failure.message.includes("✓ Work paused - click to resume"));
    assert.strictEqual(b.storage.getData().items.length, 0);
  });

  it("returns a CONFLICT of the other window with its current note", async () => {
    const note = b.items.create({ typeId: b.typeId, title: "N", description: "Old" });
    const stale = { workspace: "/work/b", id: note.id, description: "New", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" };
    const failure = refused(await a.dispatcher()("update_note", stale), "CONFLICT");
    assert.strictEqual((failure.current as { id: string }).id, note.id);
  });
});
