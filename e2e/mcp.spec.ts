/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as http from "node:http";
import { AddressInfo } from "node:net";
import { expect, test, type Session } from "./helpers";
import { waitForMcp } from "./mcpAgent";

/** A free port: opened and released at once, so a test never touches 18741 on the developer's machine. */
async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** A raw request to the endpoint, with exactly the headers given. */
function request(port: number, headers: Record<string, string>, body = "{}", path = "/mcp"): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "POST", agent: false, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...headers } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

/** The status bar item of MindStream's MCP server. */
const statusItem = (session: Session) => session.page.locator('.statusbar-item[aria-label*="MindStream MCP"]');

test("the MCP server is always on without opening the sidebar, and adds no status bar item while it works", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({ settings: { "mindstream.mcp.port": port } });

  await waitForMcp(port);
  // Give the item a moment it would need to appear, then check it never did.
  await session.page.waitForTimeout(1_000);
  await expect(statusItem(session)).toHaveCount(0);
});

test("the endpoint refuses a request without the token and one that carries an Origin header", async ({ launch }) => {
  const port = await freePort();
  await launch({ settings: { "mindstream.mcp.port": port } });
  await waitForMcp(port);

  const host = { host: `127.0.0.1:${port}` };
  expect(await request(port, host)).toBe(401);
  expect(await request(port, { ...host, authorization: "Bearer not-the-token" })).toBe(401);
  expect(await request(port, { ...host, origin: "https://evil.example" })).toBe(403);
  expect(await request(port, { ...host, host: "evil.example" })).toBe(403);
});

test("a port held by another program shows a status bar warning that says what to do, and it goes once the port is free", async ({ launch }) => {
  const port = await freePort();
  const holder = http.createServer((_req, res) => res.end("not MindStream"));
  await new Promise<void>((resolve) => holder.listen(port, "127.0.0.1", resolve));
  let released = false;
  const release = async () => {
    if (!released) {
      released = true;
      holder.closeAllConnections();
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
  };
  try {
    const session = await launch({ settings: { "mindstream.mcp.port": port } });
    // A program that is not MindStream holds the port: the item warns, and says what to do.
    await expect(statusItem(session)).toBeVisible({ timeout: 30_000 });
    await expect(statusItem(session)).toContainText("MCP");
    await expect(statusItem(session)).toHaveAttribute("aria-label", /used by another program/);

    await release();
    await waitForMcp(port);
    await expect(statusItem(session)).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await release();
  }
});
