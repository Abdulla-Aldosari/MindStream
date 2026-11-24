/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { answerDialog, buildData, expect, notification, readData, runCommand, showSidebar, test, waitForData, type Session } from "./helpers";
import { freePort, waitForMcp } from "./mcpAgent";

const readClipboard = (session: Session) => session.app.evaluate(({ clipboard }) => clipboard.readText());

/** Runs the connect command and picks a client from the list. */
async function connectAs(session: Session, client: string): Promise<void> {
  await runCommand(session.page, "MindStream: Connect an AI agent (MCP)");
  const entry = session.page.locator(".quick-input-list .quick-input-list-entry", { hasText: client }).first();
  await entry.waitFor();
  await entry.click();
}

test("Connect an AI agent copies a working address and token, and a real client can add a note with them", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({ settings: { "mindstream.mcp.port": port } });
  const sidebar = await showSidebar(session.page);
  await waitForMcp(port);

  await connectAs(session, "Generic");
  await expect(notification(session.page, /Generic: configuration copied/)).toBeVisible({ timeout: 30_000 });

  const copied = await readClipboard(session);
  const url = /URL: (\S+)/.exec(copied)?.[1];
  const token = /Authorization: Bearer (\S+)/.exec(copied)?.[1];
  expect(url).toBe(`http://127.0.0.1:${port}/mcp`);
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const client = new Client({ name: "e2e-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url!), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  try {
    const answer = (await client.callTool({ name: "add_note", arguments: { workspace: session.workspace, title: "Added by an agent" } })) as {
      isError?: boolean;
      content?: { text: string }[];
    };
    expect(answer.isError).not.toBe(true);
    await expect(sidebar.locator(".card", { hasText: "Added by an agent" })).toBeVisible();
    await waitForData(session, (data) => data.items.some((n) => n.title === "Added by an agent"));
    expect(readData(session).items).toHaveLength(1);
  } finally {
    await client.close();
  }
});

test("the copied configuration of other clients carries the same address and token, and never reaches a project file", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({ settings: { "mindstream.mcp.port": port } });
  await waitForMcp(port);

  await connectAs(session, "Cursor");
  await expect(notification(session.page, /Cursor: configuration copied/)).toBeVisible({ timeout: 30_000 });
  const cursor = JSON.parse(await readClipboard(session)) as { mcpServers: { mindstream: { url: string; headers: { Authorization: string } } } };
  expect(cursor.mcpServers.mindstream.url).toBe(`http://127.0.0.1:${port}/mcp`);
  const token = cursor.mcpServers.mindstream.headers.Authorization.replace("Bearer ", "");

  await connectAs(session, "Codex");
  await expect(notification(session.page, /Codex: configuration copied/)).toBeVisible({ timeout: 30_000 });
  const codex = await readClipboard(session);
  expect(codex).toContain("[mcp_servers.mindstream]");
  expect(codex).toContain(`Bearer ${token}`);

  // The token is shown nowhere in the workspace: no file was written.
  const fs = await import("node:fs");
  const found = fs.readdirSync(session.workspace, { recursive: true, encoding: "utf8" }).filter((name) => /mcp/i.test(name));
  expect(found).toEqual([]);
});

test("the command is not locked by Work Pause: it only reads", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({
    settings: { "mindstream.mcp.port": port },
    data: { ...buildData(), workPauseNote: { text: "Away until Monday", updatedAt: "2026-11-01T10:00:00.000Z", paused: true } },
  });
  await showSidebar(session.page);
  await waitForMcp(port);

  await connectAs(session, "Generic");
  await expect(notification(session.page, /Generic: configuration copied/)).toBeVisible({ timeout: 30_000 });
  expect(await readClipboard(session)).toContain(`http://127.0.0.1:${port}/mcp`);
});

test("Copy agent rules for MCP puts the rules snippet on the clipboard, with no token in it", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({ settings: { "mindstream.mcp.port": port } });
  await waitForMcp(port);

  await runCommand(session.page, "MindStream: Copy agent rules for MCP");
  await expect(notification(session.page, /MindStream agent rules copied/)).toBeVisible({ timeout: 30_000 });

  const rules = await readClipboard(session);
  expect(rules).toContain("## MindStream notes (MCP)");
  expect(rules).not.toContain("save_work_pause_note");
  expect(rules).not.toMatch(/hand-?off|(start|end) of (a|the) session|where work stopped/i);
  expect(rules).toContain("It is not a record of agent sessions.");
  expect(rules).toContain("the user's own instructions and rules always take precedence");
  expect(rules).toContain("Never mark a note done or canceled on your own");
  expect(rules).toContain("no tool that deletes");
  expect(rules).not.toMatch(/Bearer|127\.0\.0\.1/);
});

test("the message after the copy has no button, and the configuration stays on the clipboard", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({ settings: { "mindstream.mcp.port": port } });
  await waitForMcp(port);

  await connectAs(session, "Cline");
  const toast = notification(session.page, /Cline: configuration copied/);
  await expect(toast).toBeVisible({ timeout: 30_000 });
  const toastItem = session.page.locator(".notifications-toasts .notification-toast", { hasText: "Cline: configuration copied" });
  await expect(toastItem).toHaveCount(1);
  await expect(toastItem.locator(".monaco-button")).toHaveCount(0);
  expect(await readClipboard(session)).toContain(`http://127.0.0.1:${port}/mcp`);
});

test("an agent that still sends an old token makes VS Code say why, and the button opens the connect command", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({ settings: { "mindstream.mcp.port": port } });
  await waitForMcp(port);
  // Wait until the token exists: a well-formed token that is not the current one is then an old one.
  await connectAs(session, "Generic");
  await expect(notification(session.page, /Generic: configuration copied/)).toBeVisible({ timeout: 30_000 });

  const oldToken = "x".repeat(43);
  const client = new Client({ name: "e2e-old-agent", version: "1.0.0" });
  await expect(
    client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${oldToken}` } } }))
  ).rejects.toThrow();

  const warning = notification(session.page, /an AI agent is using an old token/);
  await expect(warning).toBeVisible({ timeout: 30_000 });
  await session.page.locator(".notifications-toasts .monaco-button", { hasText: "Connect an AI agent" }).first().click();
  await expect(session.page.locator(".quick-input-list .quick-input-list-entry", { hasText: "Generic" }).first()).toBeVisible();
});

test("Regenerate MCP token confirms, and its button opens the connect command", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({ settings: { "mindstream.mcp.port": port } });
  await waitForMcp(port);

  await runCommand(session.page, "MindStream: Regenerate MCP token");
  await answerDialog(session.page, "Regenerate");
  await expect(notification(session.page, /MindStream MCP token regenerated/)).toBeVisible({ timeout: 30_000 });
  await session.page.locator(".notifications-toasts .monaco-button", { hasText: "Connect an AI agent" }).first().click();
  await expect(session.page.locator(".quick-input-list .quick-input-list-entry", { hasText: "Generic" }).first()).toBeVisible();
});

test("choosing Copilot explains that nothing needs to be pasted and copies nothing", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({ settings: { "mindstream.mcp.port": port } });
  await waitForMcp(port);
  await session.app.evaluate(({ clipboard }) => clipboard.writeText("untouched"));

  await connectAs(session, "GitHub Copilot");
  await expect(notification(session.page, /nothing needs to be pasted/)).toBeVisible({ timeout: 30_000 });
  expect(await readClipboard(session)).toBe("untouched");
});
