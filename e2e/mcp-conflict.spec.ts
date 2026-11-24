/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { buildData, expect, readData, showSidebar, test, waitForData } from "./helpers";
import { Agent, freePort, waitForMcp } from "./mcpAgent";

test("a note the agent changes while its form is open is flagged in the form, and Save is refused", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({ settings: { "mindstream.mcp.port": port }, data: buildData([{ title: "Fix save", description: "Line 40" }]) });
  const sidebar = await showSidebar(session.page);
  await waitForMcp(port);
  const agent = await Agent.connect(session);
  try {
    await sidebar.locator(".card", { hasText: "Fix save" }).locator('[data-tooltip="Edit"]').click();
    await expect(sidebar.locator("#modal")).toBeVisible();
    await sidebar.locator("#f-title").fill("Fix the save");

    const id = readData(session).items[0].id;
    const answer = await agent.call("update_note", { id, appendDescription: "Cause: the file is locked." });
    expect(answer.isError).not.toBe(true);

    await expect(sidebar.locator("#f-changed-notice")).toBeVisible();
    await expect(sidebar.locator("#f-changed-notice")).toContainText("changed elsewhere (description)");
    await sidebar.locator("#modal-save").click();
    await expect(sidebar.locator("#modal")).toBeVisible();
    await expect(sidebar.locator("#f-title")).toHaveValue("Fix the save");
    const saved = readData(session).items[0];
    expect(saved.title).toBe("Fix save");
    expect(saved.description).toBe("Line 40\n\nCause: the file is locked.");
  } finally {
    await agent.close();
  }
});

test("a note the agent adds appears in the sidebar at once, and a status it changes does not block the user's Save", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({ settings: { "mindstream.mcp.port": port }, data: buildData([{ title: "Existing" }]) });
  const sidebar = await showSidebar(session.page);
  await waitForMcp(port);
  const agent = await Agent.connect(session);
  try {
    await agent.call("add_note", { title: "Found by the agent", priority: "high" });
    await expect(sidebar.locator(".card", { hasText: "Found by the agent" })).toBeVisible();

    await sidebar.locator(".card", { hasText: "Existing" }).locator('[data-tooltip="Edit"]').click();
    await sidebar.locator("#f-title").fill("Existing, renamed");
    const id = readData(session).items.find((n) => n.title === "Existing")!.id;
    expect((await agent.call("set_note_status", { id, status: "in-progress" })).isError).not.toBe(true);

    await sidebar.locator("#modal-save").click();
    await expect(sidebar.locator("#modal")).toBeHidden();
    await waitForData(session, (d) => d.items.some((n) => n.title === "Existing, renamed" && n.status === "in-progress"));
  } finally {
    await agent.close();
  }
});
