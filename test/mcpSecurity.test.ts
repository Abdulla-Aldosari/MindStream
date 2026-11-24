/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { holderProof } from "../src/mcp/httpGuard";
import { TEST_TOKEN } from "./mcpWindow";
import { TestEndpoint, legacyRequest, raw } from "./mcpEndpoint";

describe("MCP endpoint: who may call it", () => {
  let endpoint: TestEndpoint;
  const headers = (extra: Record<string, string> = {}) => ({ ...endpoint.headers(), ...extra });
  const list = legacyRequest("tools/list");

  beforeEach(async () => {
    endpoint = await new TestEndpoint(401).start();
  });

  afterEach(async () => {
    await endpoint.stop();
  });

  it("answers 401 without a token, with a wrong one, and with a lowercase scheme", async () => {
    const noAuth = { ...endpoint.headers(), authorization: "" };
    delete (noAuth as Record<string, string | undefined>).authorization;
    assert.strictEqual((await raw(endpoint.port, noAuth, list)).status, 401);
    assert.strictEqual((await raw(endpoint.port, headers({ authorization: "Bearer wrong" }), list)).status, 401);
    assert.strictEqual((await raw(endpoint.port, headers({ authorization: `bearer ${TEST_TOKEN}` }), list)).status, 401);
  });

  it("answers 403 to a request that carries an Origin header, even with the right token", async () => {
    for (const origin of ["https://evil.example", "http://127.0.0.1", "null"]) {
      assert.strictEqual((await raw(endpoint.port, headers({ origin }), list)).status, 403, origin);
    }
  });

  it("answers 403 to a wrong Host: DNS rebinding", async () => {
    for (const host of ["evil.example", "evil.example:18741", `127.0.0.1:${endpoint.port + 1}`]) {
      assert.strictEqual((await raw(endpoint.port, headers({ host }), list)).status, 403, host);
    }
  });

  it("runs nothing for a refused request", async () => {
    const body = legacyRequest("tools/call", { name: "add_note", arguments: { workspace: "/work/a", title: "No" } });
    await raw(endpoint.port, headers({ authorization: "Bearer wrong" }), body);
    await raw(endpoint.port, headers({ origin: "https://evil.example" }), body);
    assert.strictEqual(endpoint.win.storage.getData().items.length, 0);
  });

  it("reports a request with an old well-formed token, and not one without a token", async () => {
    endpoint.win.token = "C".repeat(43);
    await raw(endpoint.port, headers({ authorization: `Bearer ${"D".repeat(43)}` }), list);
    assert.strictEqual(endpoint.wrongTokens, 1);
    const noAuth: Record<string, string> = { ...endpoint.headers() };
    delete noAuth.authorization;
    await raw(endpoint.port, noAuth, list);
    await raw(endpoint.port, headers({ authorization: "Bearer guess" }), list);
    assert.strictEqual(endpoint.wrongTokens, 1);
    assert.strictEqual(endpoint.requests, 0);
  });

  it("applies a regenerated token at once", async () => {
    endpoint.win.token = "new-token";
    // The client still holds the old token.
    assert.strictEqual((await raw(endpoint.port, headers({ authorization: `Bearer ${TEST_TOKEN}` }), list)).status, 401);
    assert.strictEqual((await raw(endpoint.port, headers({ authorization: "Bearer new-token" }), list)).status, 200);
  });

  it("answers the holder check with a proof of the token, never the token, and only to a nonce", async () => {
    const nonce = "0123456789abcdef0123456789abcdef";
    const host = { host: `127.0.0.1:${endpoint.port}` };
    const answer = await raw(endpoint.port, host, "", "GET", `/mindstream-health?nonce=${nonce}`);
    assert.strictEqual(answer.status, 200);
    const body = JSON.parse(answer.text) as { proof: string };
    assert.strictEqual(body.proof, holderProof(TEST_TOKEN, nonce));
    assert.strictEqual(answer.text.includes(TEST_TOKEN), false);
    assert.strictEqual(answer.text.includes("mindstream"), false);
    assert.strictEqual((await raw(endpoint.port, host, "", "GET", "/mindstream-health")).status, 400);
    assert.strictEqual((await raw(endpoint.port, host, "", "GET", "/mindstream-health?nonce=xyz")).status, 400);
  });

  it("refuses the holder check to a browser and to a wrong Host", async () => {
    const path = "/mindstream-health?nonce=0123456789abcdef0123456789abcdef";
    assert.strictEqual((await raw(endpoint.port, { host: `127.0.0.1:${endpoint.port}`, origin: "https://evil.example" }, "", "GET", path)).status, 403);
    assert.strictEqual((await raw(endpoint.port, { host: "evil.example" }, "", "GET", path)).status, 403);
  });

  it("answers the holder check with 503 until a token exists", async () => {
    endpoint.win.token = "";
    const answer = await raw(endpoint.port, { host: `127.0.0.1:${endpoint.port}` }, "", "GET", "/mindstream-health?nonce=0123456789abcdef0123456789abcdef");
    assert.strictEqual(answer.status, 503);
  });

  it("answers 404 for any other path", async () => {
    assert.strictEqual((await raw(endpoint.port, headers(), list, "POST", "/other")).status, 404);
  });
});
