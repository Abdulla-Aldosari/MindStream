/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { PROTOCOL_VERSION } from "../src/mcp/routerRegistry";
import { TestWindow, makeRegistryDir, refused } from "./mcpWindow";

describe("workspace router: a window that is gone, silent, or of another version", () => {
  let registry: ReturnType<typeof makeRegistryDir>;
  let a: TestWindow;
  let b: TestWindow;

  beforeEach(async () => {
    registry = makeRegistryDir();
    const alive = new Set<number>();
    a = await new TestWindow("/work/a", 101, registry.dir, alive).open();
    b = await new TestWindow("/work/b", 102, registry.dir, alive).open();
  });

  afterEach(async () => {
    await Promise.all([a.close(), b.close()]);
    registry.remove();
  });

  it("drops the entry of a window that is gone and answers WORKSPACE_NOT_OPEN: nothing ran", async () => {
    await b.crash();
    const failure = refused(await a.dispatcher()("add_note", { workspace: "/work/b", title: "Lost" }), "WORKSPACE_NOT_OPEN");
    assert.ok(failure.message.includes("Nothing was changed."));
    assert.strictEqual(b.storage.getData().items.length, 0);
    assert.strictEqual(fs.existsSync(path.join(registry.dir, "window-102.json")), false);
    assert.ok(failure.message.includes("Open folders: /work/a."));
  });

  it("answers WORKSPACE_NOT_RESPONDING when a window does not answer in time, saying it may have run", async () => {
    const silent = http.createServer(() => {
      /* never answers */
    });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    await b.inner.stop();
    b.registry.register("/work/b", (silent.address() as { port: number }).port);
    try {
      const failure = refused(await a.dispatcher(150)("add_note", { workspace: "/work/b", title: "Slow" }), "WORKSPACE_NOT_RESPONDING");
      assert.ok(failure.message.includes("may or may not have been applied"));
      assert.ok(failure.message.includes("read the note again"));
    } finally {
      silent.closeAllConnections();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });

  it("keeps the entry of a live window whose connection is reset, and says the call may have run", async () => {
    const resetting = http.createServer((req) => req.socket.destroy());
    await new Promise<void>((resolve) => resetting.listen(0, "127.0.0.1", resolve));
    await b.inner.stop();
    b.registry.register("/work/b", (resetting.address() as { port: number }).port);
    try {
      const failure = refused(await a.dispatcher()("add_note", { workspace: "/work/b", title: "Reset" }), "WORKSPACE_NOT_RESPONDING");
      assert.ok(failure.message.includes("may or may not have been applied"));
      assert.strictEqual(failure.message.includes("Nothing was changed."), false);
      assert.strictEqual(fs.existsSync(path.join(registry.dir, "window-102.json")), true);
    } finally {
      await new Promise<void>((resolve) => resetting.close(() => resolve()));
    }
  });

  it("answers WORKSPACE_NOT_RESPONDING for a window of another protocol version, without calling it", async () => {
    const entry = { protocol: PROTOCOL_VERSION + 1, folder: "/work/b", port: b.port, pid: 102, startedAt: 5000 };
    fs.writeFileSync(path.join(registry.dir, "window-102.json"), JSON.stringify(entry), "utf8");
    const failure = refused(await a.dispatcher()("add_note", { workspace: "/work/b", title: "Skew" }), "WORKSPACE_NOT_RESPONDING");
    assert.ok(failure.message.includes("reload the VS Code windows of MindStream"));
    assert.strictEqual(b.storage.getData().items.length, 0);
  });

  it("answers WORKSPACE_NOT_RESPONDING when the window refuses the token", async () => {
    b.token = "another-token";
    const failure = refused(await a.dispatcher()("add_note", { workspace: "/work/b", title: "Token" }), "WORKSPACE_NOT_RESPONDING");
    assert.ok(failure.message.includes("status 401"));
    assert.strictEqual(b.storage.getData().items.length, 0);
  });
});
