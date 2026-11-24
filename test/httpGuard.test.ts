/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { GuardRequest, NONCE_PATTERN, checkPeer, checkRequest, holderProof, tokensEqual, verifyHolderProof } from "../src/mcp/httpGuard";

const TOKEN = "test-token-not-a-real-secret";
const PORT = 18741;

function request(overrides: Partial<GuardRequest> = {}, headers: GuardRequest["headers"] = {}): GuardRequest {
  return { method: "POST", remoteAddress: "127.0.0.1", headers: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}`, ...headers }, ...overrides };
}

describe("checkRequest", () => {
  it("accepts a loopback request with the right Host and token", () => {
    assert.deepStrictEqual(checkRequest(request(), TOKEN, PORT), { ok: true });
  });

  it("accepts localhost as the Host and the IPv4-mapped loopback address", () => {
    assert.strictEqual(checkRequest(request({}, { host: `localhost:${PORT}` }), TOKEN, PORT).ok, true);
    assert.strictEqual(checkRequest(request({ remoteAddress: "::ffff:127.0.0.1" }), TOKEN, PORT).ok, true);
    assert.strictEqual(checkRequest(request({ remoteAddress: "::1" }), TOKEN, PORT).ok, true);
  });

  it("refuses a peer that is not loopback (403), or an unknown peer", () => {
    for (const remoteAddress of ["192.168.1.5", "10.0.0.1", "::ffff:10.0.0.1", "", undefined]) {
      const result = checkRequest(request({ remoteAddress }), TOKEN, PORT);
      assert.deepStrictEqual([result.ok, !result.ok && result.status], [false, 403], String(remoteAddress));
    }
  });

  it("refuses any Origin header (403), even a local one, before looking at the token", () => {
    for (const origin of ["https://evil.example", "http://127.0.0.1:18741", "null", ""]) {
      const result = checkRequest(request({}, { origin }), "", PORT);
      assert.deepStrictEqual([result.ok, !result.ok && result.status], [false, 403], origin);
    }
  });

  it("refuses a Host that does not name this server (403): DNS rebinding", () => {
    for (const host of ["evil.example", "evil.example:18741", "127.0.0.1", "127.0.0.1:9999", "localhost", "127.0.0.1:18741.evil.example", undefined]) {
      const result = checkRequest(request({}, { host }), TOKEN, PORT);
      assert.deepStrictEqual([result.ok, !result.ok && result.status], [false, 403], String(host));
    }
  });

  it("refuses a repeated Host or Authorization header", () => {
    assert.strictEqual(checkRequest(request({}, { host: [`127.0.0.1:${PORT}`, "evil.example"] }), TOKEN, PORT).ok, false);
    assert.strictEqual(checkRequest(request({}, { authorization: [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`] }), TOKEN, PORT).ok, false);
  });

  it("refuses a missing or wrong token (401) with a Bearer challenge", () => {
    const cases: (string | undefined)[] = [
      undefined,
      "",
      "Bearer",
      "Bearer ",
      `Bearer ${TOKEN}x`,
      `Bearer ${TOKEN.slice(1)}`,
      "Bearer wrong-token-of-same-length-xx",
      TOKEN,
      `Basic ${TOKEN}`,
    ];
    for (const authorization of cases) {
      const result = checkRequest(request({}, { authorization }), TOKEN, PORT);
      assert.deepStrictEqual([result.ok, !result.ok && result.status, !result.ok && result.challenge], [false, 401, "Bearer"], String(authorization));
    }
  });

  it("flags a well-formed token that is not the current one as an old token", () => {
    const current = "A".repeat(43);
    const old = "B".repeat(43);
    const result = checkRequest(request({}, { authorization: `Bearer ${old}` }), current, PORT);
    assert.strictEqual(!result.ok && result.wrongToken, true);
  });

  it("does not flag a missing, malformed, or wrongly shaped token, nor any request while no token exists", () => {
    const current = "A".repeat(43);
    for (const authorization of [undefined, "", "Bearer ", "Bearer short", `Basic ${"B".repeat(43)}`, `Bearer ${"B".repeat(44)}`, `Bearer ${"B".repeat(42)}!`]) {
      const result = checkRequest(request({}, { authorization }), current, PORT);
      assert.strictEqual(!result.ok && result.wrongToken, undefined, String(authorization));
    }
    const noToken = checkRequest(request({}, { authorization: `Bearer ${"B".repeat(43)}` }), "", PORT);
    assert.strictEqual(!noToken.ok && noToken.wrongToken, undefined);
  });

  it("refuses lowercase bearer: the scheme is matched exactly", () => {
    assert.strictEqual(checkRequest(request({}, { authorization: `bearer ${TOKEN}` }), TOKEN, PORT).ok, false);
  });

  it("refuses everything when the expected token is empty, even an empty bearer", () => {
    assert.strictEqual(checkRequest(request({}, { authorization: "Bearer " }), "", PORT).ok, false);
    assert.strictEqual(checkRequest(request(), "", PORT).ok, false);
  });

  it("gives a reason that never contains the token", () => {
    const given = "attempt-9f3b27c1";
    const result = checkRequest(request({}, { authorization: `Bearer ${given}` }), TOKEN, PORT);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(!result.ok && result.reason.includes(TOKEN), false);
    assert.strictEqual(!result.ok && result.reason.includes(given), false);
  });

  it("checks the peer before the Origin, the Origin before the Host, the Host before the token", () => {
    const status = (r: ReturnType<typeof checkRequest>) => (r.ok ? 200 : r.status);
    assert.strictEqual(status(checkRequest(request({ remoteAddress: "8.8.8.8" }, { origin: "x" }), TOKEN, PORT)), 403);
    assert.strictEqual(status(checkRequest(request({}, { origin: "x", host: "evil" }), TOKEN, PORT)), 403);
    assert.strictEqual(status(checkRequest(request({}, { host: "evil", authorization: undefined }), TOKEN, PORT)), 403);
    assert.strictEqual(status(checkRequest(request({}, { authorization: undefined }), TOKEN, PORT)), 401);
  });
});

describe("tokensEqual", () => {
  it("is true only for equal strings", () => {
    assert.strictEqual(tokensEqual("abc", "abc"), true);
    assert.strictEqual(tokensEqual("abc", "abd"), false);
  });

  it("is false for different lengths without throwing", () => {
    assert.strictEqual(tokensEqual("abc", "abcd"), false);
    assert.strictEqual(tokensEqual("", "a"), false);
  });

  it("compares multi-byte text by its bytes", () => {
    assert.strictEqual(tokensEqual("é", "é"), true);
    assert.strictEqual(tokensEqual("é", "e"), false);
  });
});

describe("checkPeer", () => {
  it("accepts a loopback request with the right Host and no token", () => {
    assert.deepStrictEqual(checkPeer(request({}, { authorization: undefined }), PORT), { ok: true });
  });

  it("refuses a remote peer, an Origin header, and a wrong Host with 403", () => {
    for (const r of [request({ remoteAddress: "10.0.0.2" }), request({}, { origin: "null" }), request({}, { host: "evil.example" })]) {
      const result = checkPeer(r, PORT);
      assert.strictEqual(result.ok ? 200 : result.status, 403);
    }
  });
});

describe("holder proof", () => {
  const NONCE = "0123456789abcdef0123456789abcdef";

  it("is verified with the same token and nonce", () => {
    assert.strictEqual(verifyHolderProof(TOKEN, NONCE, holderProof(TOKEN, NONCE)), true);
  });

  it("does not verify with another token, another nonce, or a non-text proof", () => {
    const proof = holderProof(TOKEN, NONCE);
    assert.strictEqual(verifyHolderProof("other-token", NONCE, proof), false);
    assert.strictEqual(verifyHolderProof(TOKEN, "f".repeat(32), proof), false);
    assert.strictEqual(verifyHolderProof(TOKEN, NONCE, undefined), false);
    assert.strictEqual(verifyHolderProof(TOKEN, NONCE, 42), false);
  });

  it("never verifies with an empty token", () => {
    assert.strictEqual(verifyHolderProof("", NONCE, holderProof("", NONCE)), false);
  });

  it("does not contain the token", () => {
    assert.strictEqual(holderProof(TOKEN, NONCE).includes(TOKEN), false);
    assert.match(holderProof(TOKEN, NONCE), /^[0-9a-f]{64}$/);
  });

  it("accepts only 32 lowercase hex characters as a nonce", () => {
    assert.strictEqual(NONCE_PATTERN.test(NONCE), true);
    for (const bad of ["", "xyz", NONCE.toUpperCase(), `${NONCE}0`, NONCE.slice(1)]) {
      assert.strictEqual(NONCE_PATTERN.test(bad), false, bad);
    }
  });
});
