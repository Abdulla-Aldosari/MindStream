/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import type { Page } from "@playwright/test";
import { answerDialog, buildData, dialog, expect, readData, runCommand, showSidebar, test, waitForData } from "./helpers";

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

/** Replaces the text of the focused editor tab without saving it. */
async function typeInTab(page: Page, text: string): Promise<void> {
  await page.locator(".editor-instance .monaco-editor").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(text);
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
  await expect(sidebar.locator("#f-desc-external-hint")).toBeVisible();
  await expect(sidebar.locator("#f-desc-external")).toBeVisible();
  await expect(sidebar.locator("#f-desc-external")).toHaveAttribute("aria-pressed", "true");

  await typeInTabAndSave(session.page, longText);
  await expect(sidebar.locator("#f-desc")).toHaveValue(longText);
  // A save in the tab never writes the data file.
  expect(readData(session).items[0].description).toBe("short");

  await sidebar.locator("#modal-save").click();
  await expect(sidebar.locator("#modal")).toBeHidden();
  await expect(descriptionTab(session.page, "Big note.md")).toHaveCount(0);
  await waitForData(session, (d) => d.items[0].description === longText);
});

test("closing the note with changes asks first; Discard closes the tab and the text is never stored", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Cancelled", description: "original" }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Cancelled" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#f-desc-external").click();
  await expect(descriptionTab(session.page, "Cancelled.md")).toBeVisible();
  await typeInTabAndSave(session.page, "edited in the tab");
  await expect(sidebar.locator("#f-desc")).toHaveValue("edited in the tab");

  await sidebar.locator("#modal-cancel").click();
  // Cancel in the question keeps the form, the tab, and the text.
  await answerDialog(session.page, "Cancel");
  await expect(sidebar.locator("#modal")).toBeVisible();
  await expect(descriptionTab(session.page, "Cancelled.md")).toBeVisible();
  await expect(sidebar.locator("#f-desc")).toHaveValue("edited in the tab");

  await sidebar.locator("#modal-cancel").click();
  await answerDialog(session.page, "Discard");
  await expect(sidebar.locator("#modal")).toBeHidden();
  await expect(descriptionTab(session.page, "Cancelled.md")).toHaveCount(0);
  expect(readData(session).items[0].description).toBe("original");
});

test("closing the note with changes can save them from the question", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Saved on close", description: "original" }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Saved on close" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#f-desc-external").click();
  await typeInTab(session.page, "written but never saved in the tab");

  await sidebar.locator("#modal-close").click();
  await answerDialog(session.page, "Save");
  await expect(sidebar.locator("#modal")).toBeHidden();
  await expect(descriptionTab(session.page, "Saved on close.md")).toHaveCount(0);
  await waitForData(session, (d) => d.items[0].description === "written but never saved in the tab");
});

test("closing the note without changes needs no question", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Untouched", description: "same" }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Untouched" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#modal-cancel").click();
  await expect(sidebar.locator("#modal")).toBeHidden();
  await expect(dialog(session.page)).toHaveCount(0);
});

test("a change to the title alone also asks before the note closes", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Old title" }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Old title" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#f-title").fill("New title");
  await sidebar.locator("#modal-cancel").click();
  await answerDialog(session.page, "Discard");
  await expect(sidebar.locator("#modal")).toBeHidden();
  expect(readData(session).items[0].title).toBe("Old title");
});

test("noteForm.onCloseWithChanges = discard closes the note without asking", async ({ launch }) => {
  const session = await launch({
    data: buildData([{ title: "Quick leave", description: "original" }]),
    settings: { "mindstream.noteForm.onCloseWithChanges": "discard" },
  });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Quick leave" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#f-desc-external").click();
  await typeInTab(session.page, "gone");
  await sidebar.locator("#modal-cancel").click();
  await expect(sidebar.locator("#modal")).toBeHidden();
  await expect(dialog(session.page)).toHaveCount(0);
  await expect(descriptionTab(session.page, "Quick leave.md")).toHaveCount(0);
  expect(readData(session).items[0].description).toBe("original");
});

test("closing the tab with unsaved edits keeps them in the form and shows no question (default)", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Silent keep", description: "start" }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Silent keep" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#f-desc-external").click();
  await expect(descriptionTab(session.page, "Silent keep.md")).toBeVisible();
  // Typed, never saved with Ctrl+S: the tab saves itself, so it never stays "modified".
  await typeInTab(session.page, "typed and closed at once");

  await runCommand(session.page, "View: Close Editor");
  await expect(dialog(session.page)).toHaveCount(0);
  await expect(descriptionTab(session.page, "Silent keep.md")).toHaveCount(0);
  await expect(sidebar.locator("#f-desc")).toHaveValue("typed and closed at once");
  await expect(sidebar.locator("#f-desc")).toHaveJSProperty("readOnly", false);
  // The data file is untouched until the note's own Save.
  expect(readData(session).items[0].description).toBe("start");

  await sidebar.locator("#modal-save").click();
  await waitForData(session, (d) => d.items[0].description === "typed and closed at once");
});

test("keep: every edit is saved by itself, not every other one", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Every edit", description: "start" }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Every edit" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#f-desc-external").click();
  const tab = descriptionTab(session.page, "Every edit.md");
  await expect(tab).toBeVisible();
  await session.page.locator(".editor-instance .monaco-editor").first().click();
  await session.page.keyboard.press("Control+End");

  for (let i = 1; i <= 8; i++) {
    await session.page.keyboard.insertText(" ");
    // Saved by itself: the tab is not left "modified".
    try {
      await expect(tab).not.toHaveClass(/dirty/, { timeout: 3000 });
    } catch (err) {
      const toasts = await session.page
        .locator(".notifications-toasts")
        .innerText()
        .catch(() => "");
      throw new Error(`edit ${i} left the tab modified. Notifications: ${toasts}`, { cause: err });
    }
  }
});

test("descriptionTab.onClose = ask shows VS Code's question; Don't Save drops the unsaved edits", async ({ launch }) => {
  const session = await launch({
    data: buildData([{ title: "Ask on tab", description: "start" }]),
    settings: { "mindstream.descriptionTab.onClose": "ask" },
  });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Ask on tab" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await sidebar.locator("#f-desc-external").click();
  await typeInTab(session.page, "not saved in the tab");

  await runCommand(session.page, "View: Close Editor");
  await answerDialog(session.page, "Don't Save");
  await expect(descriptionTab(session.page, "Ask on tab.md")).toHaveCount(0);
  await expect(sidebar.locator("#f-desc")).toHaveValue("start");
  await expect(sidebar.locator("#f-desc")).toHaveJSProperty("readOnly", false);
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
  await expect(sidebar.locator("#f-desc-external")).toHaveAttribute("aria-pressed", "false");
  await expect(sidebar.locator("#f-desc-external-hint")).toBeHidden();
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
