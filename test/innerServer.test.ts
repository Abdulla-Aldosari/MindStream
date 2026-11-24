/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import * as http from "http";
import { ToolResult } from "../src/mcp/mcpTypes";
import { PROTOCOL_VERSION } from "../src/mcp/routerRegistry";
import { TEST_TOKEN, TestWindow, makeRegistryDir, postCall } from "./mcpWindow";

describe("inner server", () => {
  let registry: ReturnType<typeof makeRegistryDir>;
  let win: TestWindow;

  beforeEach(async () => {
    registry = makeRegistryDir();
    win = await new TestWindow("/work/a", 201, registry.dir, new Set()).open();
  });

  afterEach(async () => {
    await win.close();
    registry.remove();
  });

  const auth = () => ({ authorization: `Bearer ${TEST_TOKEN}`, host: `127.0.0.1:${win.port}` });
  const call = (body: object) => JSON.stringify({ protocol: PROTOCOL_VERSION, ...body });
  const code = (text: string) => {
    const result = JSON.parse(text) as ToolResult;
    return result.ok ? "ok" : result.code;
  };

  it("runs a tool and answers its result as JSON", async () => {
    const answer = await postCall(win.port, call({ name: "add_note", args: { title: "Direct" } }), auth());
    assert.strictEqual(answer.status, 200);
    assert.strictEqual(code(answer.text), "ok");
    assert.strictEqual(win.storage.getData().items.length, 1);
  });

  it("refuses a request without the token, or with a wrong one (401), and runs nothing", async () => {
    const body = call({ name: "add_note", args: { title: "No" } });
    const host = { host: `127.0.0.1:${win.port}` };
    assert.strictEqual((await postCall(win.port, body, host)).status, 401);
    assert.strictEqual((await postCall(win.port, body, { ...host, authorization: "Bearer wrong" })).status, 401);
    assert.strictEqual(win.storage.getData().items.length, 0);
  });

  it("refuses an Origin header and a wrong Host (403)", async () => {
    const body = call({ name: "add_note", args: { title: "No" } });
    assert.strictEqual((await postCall(win.port, body, { ...auth(), origin: "https://evil.example" })).status, 403);
    assert.strictEqual((await postCall(win.port, body, { ...auth(), host: "evil.example" })).status, 403);
    assert.strictEqual(win.storage.getData().items.length, 0);
  });

  it("applies a regenerated token at once", async () => {
    win.token = "another-token";
    assert.strictEqual((await postCall(win.port, call({ name: "list_notes", args: {} }), auth())).status, 401);
  });

  it("answers a refusal for a bad call instead of failing", async () => {
    const bodies = [
      "{ not json",
      "[]",
      JSON.stringify({ protocol: PROTOCOL_VERSION }),
      call({ name: "delete_note", args: {} }),
      JSON.stringify({ protocol: 999, name: "list_notes", args: {} }),
    ];
    const codes: string[] = [];
    for (const body of bodies) {
      const answer = await postCall(win.port, body, auth());
      assert.strictEqual(answer.status, 200, body);
      codes.push(code(answer.text));
    }
    assert.deepStrictEqual(codes, ["INVALID_INPUT", "INVALID_INPUT", "INVALID_INPUT", "INVALID_INPUT", "WORKSPACE_NOT_RESPONDING"]);
  });

  it("runs nothing for another protocol version", async () => {
    await postCall(win.port, JSON.stringify({ protocol: 999, name: "add_note", args: { title: "Skew" } }), auth());
    assert.strictEqual(win.storage.getData().items.length, 0);
  });

  it("answers 404 for another path", async () => {
    const answer = await postCall(win.port, "{}", auth(), "/other");
    assert.strictEqual(answer.status, 404);
  });

  it("refuses a body over the limit and runs nothing", async () => {
    const big = JSON.stringify({ protocol: PROTOCOL_VERSION, name: "add_note", args: { title: "x".repeat(2 * 1024 * 1024) } });
    const outcome = await postCall(win.port, big, auth()).then(
      (answer) => answer.status,
      () => 413
    );
    assert.strictEqual(outcome, 413);
    assert.strictEqual(win.storage.getData().items.length, 0);
  });

  it("answers 404 for a GET", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: win.port, path: "/call", method: "GET", agent: false, headers: auth() }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      });
      req.on("error", reject);
      req.end();
    });
    assert.strictEqual(status, 404);
  });

  it("stop resolves when it was not running, and closes the port", async () => {
    await win.inner.stop();
    await win.inner.stop();
    await assert.rejects(postCall(win.port, "{}", auth()));
  });
});
