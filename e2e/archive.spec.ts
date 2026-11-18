/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as fs from "node:fs";
import type { Frame } from "@playwright/test";
import { buildData, expect, notification, readData, showSidebar, test, waitForData } from "./helpers";

// Archived notes are read-only: no status change, no edit, no task check.
// Viewing, unarchiving, and deleting stay possible.

const tasks = () => [
  { title: "Write the notes", completed: true },
  { title: "Publish", completed: false },
];

function card(sidebar: Frame, title: string) {
  return sidebar.locator(".card", { hasText: title });
}

// The webview's DOM types are not part of this project's tsconfig.
type Styler = (el: object) => { cursor: string };

/** The element's computed mouse cursor, read inside the webview. */
function cursorOf(el: object): string {
  return (globalThis as unknown as { getComputedStyle: Styler }).getComputedStyle(el).cursor;
}

test("an archived card shows its status as a plain badge and has no Edit button", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Active note" }, { title: "Frozen note", status: "in-progress", archived: true }]) });
  const sidebar = await showSidebar(session.page);
  await sidebar.locator("#btn-archive-toggle").click();
  const frozen = card(sidebar, "Frozen note");
  await expect(frozen).toHaveClass(/archived/);

  const status = frozen.locator(".card-footer .status");
  await expect(status).not.toHaveAttribute("data-tooltip");
  expect(await status.evaluate(cursorOf)).toBe("default");
  await status.click();
  await status.click({ modifiers: ["Control"] });
  // Give a wrongly sent change time to reach the file before checking it.
  await session.page.waitForTimeout(500);
  expect(readData(session).items[1].status).toBe("in-progress");

  await expect(frozen.locator('[data-tooltip="Edit"]')).toHaveCount(0);
  // Present (shown only when the card overflows); a double-click also opens the viewer.
  await expect(frozen.locator('[data-tooltip="View note"]')).toHaveCount(1);
  await expect(frozen.locator('[data-tooltip="Unarchive"]')).toBeVisible();
  await expect(frozen.locator('[data-tooltip="Delete permanently"]')).toBeVisible();

  // An active card is unchanged: a clickable status and an Edit button.
  const active = card(sidebar, "Active note");
  await expect(active.locator(".card-footer .status")).toHaveAttribute("data-tooltip", /Change status/);
  expect(await active.locator(".card-footer .status").evaluate(cursorOf)).toBe("pointer");
  await expect(active.locator('[data-tooltip="Edit"]')).toBeVisible();
});

test("the viewer of an archived note has no Edit button and its tasks cannot be checked", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Frozen release", tasks: tasks(), archived: true }]) });
  const sidebar = await showSidebar(session.page);
  await sidebar.locator("#btn-archive-toggle").click();
  await card(sidebar, "Frozen release").dblclick();

  const viewer = sidebar.locator("#view-modal");
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("#view-edit")).toBeHidden();
  await expect(viewer.locator("#view-tasks-list")).toHaveClass(/read-only/);
  const rows = viewer.locator("#view-tasks-list .task-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).locator(".task-check")).toBeDisabled();
  await expect(rows.nth(1).locator(".task-check")).not.toHaveAttribute("data-tooltip");
  await expect(rows.nth(1).locator(".task-check")).toHaveAttribute("aria-checked", "false");

  await rows.nth(1).locator(".task-title").click();
  await session.page.waitForTimeout(500);
  await expect(rows.nth(1).locator(".task-check")).toHaveAttribute("aria-checked", "false");
  expect(readData(session).items[0].tasks?.map((t) => t.completed)).toEqual([true, false]);
});

test("unarchiving makes the note editable again", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Frozen note", archived: true }]) });
  const sidebar = await showSidebar(session.page);
  await sidebar.locator("#btn-archive-toggle").click();
  const note = card(sidebar, "Frozen note");

  await note.locator('[data-tooltip="Unarchive"]').click();
  await waitForData(session, (d) => d.items[0].archived === false);
  await expect(note).not.toHaveClass(/archived/);
  await expect(note.locator('[data-tooltip="Edit"]')).toBeVisible();

  await note.locator(".card-footer .status").click();
  await waitForData(session, (d) => d.items[0].status === "in-progress");
});

test("a note archived elsewhere while its editor is open is not saved, and the editor stays open until Cancel", async ({ launch }) => {
  const data = buildData([{ title: "Draft note" }]);
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  await card(sidebar, "Draft note").locator('[data-tooltip="Edit"]').click();
  await expect(sidebar.locator("#modal")).toBeVisible();
  await sidebar.locator("#f-title").fill("Typed while it was archived");

  // Archived from outside VS Code (another window, git, a hand edit).
  data.items[0].archived = true;
  data.items[0].archivedAt = "2026-11-02T10:00:00.000Z";
  fs.writeFileSync(session.dataFile, JSON.stringify(data, null, 2), "utf8");
  await expect(card(sidebar, "Draft note")).toHaveCount(0);

  await sidebar.locator("#modal-save").click();
  await expect(notification(session.page, /is archived, and archived notes are read-only/)).toBeVisible();
  // Refused: nothing is written, and the editor keeps what was typed.
  await expect(sidebar.locator("#modal")).toBeVisible();
  await expect(sidebar.locator("#f-title")).toHaveValue("Typed while it was archived");
  await expect(sidebar.locator("#modal-save")).toBeEnabled();
  const saved = readData(session).items[0];
  expect(saved.title).toBe("Draft note");
  expect(saved.archived).toBe(true);

  // Only the user's Cancel closes it.
  await sidebar.locator("#modal-cancel").click();
  await expect(sidebar.locator("#modal")).toBeHidden();
  expect(readData(session).items[0].title).toBe("Draft note");
});
