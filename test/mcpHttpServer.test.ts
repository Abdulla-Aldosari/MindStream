/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { PortInUseError } from "../src/mcp/mcpHttpServer";
import { newServer } from "./portTools";

describe("McpHttpServer", () => {
  it("starts on a free port, reports it, and stops (twice is safe)", async () => {
    const server = newServer();
    const port = await server.start(0);
    assert.ok(port > 0);
    assert.strictEqual(server.running, true);
    assert.strictEqual(server.port, port);
    await server.stop();
    await server.stop();
    assert.strictEqual(server.running, false);
    assert.strictEqual(server.port, undefined);
  });

  it("rejects with PORT_IN_USE when the port is taken, and starts again after the holder stops", async () => {
    const first = newServer();
    const port = await first.start(0);
    const second = newServer();
    await assert.rejects(second.start(port), (err: unknown) => err instanceof PortInUseError && err.code === "PORT_IN_USE" && err.port === port);
    assert.strictEqual(second.running, false);
    await first.stop();
    assert.strictEqual(await second.start(port), port);
    await second.stop();
  });

  it("refuses a second start while running", async () => {
    const server = newServer();
    await server.start(0);
    await assert.rejects(server.start(0));
    await server.stop();
  });

  it("listens on the loopback address only", async () => {
    const server = newServer();
    await server.start(0);
    assert.strictEqual(server.address, "127.0.0.1");
    await server.stop();
  });
});
