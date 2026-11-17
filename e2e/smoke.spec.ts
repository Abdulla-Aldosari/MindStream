/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { buildData, expect, showSidebar, test } from "./helpers";

test("the extension activates and the sidebar shows the empty state", async ({ launch }) => {
  const { page } = await launch();
  const sidebar = await showSidebar(page);

  await expect(sidebar.locator("#toolbar")).toBeVisible();
  await expect(sidebar.locator("#empty")).toContainText("Looks like there are no notes yet.");
  await expect(sidebar.locator(".card")).toHaveCount(0);
});

test("notes from the data file are shown as cards with their status", async ({ launch }) => {
  const { page } = await launch({
    data: buildData([
      { title: "Fix login redirect", status: "in-progress", priority: "critical" },
      { title: "Write release notes", description: "Before the next tag", priority: "low" },
      { title: "Refactor storage", status: "done" },
    ]),
  });
  const sidebar = await showSidebar(page);

  await expect(sidebar.locator(".card")).toHaveCount(3);
  await expect(sidebar.locator(".card", { hasText: "Fix login redirect" }).locator(".status")).toHaveText("In Progress");
  await expect(sidebar.locator(".card", { hasText: "Write release notes" })).toContainText("Before the next tag");
  await expect(sidebar.locator(".card", { hasText: "Refactor storage" }).locator(".status")).toHaveText("Done");
  await expect(sidebar.locator("#empty")).toBeHidden();
});
