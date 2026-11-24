/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as fs from "node:fs";
import { buildData, clickMoreMenuItem, expect, expectCommandHidden, notification, readData, runCommand, showSidebar, test, waitForData } from "./helpers";

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

test("a paused project opens locked, even after a restart", async ({ launch }) => {
  const data = buildData([{ title: "Behind the lock" }]);
  data.workPauseNote = { text: "Pick up at the storage tests.", updatedAt: "2026-11-01T10:00:00.000Z", paused: true };
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  await expect(sidebar.locator("body")).toHaveClass(/work-pause-locked/);
  await expect(sidebar.locator("#work-pause-view")).toContainText("Pick up at the storage tests.");
});
