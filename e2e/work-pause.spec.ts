/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as fs from "node:fs";
import { answerDialog, buildData, clickMoreMenuItem, expect, expectCommandHidden, notification, readData, runCommand, showSidebar, test, waitForData } from "./helpers";

test("pausing work locks the sidebar behind the hand-off note, and resuming unlocks it", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "A note" }]) });
  const sidebar = await showSidebar(session.page);
  await expect(sidebar.locator(".card")).toHaveCount(1);

  // With no saved note, "Pause work" opens the editor first.
  await runCommand(session.page, "MindStream: Pause work and show note");
  await expect(sidebar.locator("#work-pause-input")).toBeVisible();
  await sidebar.locator("#work-pause-input").fill("Stopped before the release build. Next: run the checks.");
  await sidebar.locator("#work-pause-save").click();

  await expect(sidebar.locator("body")).toHaveClass(/work-pause-locked/);
  await expect(sidebar.locator("#work-pause-view")).toContainText("Stopped before the release build");
  await waitForData(session, (d) => d.workPauseNote?.paused === true);
  expect(readData(session).workPauseNote?.text).toContain("run the checks");

  // The lock is on the commands too: with work paused, creating a note does nothing.
  await expectCommandHidden(session.page, "MindStream: Quick Note");
  await expect(sidebar.locator("#modal")).toBeHidden();

  // The only way out is the More menu: the resume command is hidden from the palette on purpose.
  await clickMoreMenuItem(session.page, "Work paused - click to resume");
  await expect(sidebar.locator("body")).not.toHaveClass(/work-pause-locked/);
  await expect(sidebar.locator(".card")).toHaveCount(1);
  await waitForData(session, (d) => d.workPauseNote?.paused === false);
});

test("a Work Pause note changed elsewhere while it is edited is not overwritten, and the draft stays open", async ({ launch }) => {
  const data = buildData([{ title: "A note" }]);
  data.workPauseNote = { text: "Stopped at the storage tests.", updatedAt: "2026-11-01T10:00:00.000Z", paused: true };
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator("#work-pause-edit").click();
  await sidebar.locator("#work-pause-input").fill("My new hand-off text.");

  // Written elsewhere (another window, git) while the panel is editing.
  data.workPauseNote = { text: "Written in another window.", updatedAt: "2026-11-02T10:00:00.000Z", paused: true };
  fs.writeFileSync(session.dataFile, JSON.stringify(data, null, 2), "utf8");

  await sidebar.locator("#work-pause-save").click();
  await expect(notification(session.page, /Work Pause note was changed elsewhere/)).toBeVisible();
  await expect(sidebar.locator("#work-pause-input")).toBeVisible();
  await expect(sidebar.locator("#work-pause-input")).toHaveValue("My new hand-off text.");
  expect(readData(session).workPauseNote?.text).toBe("Written in another window.");
});

test("pausing with a note from an earlier break opens it in the editor with the choice to start a new one", async ({ launch }) => {
  const data = buildData([{ title: "A note" }]);
  data.workPauseNote = { text: "Old break: finish the importer.", updatedAt: "2026-09-01T10:00:00.000Z", paused: false };
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  // Never locked at once: the earlier note is shown in the editor first.
  await runCommand(session.page, "MindStream: Pause work and show note");
  await expect(sidebar.locator("#work-pause-input")).toHaveValue("Old break: finish the importer.");
  await expect(sidebar.locator("#work-pause-earlier")).toBeVisible();
  await expect(sidebar.locator("#work-pause-earlier-text")).toContainText("earlier break");
  await expect(sidebar.locator("#work-pause-earlier-text")).toHaveText(
    /^This note is from \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} (?:AM|PM) \(\d+ days ago\)\. It was written for an earlier break\.$/
  );
  await expect(sidebar.locator("#work-pause-hint")).toContainText("Saving pauses work");
  await expect(sidebar.locator("body")).not.toHaveClass(/work-pause-locked/);

  // "Start a new note" empties the editor only; Cancel leaves the saved note as it was.
  await sidebar.locator("#work-pause-fresh").click();
  await expect(sidebar.locator("#work-pause-input")).toHaveValue("");
  await expect(sidebar.locator("#work-pause-earlier")).toBeHidden();
  await sidebar.locator("#work-pause-cancel").click();
  await expect(sidebar.locator("#work-pause")).toBeHidden();
  await expect(sidebar.locator(".card")).toHaveCount(1);
  expect(readData(session).workPauseNote).toEqual(data.workPauseNote);

  // "Keep it" then Save locks with the earlier text.
  await runCommand(session.page, "MindStream: Pause work and show note");
  await sidebar.locator("#work-pause-keep").click();
  await expect(sidebar.locator("#work-pause-earlier")).toBeHidden();
  await sidebar.locator("#work-pause-save").click();
  await expect(sidebar.locator("body")).toHaveClass(/work-pause-locked/);
  await waitForData(session, (d) => d.workPauseNote?.paused === true && d.workPauseNote.text === "Old break: finish the importer.");

  // A new note replaces the earlier one.
  await sidebar.locator("#work-pause-resume").click();
  await waitForData(session, (d) => d.workPauseNote?.paused === false);
  await runCommand(session.page, "MindStream: Pause work and show note");
  await sidebar.locator("#work-pause-fresh").click();
  await sidebar.locator("#work-pause-input").fill("New break: review the tests.");
  await sidebar.locator("#work-pause-save").click();
  await expect(sidebar.locator("#work-pause-view")).toContainText("New break: review the tests.");
  await waitForData(session, (d) => d.workPauseNote?.paused === true && d.workPauseNote.text === "New break: review the tests.");
});

test("Resume work on the note unlocks and keeps the note", async ({ launch }) => {
  const data = buildData([{ title: "Behind the lock" }]);
  data.workPauseNote = { text: "Pick up at the storage tests.", updatedAt: "2026-11-01T10:00:00.000Z", paused: true };
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  await expect(sidebar.locator("#work-pause-updated")).toContainText("days ago");
  await expect(sidebar.locator("#work-pause-updated")).toHaveText(/^Updated: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} (?:AM|PM) \(\d+ days ago\)$/);
  await sidebar.locator("#work-pause-resume").click();
  await expect(sidebar.locator("body")).not.toHaveClass(/work-pause-locked/);
  await expect(sidebar.locator(".card")).toHaveCount(1);
  await waitForData(session, (d) => d.workPauseNote?.paused === false && d.workPauseNote.text === "Pick up at the storage tests.");
});

test("Delete & resume asks first; Cancel keeps everything, Delete removes the note and unlocks", async ({ launch }) => {
  const data = buildData([{ title: "Behind the lock" }]);
  data.workPauseNote = { text: "Done with this one.", updatedAt: "2026-11-01T10:00:00.000Z", paused: true };
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator("#work-pause-delete").click();
  await answerDialog(session.page, "Cancel");
  await expect(sidebar.locator("body")).toHaveClass(/work-pause-locked/);
  expect(readData(session).workPauseNote).toEqual(data.workPauseNote);

  await sidebar.locator("#work-pause-delete").click();
  await answerDialog(session.page, "Delete and Resume");
  await expect(sidebar.locator("body")).not.toHaveClass(/work-pause-locked/);
  await expect(sidebar.locator(".card")).toHaveCount(1);
  await waitForData(session, (d) => d.workPauseNote === undefined);
});

test("the note opens as one read-only editor tab that stays after resuming and is refreshed by opening it again", async ({ launch }) => {
  const data = buildData([{ title: "A note" }]);
  data.workPauseNote = { text: "First text of the note.", updatedAt: "2026-11-01T10:00:00.000Z", paused: true };
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);
  const tab = session.page.locator('.tabs-container .tab[aria-label*="Work Pause note.md"]');
  const editorText = session.page.locator(".editor-instance .view-lines").first();

  await sidebar.locator("#work-pause-open").click();
  await expect(tab).toHaveCount(1);
  await expect(editorText).toContainText("First text of the note.");

  // Opening again never adds a second tab.
  await sidebar.locator("#work-pause-open").click();
  await expect(tab).toHaveCount(1);

  // A snapshot: editing the note does not change the open tab until it is opened again.
  await sidebar.locator("#work-pause-edit").click();
  await sidebar.locator("#work-pause-input").fill("Second text of the note.");
  await sidebar.locator("#work-pause-save").click();
  await expect(sidebar.locator("#work-pause-view")).toContainText("Second text of the note.");
  await expect(editorText).toContainText("First text of the note.");
  await sidebar.locator("#work-pause-open").click();
  await expect(tab).toHaveCount(1);
  await expect(editorText).toContainText("Second text of the note.");

  // Read-only: typing changes nothing.
  await editorText.click();
  await session.page.keyboard.insertText("typed");
  await expect(editorText).not.toContainText("typed");

  // The tab stays at hand after resuming; nothing was written by it.
  await sidebar.locator("#work-pause-resume").click();
  await expect(sidebar.locator("body")).not.toHaveClass(/work-pause-locked/);
  await expect(tab).toHaveCount(1);
  await waitForData(session, (d) => d.workPauseNote?.text === "Second text of the note." && d.workPauseNote.paused === false);
});

test("Copy note puts the stored note on the clipboard", async ({ launch }) => {
  const data = buildData();
  data.workPauseNote = { text: "Copy me, please.", updatedAt: "2026-11-01T10:00:00.000Z", paused: true };
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator("#work-pause-copy").click();
  await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe("Copy me, please.");
});

test("while editing, the preview toggle shows the draft formatted without saving, and back", async ({ launch }) => {
  const data = buildData([{ title: "A note" }]);
  data.workPauseNote = { text: "Saved text.", updatedAt: "2026-11-01T10:00:00.000Z", paused: true };
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);
  const toggle = sidebar.locator("#work-pause-preview-toggle");

  await sidebar.locator("#work-pause-edit").click();
  await sidebar.locator("#work-pause-input").fill("# Draft heading\n- [ ] draft task with `code`");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(sidebar.locator("#work-pause-input")).toBeHidden();
  await expect(sidebar.locator("#work-pause-preview .work-pause-h1")).toHaveText("Draft heading");
  await expect(sidebar.locator("#work-pause-preview .work-pause-check")).toHaveCount(1);
  await expect(sidebar.locator("#work-pause-preview .work-pause-code")).toHaveText("code");
  // Nothing was saved by previewing.
  expect(readData(session).workPauseNote?.text).toBe("Saved text.");

  // Back to editing: the draft is still there and can be changed.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(sidebar.locator("#work-pause-preview")).toBeHidden();
  await expect(sidebar.locator("#work-pause-input")).toHaveValue("# Draft heading\n- [ ] draft task with `code`");

  // Save works from the preview too, and stores the draft.
  await toggle.click();
  await sidebar.locator("#work-pause-save").click();
  await expect(sidebar.locator("#work-pause-view .work-pause-h1")).toHaveText("Draft heading");
  await waitForData(session, (d) => d.workPauseNote?.text === "# Draft heading\n- [ ] draft task with `code`");
});

test("the formatting example opens over the whole sidebar and closes back to the draft", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "A note" }]) });
  const sidebar = await showSidebar(session.page);
  const example = sidebar.locator("#work-pause-example");

  await runCommand(session.page, "MindStream: Pause work and show note");
  await sidebar.locator("#work-pause-input").fill("My draft in progress.");

  await sidebar.locator("#work-pause-example-open").click();
  await expect(example).toBeVisible();
  await expect(sidebar.locator("#work-pause-example-view .work-pause-h1").first()).toBeVisible();
  await expect(sidebar.locator("#work-pause-example-view .work-pause-divider")).toHaveCount(1);
  await expect(sidebar.locator("#work-pause-example-view .work-pause-code").first()).toBeVisible();
  // It covers the whole sidebar.
  const box = await example.boundingBox();
  const page = await sidebar.locator("html").boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(Math.round(page?.width ?? -1));
  expect(Math.round(box?.height ?? 0)).toBe(Math.round(page?.height ?? -1));

  // The source is one click away.
  await sidebar.locator("#work-pause-example-source").click();
  await expect(sidebar.locator("#work-pause-example-raw")).toContainText("# Where I stopped");
  await expect(sidebar.locator("#work-pause-example-view")).toBeHidden();

  // Close returns to the editor with the draft untouched; Esc closes it too.
  await sidebar.locator("#work-pause-example-close").click();
  await expect(example).toBeHidden();
  await expect(sidebar.locator("#work-pause-input")).toHaveValue("My draft in progress.");
  await sidebar.locator("#work-pause-example-open").click();
  await expect(example).toBeVisible();
  await session.page.keyboard.press("Escape");
  await expect(example).toBeHidden();
  // Esc closed only the example, not the editor.
  await expect(sidebar.locator("#work-pause-input")).toHaveValue("My draft in progress.");
  await expect(sidebar.locator("#work-pause-input")).toBeVisible();
});

test("a paused project opens locked, even after a restart", async ({ launch }) => {
  const data = buildData([{ title: "Behind the lock" }]);
  data.workPauseNote = { text: "Pick up at the storage tests.", updatedAt: "2026-11-01T10:00:00.000Z", paused: true };
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  await expect(sidebar.locator("body")).toHaveClass(/work-pause-locked/);
  await expect(sidebar.locator("#work-pause-view")).toContainText("Pick up at the storage tests.");
});
