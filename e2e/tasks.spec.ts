/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { buildData, expect, readData, showSidebar, test, waitForData } from "./helpers";

const releaseTasks = () => [
  { title: "Write the notes", completed: true },
  { title: "Tag the build", completed: false },
  { title: "Publish", completed: false },
];

test("a task group card shows its progress, and the viewer checks tasks in any order", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Release", tasks: releaseTasks() }]) });
  const sidebar = await showSidebar(session.page);
  const card = sidebar.locator(".card", { hasText: "Release" });

  await expect(card.locator(".task-progress")).toHaveAttribute("aria-valuenow", "1");
  await expect(card.locator(".task-progress-label")).toHaveText("1/3");

  await card.dblclick();
  const viewer = sidebar.locator("#view-modal");
  await expect(viewer).toBeVisible();
  const rows = viewer.locator("#view-tasks-list .task-row");
  await expect(rows).toHaveCount(3);
  await expect(viewer.locator(".task-progress-label")).toHaveText("1/3");

  // The last task first: progress counts completed tasks, not their order.
  await rows.nth(2).locator(".task-check").click();
  await expect(rows.nth(2).locator(".task-check")).toHaveAttribute("aria-checked", "true");
  await expect(viewer.locator(".task-progress-label")).toHaveText("2/3");

  await waitForData(session, (d) => d.items[0].tasks?.[2].completed === true);
  const saved = readData(session).items[0];
  expect(saved.tasks?.map((t) => t.completed)).toEqual([true, false, true]);
  expect(saved.status).toBe("pending");
  expect(saved.updatedAt).not.toBe("2026-11-01T10:00:00.000Z");
  await expect(card.locator(".task-progress-label")).toHaveText("2/3");

  // Unchecking works the same way.
  await rows.nth(0).locator(".task-check").click();
  await expect(viewer.locator(".task-progress-label")).toHaveText("1/3");
  await waitForData(session, (d) => d.items[0].tasks?.[0].completed === false);
});

test("clicking anywhere in a viewer task row toggles its check", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Release", tasks: releaseTasks() }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Release" }).dblclick();
  const viewer = sidebar.locator("#view-modal");
  const rows = viewer.locator("#view-tasks-list .task-row");
  await expect(rows).toHaveCount(3);
  await expect(viewer.locator(".task-progress-label")).toHaveText("1/3");

  // Tag the build (index 1) toggles by clicking its title, not the check box.
  await rows.nth(1).locator(".task-title").click();
  await expect(rows.nth(1).locator(".task-check")).toHaveAttribute("aria-checked", "true");
  await expect(viewer.locator(".task-progress-label")).toHaveText("2/3");
  await waitForData(session, (d) => d.items[0].tasks?.[1].completed === true);
});

test("the editor adds, reorders, checks and removes tasks, then saves them in order", async ({ launch }) => {
  const session = await launch();
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".empty-create-btn").click();
  await sidebar.locator("#f-title").fill("Ship it");
  await sidebar.locator("#f-task-add").click();
  const inputs = sidebar.locator("#f-tasks .task-title-input");
  const values = () => inputs.evaluateAll((els) => els.map((el) => (el as unknown as { value: string }).value));
  await expect(inputs).toHaveCount(1);
  await expect(inputs.nth(0)).toBeFocused();

  // Enter adds the next task below and focuses it.
  await inputs.nth(0).fill("First");
  await inputs.nth(0).press("Enter");
  await expect(inputs.nth(1)).toBeFocused();
  await inputs.nth(1).fill("Second");
  await inputs.nth(1).press("Enter");
  await inputs.nth(2).fill("Third");

  // Alt+Up moves "Third" above "Second", keeping focus on it.
  await inputs.nth(2).press("Alt+ArrowUp");
  await expect.poll(values).toEqual(["First", "Third", "Second"]);
  await expect(inputs.nth(1)).toBeFocused();
  await expect(sidebar.locator("#f-tasks .task-seq")).toHaveText(["1.", "2.", "3."]);

  // Remove "First", check "Second".
  await sidebar.locator("#f-tasks .task-row").nth(0).locator(".task-remove").click();
  await expect.poll(values).toEqual(["Third", "Second"]);
  await sidebar.locator("#f-tasks .task-row").nth(1).locator(".task-check").click();

  // No progress bar while editing.
  await expect(sidebar.locator("#modal .task-progress")).toHaveCount(0);

  await sidebar.locator("#modal-save").click();
  await expect(sidebar.locator("#modal")).toBeHidden();

  await waitForData(session, (d) => d.items.some((n) => n.title === "Ship it"));
  expect(readData(session).items[0].tasks).toEqual([
    { title: "Third", completed: false },
    { title: "Second", completed: true },
  ]);
  await expect(sidebar.locator(".card", { hasText: "Ship it" }).locator(".task-progress-label")).toHaveText("1/2");
});

test("removing every task turns a task group back into a regular note", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Release", tasks: releaseTasks() }]) });
  const sidebar = await showSidebar(session.page);
  const card = sidebar.locator(".card", { hasText: "Release" });

  await card.dblclick();
  await sidebar.locator("#view-edit").click();
  const removeButtons = sidebar.locator("#f-tasks .task-remove");
  await expect(removeButtons).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await removeButtons.first().click();
  }
  await expect(removeButtons).toHaveCount(0);
  await sidebar.locator("#modal-save").click();

  await waitForData(session, (d) => !("tasks" in d.items[0]));
  await expect(card.locator(".task-progress")).toHaveCount(0);
});

const manyTasks = (count: number) => Array.from({ length: count }, (_, i) => ({ title: `Task ${i + 1}`, completed: false }));

test("Focus mode folds the description away, is manual, and switches off below six tasks", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Long list", tasks: manyTasks(6) }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Long list" }).dblclick();
  await sidebar.locator("#view-edit").click();
  const focus = sidebar.locator("#f-tasks-focus");
  const desc = sidebar.locator("#f-desc");
  await expect(focus).toBeVisible();
  await expect(focus).toHaveAttribute("aria-pressed", "false");
  // Never turned on by itself.
  await expect(desc).toBeVisible();
  const before = await desc.boundingBox();
  const descFieldHeight = await sidebar.locator("#f-desc-field").evaluate((el) => el.offsetHeight);

  await focus.click();
  await expect(focus).toHaveAttribute("aria-pressed", "true");
  await expect(desc).toBeHidden();

  // Focus mode sizes the list against the viewport (not the description), so its
  // max-height grows past the 211px base cap and past the folded description.
  const focusMax = await sidebar.locator("#modal .modal-card").evaluate((el) => parseFloat(el.style.getPropertyValue("--focus-max")));
  expect(focusMax).toBeGreaterThan(descFieldHeight);
  expect(focusMax).toBeGreaterThan(211);

  await focus.click();
  await expect(focus).toHaveAttribute("aria-pressed", "false");
  await expect(desc).toBeVisible();
  const after = await desc.boundingBox();
  expect(after?.height).toBe(before?.height);

  // Down to five tasks while the mode is on: the button goes and the mode with it.
  await focus.click();
  await expect(desc).toBeHidden();
  await sidebar.locator("#f-tasks .task-row").nth(5).locator(".task-remove").click();
  await expect(focus).toBeHidden();
  await expect(desc).toBeVisible();

  await expect(sidebar.locator("#f-tasks .task-row")).toHaveCount(5);
});

test("reopening the editor scrolls the task list back to the first task", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Long list", tasks: manyTasks(8) }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Long list" }).dblclick();
  await sidebar.locator("#view-edit").click();
  const list = sidebar.locator("#f-tasks");
  await expect(list.locator(".task-row")).toHaveCount(8);

  const scrollTop = () => list.evaluate((el) => el.scrollTop);

  // Scroll to the last task, then close and reopen the editor.
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await scrollTop()).toBeGreaterThan(0);

  await sidebar.locator("#modal-cancel").click();
  await sidebar.locator(".card", { hasText: "Long list" }).dblclick();
  await sidebar.locator("#view-edit").click();

  // The list starts back at the first task, not the last one it showed.
  await expect(list.locator(".task-row")).toHaveCount(8);
  expect(await scrollTop()).toBe(0);
});

test("Focus mode is not offered for five tasks or fewer", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Short list", tasks: manyTasks(5) }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Short list" }).dblclick();
  await sidebar.locator("#view-edit").click();
  await expect(sidebar.locator("#f-tasks .task-row")).toHaveCount(5);
  await expect(sidebar.locator("#f-tasks-focus")).toBeHidden();
  await sidebar.locator("#f-task-add").click();
  await expect(sidebar.locator("#f-tasks-focus")).toBeVisible();
});

test("an editor task row narrower than 230px hides its checkbox", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Release", tasks: releaseTasks() }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Release" }).dblclick();
  await sidebar.locator("#view-edit").click();
  const list = sidebar.locator("#f-tasks");
  const check = sidebar.locator("#f-tasks .task-check").first();
  // A row is as wide as the list; the test sets the list's width directly.
  const setWidth = (px: number) => list.evaluate((el, w) => ((el as unknown as { style: { width: string } }).style.width = `${w}px`), px);

  await setWidth(230);
  await expect(check).toBeVisible();
  await setWidth(229);
  await expect(check).toBeHidden();
  await setWidth(300);
  await expect(check).toBeVisible();
});

test("dragging a task by its sequence number reorders the list", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Release", tasks: releaseTasks() }]) });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".card", { hasText: "Release" }).dblclick();
  await sidebar.locator("#view-edit").click();
  const rows = sidebar.locator("#f-tasks .task-row");
  await expect(rows).toHaveCount(3);

  // Drag "Write the notes" (first) below "Tag the build" (second).
  const handle = await rows.nth(0).locator(".task-seq").boundingBox();
  const target = await rows.nth(1).boundingBox();
  if (!handle || !target) {
    throw new Error("Task rows are not laid out");
  }
  const mouse = session.page.mouse;
  await mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await mouse.down();
  await mouse.move(handle.x + handle.width / 2, target.y + target.height * 0.8, { steps: 8 });
  await mouse.up();

  await expect(sidebar.locator("#f-tasks .task-seq")).toHaveText(["1.", "2.", "3."]);
  await sidebar.locator("#modal-save").click();
  await waitForData(session, (d) => d.items[0].tasks?.[0].title === "Tag the build");
  expect(readData(session).items[0].tasks?.map((t) => t.title)).toEqual(["Tag the build", "Write the notes", "Publish"]);
});

test("the emoji picker and shortcuts insert into task title inputs", async ({ launch }) => {
  const session = await launch();
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".empty-create-btn").click();
  await sidebar.locator("#f-title").fill("Ship it");
  await sidebar.locator("#f-task-add").click();
  const input = sidebar.locator("#f-tasks .task-title-input").first();
  await expect(input).toBeFocused();
  await input.fill("First");

  // The hint button anchors the picker to the focused task input and inserts there.
  await sidebar.locator("#emoji-hint").click();
  await expect(sidebar.locator("#emoji-picker")).toBeVisible();
  const first = sidebar.locator("#emoji-grid .emoji-pick").first();
  const emoji = (await first.textContent()) ?? "";
  expect(emoji.length).toBeGreaterThan(0);
  await first.click();
  await expect(sidebar.locator("#emoji-picker")).toBeHidden();
  await expect(input).toHaveValue(`First${emoji}`);
  await expect(sidebar.locator("#f-title")).toHaveValue("Ship it");

  // Ctrl+Shift+/ opens the picker straight from the task input.
  await input.press("Control+Shift+Slash");
  await expect(sidebar.locator("#emoji-picker")).toBeVisible();
  await session.page.keyboard.press("Escape");
  await expect(sidebar.locator("#emoji-picker")).toBeHidden();

  // Ctrl+/ inserts the most recent emoji into the task input.
  await input.press("Control+Slash");
  await expect(input).toHaveValue(`First${emoji}${emoji}`);
  await expect(sidebar.locator("#f-title")).toHaveValue("Ship it");

  // The emoji is part of the task's stored title, not just the on-screen input.
  await sidebar.locator("#modal-save").click();
  await expect(sidebar.locator("#modal")).toBeHidden();
  await waitForData(session, (d) => d.items.some((n) => n.title === "Ship it"));
  expect(readData(session).items[0].tasks?.[0].title).toBe(`First${emoji}${emoji}`);
});

test("Ctrl+ArrowUp/Down moves focus between task title inputs without reordering", async ({ launch }) => {
  const session = await launch();
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".empty-create-btn").click();
  await sidebar.locator("#f-title").fill("Release");
  await sidebar.locator("#f-task-add").click();
  const inputs = sidebar.locator("#f-tasks .task-title-input");
  const values = () => inputs.evaluateAll((els) => els.map((el) => (el as unknown as { value: string }).value));
  await expect(inputs).toHaveCount(1);

  await inputs.nth(0).fill("One");
  await inputs.nth(0).press("Enter");
  await inputs.nth(1).fill("Two");
  await inputs.nth(1).press("Enter");
  await inputs.nth(2).fill("Three");
  await expect(inputs).toHaveCount(3);

  // Ctrl+ArrowDown moves focus to the next title without reordering.
  await inputs.nth(0).press("Control+ArrowDown");
  await expect(inputs.nth(1)).toBeFocused();
  await inputs.nth(1).press("Control+ArrowDown");
  await expect(inputs.nth(2)).toBeFocused();

  // At the last task Ctrl+ArrowDown stays put (no wrap-around).
  await inputs.nth(2).press("Control+ArrowDown");
  await expect(inputs.nth(2)).toBeFocused();

  // Ctrl+ArrowUp moves back to the previous title.
  await inputs.nth(2).press("Control+ArrowUp");
  await expect(inputs.nth(1)).toBeFocused();
  await inputs.nth(0).press("Control+ArrowUp");
  await expect(inputs.nth(0)).toBeFocused();

  // Focus moves never reorder the list.
  await expect(sidebar.locator("#f-tasks .task-seq")).toHaveText(["1.", "2.", "3."]);
  await expect.poll(values).toEqual(["One", "Two", "Three"]);
});

test("the tasks info icon appears only with more than one task and lists the shortcuts", async ({ launch }) => {
  const session = await launch();
  const sidebar = await showSidebar(session.page);

  const info = sidebar.locator("#f-tasks-info");
  await sidebar.locator(".empty-create-btn").click();
  await expect(sidebar.locator("#f-tasks-label")).toHaveText("Tasks (optional)");
  await expect(info).toBeHidden();

  // One task is still not enough to show it.
  await sidebar.locator("#f-task-add").click();
  await expect(info).toBeHidden();

  // A second task reveals the icon.
  await sidebar.locator("#f-tasks .task-title-input").nth(0).press("Enter");
  await expect(info).toBeVisible();
  await expect(info).toHaveAttribute("data-tooltip-header", "Task shortcuts");

  // Hovering reveals the tooltip (it has a 500ms show delay).
  await info.hover();
  const tooltip = sidebar.locator(".tooltip.visible");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Focus previous / next task");
  await expect(tooltip).toContainText("Add a task below");
  await expect(tooltip).toContainText("Reorder the task");
  await expect(tooltip).toContainText("Ctrl+Up / Ctrl+Down");
  await expect(tooltip).toContainText("Alt+Up / Alt+Down");
});
