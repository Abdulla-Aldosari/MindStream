/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { answerDialog, buildData, dialog, expect, openSidebar, readData, runCommand, sidebarFrame, test, waitForData } from "./helpers";

test("Ctrl+Alt+M shows the sidebar even when it was never opened", async ({ launch }) => {
  const session = await launch({ data: buildData([]) });
  // The shortcut is only heard once the window is ready and the extension has registered its view.
  await expect(session.page.locator('.activitybar .action-label[aria-label="MindStream"]')).toBeVisible();
  await session.page.locator(".monaco-workbench").click({ position: { x: 5, y: 5 } });

  await session.page.keyboard.press("Control+Alt+M");

  const sidebar = await sidebarFrame(session.page);
  await expect(sidebar.locator("#modal")).toBeVisible();
  await expect(sidebar.locator("#modal-title")).toHaveText("New note");
});

test("the Quick Note command with an untouched open form simply starts a fresh one", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Existing" }]) });
  await openSidebar(session.page);
  const sidebar = await sidebarFrame(session.page);

  await runCommand(session.page, "MindStream: Quick Note");
  await expect(sidebar.locator("#modal-title")).toHaveText("New note");
  // Let the Command Palette close before it is opened again.
  await expect(session.page.locator(".quick-input-widget")).toBeHidden();
  await runCommand(session.page, "MindStream: Quick Note");
  await expect(sidebar.locator("#modal-title")).toHaveText("New note");
  await expect(dialog(session.page)).toHaveCount(0);
  await expect(sidebar.locator("#modal")).toBeVisible();
});

test("Quick Note with unsaved changes asks; Cancel keeps the typed text", async ({ launch }) => {
  const session = await launch({ data: buildData([]) });
  await openSidebar(session.page);
  const sidebar = await sidebarFrame(session.page);

  await runCommand(session.page, "MindStream: Quick Note");
  await sidebar.locator("#f-title").fill("Half written");
  await runCommand(session.page, "MindStream: Quick Note");

  await answerDialog(session.page, "Cancel");
  await expect(sidebar.locator("#f-title")).toHaveValue("Half written");
});

test("Quick Note with unsaved changes can discard them and start a new note", async ({ launch }) => {
  const session = await launch({ data: buildData([]) });
  await openSidebar(session.page);
  const sidebar = await sidebarFrame(session.page);

  await runCommand(session.page, "MindStream: Quick Note");
  await sidebar.locator("#f-title").fill("Thrown away");
  await runCommand(session.page, "MindStream: Quick Note");

  await answerDialog(session.page, "Discard");
  await expect(sidebar.locator("#f-title")).toHaveValue("");
  expect(readData(session).items).toHaveLength(0);
});

test("Quick Note with unsaved changes can save them first, then opens the new note", async ({ launch }) => {
  const session = await launch({ data: buildData([]) });
  await openSidebar(session.page);
  const sidebar = await sidebarFrame(session.page);

  await runCommand(session.page, "MindStream: Quick Note");
  await sidebar.locator("#f-title").fill("Kept note");
  await runCommand(session.page, "MindStream: Quick Note");

  await answerDialog(session.page, "Save");
  await waitForData(session, (d) => d.items.some((i) => i.title === "Kept note"));
  await expect(sidebar.locator("#modal-title")).toHaveText("New note");
  await expect(sidebar.locator("#f-title")).toHaveValue("");
});

test("Quick Note while the description tab holds unsaved text never loses that text", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Long one", description: "original" }]) });
  await openSidebar(session.page);
  const sidebar = await sidebarFrame(session.page);

  await sidebar.locator(".card", { hasText: "Long one" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#f-desc-external").click();
  await session.page.locator(".editor-instance .monaco-editor").first().click();
  await session.page.keyboard.press("Control+A");
  await session.page.keyboard.insertText("typed in the tab");
  await expect(sidebar.locator("#f-desc")).toHaveValue("typed in the tab");

  await runCommand(session.page, "MindStream: Quick Note");
  await answerDialog(session.page, "Cancel");

  await expect(sidebar.locator("#f-desc")).toHaveValue("typed in the tab");
  await expect(sidebar.locator("#modal-title")).toHaveText("Edit note");
});
