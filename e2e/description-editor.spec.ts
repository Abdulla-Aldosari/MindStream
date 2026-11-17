/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import type { Page } from "@playwright/test";
import { buildData, expect, readData, runCommand, showSidebar, test, waitForData } from "./helpers";

/** The VS Code editor tab of a note's description (its file name is the note title). */
function descriptionTab(page: Page, fileName: string) {
  return page.locator(`.tabs-container .tab[aria-label*="${fileName}"]`);
}

/** Replaces the text of the focused editor tab and saves it. */
async function typeInTabAndSave(page: Page, text: string): Promise<void> {
  await page.locator(".editor-instance .monaco-editor").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(text);
  await page.keyboard.press("Control+S");
}

const longText = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a very long description`).join("\n");

test("the description opens in an editor tab, a save there updates the form, and the note's Save stores it", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Big note", description: "short" }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Big note" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#f-desc-external").click();

  await expect(descriptionTab(session.page, "Big note.md")).toBeVisible();
  // The textarea only mirrors the tab while it is open.
  await expect(sidebar.locator("#f-desc")).toHaveJSProperty("readOnly", true);
  await expect(sidebar.locator("#f-desc-external-note")).toBeVisible();

  await typeInTabAndSave(session.page, longText);
  await expect(sidebar.locator("#f-desc")).toHaveValue(longText);
  // A save in the tab never writes the data file.
  expect(readData(session).items[0].description).toBe("short");

  await sidebar.locator("#modal-save").click();
  await expect(sidebar.locator("#modal")).toBeHidden();
  await expect(descriptionTab(session.page, "Big note.md")).toHaveCount(0);
  await waitForData(session, (d) => d.items[0].description === longText);
});

test("closing the note closes the description tab, and the discarded text is never stored", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Cancelled", description: "original" }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Cancelled" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#f-desc-external").click();
  await expect(descriptionTab(session.page, "Cancelled.md")).toBeVisible();
  await typeInTabAndSave(session.page, "edited in the tab");
  await expect(sidebar.locator("#f-desc")).toHaveValue("edited in the tab");

  await sidebar.locator("#modal-cancel").click();
  await expect(sidebar.locator("#modal")).toBeHidden();
  await expect(descriptionTab(session.page, "Cancelled.md")).toHaveCount(0);
  expect(readData(session).items[0].description).toBe("original");
});

test("closing the tab by hand makes the description editable again with the latest text", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Manual close", description: "start" }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Manual close" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#f-desc-external").click();
  await expect(descriptionTab(session.page, "Manual close.md")).toBeVisible();
  await typeInTabAndSave(session.page, "kept after closing");

  await runCommand(session.page, "View: Close Editor");
  await expect(descriptionTab(session.page, "Manual close.md")).toHaveCount(0);
  await expect(sidebar.locator("#f-desc")).toHaveJSProperty("readOnly", false);
  await expect(sidebar.locator("#f-desc")).toHaveValue("kept after closing");
  await expect(sidebar.locator("#f-desc-external")).toBeVisible();
  await expect(sidebar.locator("#modal")).toBeVisible();
});

test("a new note's description can be written in the tab too", async ({ launch }) => {
  const session = await launch();
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".empty-create-btn").click();
  await sidebar.locator("#f-title").fill("Fresh idea");
  await sidebar.locator("#f-desc-external").click();
  await expect(descriptionTab(session.page, "Fresh idea.md")).toBeVisible();
  await typeInTabAndSave(session.page, longText);

  await sidebar.locator("#modal-save").click();
  await expect(sidebar.locator("#modal")).toBeHidden();
  await waitForData(session, (d) => d.items.some((n) => n.title === "Fresh idea" && n.description === longText));
});

test("pausing work closes the description tab", async ({ launch }) => {
  const data = buildData([{ title: "Paused edit", description: "x" }]);
  data.workPauseNote = { text: "Back soon.", updatedAt: "2026-11-01T10:00:00.000Z", paused: false };
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Paused edit" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#f-desc-external").click();
  await expect(descriptionTab(session.page, "Paused edit.md")).toBeVisible();

  await runCommand(session.page, "MindStream: Pause work and show note");
  await expect(sidebar.locator("body")).toHaveClass(/work-pause-locked/);
  await expect(descriptionTab(session.page, "Paused edit.md")).toHaveCount(0);
});
