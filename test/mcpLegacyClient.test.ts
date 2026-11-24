/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { TestEndpoint, dataOf, legacyRequest, legacyResult, raw, type ToolAnswer } from "./mcpEndpoint";

/**
 * A client of the 2025 protocol, sent as raw JSON-RPC (no client library of the
 * previous generation is a dependency): the server still answers it, statelessly.
 */
describe("MCP endpoint: a client of the 2025 protocol", () => {
  let endpoint: TestEndpoint;

  beforeEach(async () => {
    endpoint = await new TestEndpoint(402).start();
  });

  afterEach(async () => {
    await endpoint.stop();
  });

  const initialize = legacyRequest("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "old-client", version: "1.0.0" } });

  it("initializes and lists every tool", async () => {
    const init = await raw(endpoint.port, endpoint.headers(), initialize);
    assert.strictEqual(init.status, 200, init.text);
    assert.ok(legacyResult(init.text).serverInfo, init.text);
    const list = await raw(endpoint.port, endpoint.headers(), legacyRequest("tools/list", {}, 2));
    assert.strictEqual(list.status, 200, list.text);
    const tools = legacyResult(list.text).tools as { name: string }[];
    assert.ok(tools.some((t) => t.name === "add_note"));
    assert.strictEqual(tools.length, 12);
  });

  it("calls a tool and gets the data as JSON in the text", async () => {
    const call = legacyRequest("tools/call", { name: "add_note", arguments: { workspace: "/work/a", title: "From 2025" } }, 3);
    const answer = await raw(endpoint.port, endpoint.headers(), call);
    assert.strictEqual(answer.status, 200, answer.text);
    const result = legacyResult(answer.text) as ToolAnswer;
    assert.strictEqual(dataOf<{ workspace: string }>(result).workspace, "/work/a");
    assert.deepStrictEqual(
      endpoint.win.storage.getData().items.map((n) => n.title),
      ["From 2025"]
    );
  });

  it("returns a refusal as an error result", async () => {
    const call = legacyRequest("tools/call", { name: "get_note", arguments: { workspace: "/work/a", id: "gone" } }, 4);
    const result = legacyResult((await raw(endpoint.port, endpoint.headers(), call)).text) as ToolAnswer;
    assert.strictEqual(result.isError, true);
    assert.strictEqual(dataOf(result).code, "NOT_FOUND");
  });

  it("answers 405 to the session operations it does not keep (GET and DELETE)", async () => {
    assert.strictEqual((await raw(endpoint.port, endpoint.headers(), "", "GET")).status, 405);
    assert.strictEqual((await raw(endpoint.port, endpoint.headers(), "", "DELETE")).status, 405);
  });
});
