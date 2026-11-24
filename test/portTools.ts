/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as http from "http";
import { AddressInfo } from "net";
import { McpHttpServer } from "../src/mcp/mcpHttpServer";
import { TEST_TOKEN } from "./mcpWindow";

/** A public endpoint that answers the holder check like a MindStream window does, and nothing else. */
export function newServer(): McpHttpServer {
  return new McpHttpServer({ handler: () => Promise.resolve(), token: () => TEST_TOKEN });
}

/** A free port: opened and released at once. */
export async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** Waits for a condition and resolves with how long it took; rejects after `timeoutMs`. */
export async function until(condition: () => boolean, timeoutMs = 3000): Promise<number> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for the condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return Date.now() - started;
}

/** Closes an HTTP server and every connection it still holds. */
export function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
