/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as fs from "node:fs";
import { answerDialog, buildData, expect, notification, readData, runCommand, showSidebar, test, waitForData } from "./helpers";

test("a note changed elsewhere while its form is open is flagged, and Save is refused without losing what was typed", async ({ launch }) => {
  const data = buildData([{ title: "Fix save", description: "Line 40" }]);
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Fix save" }).locator('[data-tooltip="Edit"]').click();
  await expect(sidebar.locator("#modal")).toBeVisible();
  await expect(sidebar.locator("#f-changed-notice")).toBeHidden();
  await sidebar.locator("#f-title").fill("Fix the save");

  // Another writer (an agent, another window) adds to the description meanwhile.
  data.items[0].description = "Line 40\n\nCause: the file is locked.";
  data.items[0].updatedAt = "2026-11-02T10:00:00.000Z";
  fs.writeFileSync(session.dataFile, JSON.stringify(data, null, 2), "utf8");

  // The form warns before Save.
  await expect(sidebar.locator("#f-changed-notice")).toBeVisible();
  await expect(sidebar.locator("#f-changed-notice")).toContainText("changed elsewhere (description)");

  await sidebar.locator("#modal-save").click();
  await expect(notification(session.page, /changed elsewhere after you opened it \(description\)/)).toBeVisible();
  // Refused: the other writer's text is kept, and the form keeps what was typed.
  await expect(sidebar.locator("#modal")).toBeVisible();
  await expect(sidebar.locator("#f-title")).toHaveValue("Fix the save");
  await expect(sidebar.locator("#modal-save")).toBeEnabled();
  const saved = readData(session).items[0];
  expect(saved.title).toBe("Fix save");
  expect(saved.description).toBe("Line 40\n\nCause: the file is locked.");

  // Opening the note again starts from the current content, and Save works.
  await sidebar.locator("#modal-cancel").click();
  await answerDialog(session.page, "Discard");
  await sidebar.locator(".card", { hasText: "Fix save" }).locator('[data-tooltip="Edit"]').click();
  await expect(sidebar.locator("#f-desc")).toHaveValue("Line 40\n\nCause: the file is locked.");
  await sidebar.locator("#f-title").fill("Fix the save");
  await sidebar.locator("#modal-save").click();
  await expect(sidebar.locator("#modal")).toBeHidden();
  await waitForData(session, (d) => d.items[0].title === "Fix the save" && d.items[0].description === "Line 40\n\nCause: the file is locked.");
});

test("a status changed elsewhere does not block saving the note form", async ({ launch }) => {
  const data = buildData([{ title: "Status moves" }]);
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Status moves" }).locator('[data-tooltip="Edit"]').click();
  await sidebar.locator("#f-title").fill("Status moved");
  data.items[0].status = "in-progress";
  fs.writeFileSync(session.dataFile, JSON.stringify(data, null, 2), "utf8");
  await expect(sidebar.locator(".card .status", { hasText: "In Progress" })).toBeVisible();
  await expect(sidebar.locator("#f-changed-notice")).toBeHidden();

  await sidebar.locator("#modal-save").click();
  await expect(sidebar.locator("#modal")).toBeHidden();
  await waitForData(session, (d) => d.items[0].title === "Status moved" && d.items[0].status === "in-progress");
});

test("a category name already in use is refused with the reason, and nothing is added", async ({ launch }) => {
  const session = await launch({ data: buildData([]) });
  const sidebar = await showSidebar(session.page);

  await runCommand(session.page, "MindStream: Manage Categories");
  await expect(sidebar.locator("#categories-modal")).toBeVisible();
  await sidebar.locator("#f-category-name").fill("general");
  await sidebar.locator("#btn-add-category").click();

  await expect(notification(session.page, /a category named "General" already exists/)).toBeVisible();
  expect(readData(session).categories).toHaveLength(1);
});
