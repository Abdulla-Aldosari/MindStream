/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { buildData, expect, readData, showSidebar, test, waitForData } from "./helpers";

test("a new note is created from the editor and written to the data file", async ({ launch }) => {
  const session = await launch();
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".empty-create-btn").click();
  await expect(sidebar.locator("#modal")).toBeVisible();
  await sidebar.locator("#f-title").fill("Check the release build");
  await sidebar.locator("#f-desc").fill("Run it on a clean machine");
  await sidebar.locator("#modal-save").click();

  await expect(sidebar.locator("#modal")).toBeHidden();
  const card = sidebar.locator(".card", { hasText: "Check the release build" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Run it on a clean machine");

  await waitForData(session, (d) => d.items.some((n) => n.title === "Check the release build"));
  const saved = readData(session).items[0];
  expect(saved.description).toBe("Run it on a clean machine");
  expect(saved.status).toBe("pending");
  expect(saved.priority).toBe("low");
});

test("saving needs a title: the editor stays open and nothing is written", async ({ launch }) => {
  const session = await launch();
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".empty-create-btn").click();
  await sidebar.locator("#modal-save").click();

  await expect(sidebar.locator("#modal")).toBeVisible();
  await expect(sidebar.locator(".card")).toHaveCount(0);
});

test("the editor card stays inside the window even when the description is huge", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Big desc" }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Big desc" }).dblclick();
  await sidebar.locator("#view-edit").click();

  // The drag ceiling is applied when the editor opens.
  const cap = await sidebar.locator("#f-desc").evaluate((el) => parseFloat(el.style.maxHeight));
  expect(cap).toBeGreaterThanOrEqual(55);

  // Force the description far taller than any window; its max-height must clamp
  // it so the card never leaves the viewport (no hidden header or buttons).
  await sidebar.locator("#f-desc").evaluate((el) => {
    el.style.height = "9000px";
  });
  const modalHeight = await sidebar.locator("#modal").evaluate((el) => el.clientHeight);
  const box = await sidebar.locator("#modal .modal-card").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  });
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(modalHeight + 0.5);
});

test("clicking the status moves a note through the cycle and records the completion time", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Cycle me" }]) });
  const sidebar = await showSidebar(session.page);
  const status = sidebar.locator(".card", { hasText: "Cycle me" }).locator(".status");

  await expect(status).toHaveText("None");
  await status.click();
  await expect(status).toHaveText("In Progress");
  await status.click();
  await expect(status).toHaveText("Done");

  await waitForData(session, (d) => d.items[0].status === "done");
  expect(readData(session).items[0].completedAt).toBeTruthy();
});

test("only Ctrl+Shift+Click moves a note into and out of Canceled", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Dropped idea", status: "in-progress" }]) });
  const sidebar = await showSidebar(session.page);
  const card = sidebar.locator(".card", { hasText: "Dropped idea" });
  const status = card.locator(".status");

  await status.click({ modifiers: ["Control", "Shift"] });
  await expect(status).toHaveText("Canceled");
  await expect(card).toHaveClass(/(^|\s)canceled(\s|$)/);
  await expect(status).toHaveClass(/(^|\s)canceled(\s|$)/);
  await waitForData(session, (d) => d.items[0].status === "canceled");
  const canceled = readData(session).items[0];
  expect(canceled.canceledAt).toBeTruthy();
  expect(canceled.completedAt).toBeUndefined();

  // The canceled colors apply to the title and the status badge.
  // The e2e project has no DOM typings, so the page APIs are typed locally.
  type Probe = { style: { color: string }; remove(): void };
  type Page = { getComputedStyle(el: object): { color: string }; document: { createElement(tag: string): Probe } };
  const colors = await card.evaluate((node) => {
    const el = node as unknown as { querySelector(selector: string): object; appendChild(child: object): void };
    const page = globalThis as unknown as Page;
    const probe = page.document.createElement("span");
    probe.style.color = "var(--ms-status-canceled-color)";
    el.appendChild(probe);
    const expected = page.getComputedStyle(probe).color;
    probe.remove();
    return {
      title: page.getComputedStyle(el.querySelector(".card-title")).color,
      badge: page.getComputedStyle(el.querySelector(".status")).color,
      expected,
    };
  });
  // The variable resolves to a red tone (an undefined variable would only
  // inherit). A color-mix() result reads as "color(srgb r g b)" with 0-1
  // channels, so the channels are compared as ratios, not absolute values.
  const [red, green, blue] = (colors.expected.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  expect(red).toBeGreaterThan(green * 1.5);
  expect(red).toBeGreaterThan(blue * 1.5);
  expect(colors.title).toBe(colors.expected);
  expect(colors.badge).toBe(colors.expected);

  // A plain click or Ctrl+Click leaves a canceled note as it is.
  await status.click();
  await status.click({ modifiers: ["Control"] });
  await expect(status).toHaveText("Canceled");
  expect(readData(session).items[0].status).toBe("canceled");

  // Ctrl+Shift+Click again brings it back to None.
  await status.click({ modifiers: ["Control", "Shift"] });
  await expect(status).toHaveText("None");
  await expect(card).not.toHaveClass(/(^|\s)canceled(\s|$)/);
  await waitForData(session, (d) => d.items[0].status === "pending");
  expect(readData(session).items[0].canceledAt).toBeUndefined();
});

test("the Canceled group appears only while it has notes", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Keep" }, { title: "Drop" }]) });
  const sidebar = await showSidebar(session.page);
  const canceledGroup = sidebar.locator('.group-header[data-group="status:canceled"]');

  await expect(sidebar.locator('.group-header[data-group="status:done"]')).toBeVisible();
  await expect(canceledGroup).toHaveCount(0);
  await sidebar
    .locator(".card", { hasText: "Drop" })
    .locator(".status")
    .click({ modifiers: ["Control", "Shift"] });
  await expect(canceledGroup).toBeVisible();
  await expect(canceledGroup).toContainText("Canceled");
  await expect(canceledGroup).toContainText("(1)");
});

test("editing a note changes it in place and keeps its id", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Old title" }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Old title" }).dblclick();
  await expect(sidebar.locator("#view-modal")).toBeVisible();
  await sidebar.locator("#view-edit").click();
  await expect(sidebar.locator("#modal-title")).toHaveText("Edit note");
  await sidebar.locator("#f-title").fill("New title");
  await sidebar.locator("#modal-save").click();

  await expect(sidebar.locator("#modal")).toBeHidden();
  await expect(sidebar.locator(".card", { hasText: "New title" })).toBeVisible();
  await waitForData(session, (d) => d.items[0].title === "New title");
  expect(readData(session).items).toHaveLength(1);
  expect(readData(session).items[0].id).toBe("seed-1");
});
