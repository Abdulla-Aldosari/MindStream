/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import * as http from "http";
import { AddressInfo } from "net";
import { PortHold, PortRole, holdFixedPort, probePortHolder } from "../src/mcp/portHolder";
import { TEST_TOKEN } from "./mcpWindow";
import { closeServer, freePort, newServer, until } from "./portTools";

const RETRY_MS = 60;

describe("holdFixedPort", () => {
  const holds: PortHold[] = [];
  const strangers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(holds.splice(0).map((h) => h.stop()));
    await Promise.all(strangers.splice(0).map(closeServer));
  });

  function hold(port: number, roles: PortRole[] = []): PortHold {
    const h = holdFixedPort(newServer(), port, { retryMs: RETRY_MS, token: () => TEST_TOKEN, onRoleChange: (role) => roles.push(role) });
    holds.push(h);
    return h;
  }

  it("takes a free port as the router", async () => {
    const roles: PortRole[] = [];
    const h = hold(await freePort(), roles);
    await until(() => h.role === "router");
    assert.deepStrictEqual(roles, ["router"]);
  });

  it("lets exactly one of two windows take the port, and the other follows", async () => {
    const port = await freePort();
    const first = hold(port);
    await until(() => first.role === "router");
    const second = hold(port);
    await until(() => second.role === "follower");
    assert.strictEqual(first.role, "router");
  });

  it("hands the port to the follower within the retry interval after the router stops, and records the gap", async () => {
    const port = await freePort();
    const router = hold(port);
    await until(() => router.role === "router");
    const follower = hold(port);
    await until(() => follower.role === "follower");
    await router.stop();
    const gap = await until(() => follower.role === "router");
    console.log(`      port takeover gap: ${gap} ms (retry interval ${RETRY_MS} ms)`);
    assert.ok(gap < RETRY_MS * 6 + 500, `took ${gap} ms`);
  });

  it("reports blocked when a program that is not MindStream holds the port, and recovers when it frees it", async () => {
    const stranger = http.createServer((_req, res) => res.end("hello"));
    strangers.push(stranger);
    await new Promise<void>((resolve) => stranger.listen(0, "127.0.0.1", resolve));
    const roles: PortRole[] = [];
    const h = hold((stranger.address() as AddressInfo).port, roles);
    await until(() => h.role === "blocked");
    await closeServer(stranger);
    await until(() => h.role === "router");
    assert.deepStrictEqual(roles, ["blocked", "router"]);
  });

  it("releases the port on stop, even before the first attempt ends", async () => {
    const port = await freePort();
    await hold(port).stop();
    const probe = newServer();
    assert.strictEqual(await probe.start(port), port);
    await probe.stop();
  });
});

describe("probePortHolder", () => {
  it("recognizes a MindStream server, but only with the right token", async () => {
    const server = newServer();
    const port = await server.start(0);
    assert.strictEqual(await probePortHolder(port, TEST_TOKEN), "mindstream");
    assert.strictEqual(await probePortHolder(port, "wrong"), "other");
    await server.stop();
  });

  it("answers other for a port nobody listens on", async () => {
    assert.strictEqual(await probePortHolder(await freePort(), TEST_TOKEN, 300), "other");
  });

  it("never sends the token to whatever holds the port", async () => {
    const seen: { url?: string; headers: http.IncomingHttpHeaders }[] = [];
    const spy = http.createServer((req, res) => {
      seen.push({ url: req.url, headers: req.headers });
      res.end("{}");
    });
    await new Promise<void>((resolve) => spy.listen(0, "127.0.0.1", resolve));
    try {
      assert.strictEqual(await probePortHolder((spy.address() as AddressInfo).port, TEST_TOKEN), "other");
      assert.strictEqual(seen.length, 1);
      assert.strictEqual(seen[0].headers.authorization, undefined);
      assert.strictEqual(JSON.stringify(seen[0]).includes(TEST_TOKEN), false);
      assert.match(seen[0].url ?? "", /^\/mindstream-health\?nonce=[0-9a-f]{32}$/);
    } finally {
      await closeServer(spy);
    }
  });

  it("treats a holder that claims to be MindStream without a valid proof as another program", async () => {
    const liar = http.createServer((_req, res) => res.end(JSON.stringify({ product: "mindstream", protocol: 1, proof: "00".repeat(32) })));
    await new Promise<void>((resolve) => liar.listen(0, "127.0.0.1", resolve));
    try {
      assert.strictEqual(await probePortHolder((liar.address() as AddressInfo).port, TEST_TOKEN), "other");
    } finally {
      await closeServer(liar);
    }
  });

  it("sends nothing while this window has no token yet", async () => {
    let requests = 0;
    const spy = http.createServer((_req, res) => {
      requests++;
      res.end("{}");
    });
    await new Promise<void>((resolve) => spy.listen(0, "127.0.0.1", resolve));
    try {
      assert.strictEqual(await probePortHolder((spy.address() as AddressInfo).port, ""), "other");
      assert.strictEqual(requests, 0);
    } finally {
      await closeServer(spy);
    }
  });
});
