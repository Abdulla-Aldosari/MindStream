import type { Frame, Page } from "@playwright/test";
import { GENERAL_CATEGORY_ID, type MindStreamData } from "../src/models";
import { buildData, expect, readData, runCommand, showSidebar, test, waitForData } from "./helpers";

// Sidebar interactions not covered by the note/link/work-pause specs: the
// toolbar (filters, View menu, archive), groups, the priority control, the
// viewer menu, the types/categories/report modals, the emoji picker, and the
// Escape chain across stacked overlays.

/** Three notes in two categories and two types, one per status and priority. */
function seededData(): MindStreamData {
  const data = buildData([
    { title: "Alpha note", status: "pending", priority: "high" },
    { title: "Bravo note", status: "done", priority: "low" },
    { title: "Charlie note", status: "in-progress", priority: "medium" },
  ]);
  data.categories.push({ id: "work", label: "Work", order: 1, createdAt: "2026-11-01T10:00:00.000Z" });
  data.items[0].categoryId = "work";
  data.items[2].typeId = data.types[1].id;
  return data;
}

/**
 * Runs a palette command by its exact title. The shared helper presses Enter on
 * the top match, which for "Weekly Report" is "Export Weekly Report".
 */
async function runExactCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press("F1");
  await page.locator(".quick-input-widget .quick-input-box input").fill(`>${title}`);
  await page
    .locator(".quick-input-list .quick-input-list-entry")
    .filter({ has: page.locator(".label-name", { hasText: new RegExp(`^${title}$`) }) })
    .first()
    .click();
}

function card(sidebar: Frame, title: string) {
  return sidebar.locator(".card", { hasText: title });
}

test("the category and type filters narrow the list and recount", async ({ launch }) => {
  const data = seededData();
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);
  await expect(sidebar.locator(".card")).toHaveCount(3);

  await sidebar.locator("#category-filter-btn").click();
  await sidebar.locator('#category-filter-menu .cs-item[data-value="work"]').click();
  await expect(sidebar.locator(".card")).toHaveCount(1);
  await expect(card(sidebar, "Alpha note")).toBeVisible();
  await expect(sidebar.locator("#category-filter-btn .cs-btn-label")).toHaveText("Work");

  await sidebar.locator("#category-filter-btn").click();
  await sidebar.locator('#category-filter-menu .cs-item[data-value="all"]').click();
  await expect(sidebar.locator(".card")).toHaveCount(3);

  await sidebar.locator("#type-filter-btn").click();
  await expect(sidebar.locator(`#type-filter-menu .cs-item[data-value="${data.types[1].id}"]`)).toContainText("(1)");
  await sidebar.locator(`#type-filter-menu .cs-item[data-value="${data.types[1].id}"]`).click();
  await expect(sidebar.locator(".card")).toHaveCount(1);
  await expect(card(sidebar, "Charlie note")).toBeVisible();
});

test("status groups collapse, and the View menu changes grouping and hides priorities", async ({ launch }) => {
  const session = await launch({ data: seededData() });
  const sidebar = await showSidebar(session.page);

  // Default view: grouped by status.
  await expect(sidebar.locator(".group-header")).toHaveCount(3);
  const doneHeader = sidebar.locator(".group-header", { hasText: "Done" });
  await doneHeader.click();
  await expect(card(sidebar, "Bravo note")).toHaveCount(0);
  await expect(sidebar.locator(".group-header", { hasText: "Done" })).toHaveClass(/collapsed/);
  await sidebar.locator(".group-header", { hasText: "Done" }).click();
  await expect(card(sidebar, "Bravo note")).toBeVisible();

  await sidebar.locator("#view-options-btn").click();
  const menu = sidebar.locator(".dm-menu");
  await expect(menu).toBeVisible();
  await menu.locator('[role="menuitemradio"]', { hasText: "None" }).click();
  await expect(sidebar.locator(".group-header")).toHaveCount(0);
  await expect(sidebar.locator(".card")).toHaveCount(3);

  // Checkboxes keep the menu open.
  await menu.locator('[role="menuitemcheckbox"]', { hasText: "Low" }).click();
  await expect(card(sidebar, "Bravo note")).toHaveCount(0);
  await expect(sidebar.locator("#view-options-icon")).toHaveClass(/codicon-filter-filled/);
  for (const level of ["Critical", "High", "Medium"]) {
    await menu.locator('[role="menuitemcheckbox"]', { hasText: level }).click();
  }
  await expect(sidebar.locator(".card")).toHaveCount(0);
  await session.page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await sidebar.locator(".empty-show-all-btn").click();
  await expect(sidebar.locator(".card")).toHaveCount(3);
  await expect(sidebar.locator("#view-options-icon")).toHaveClass(/codicon-list-filter/);
});

test("archiving hides a note until the archive is shown", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Keep me" }, { title: "Archive me" }]) });
  const sidebar = await showSidebar(session.page);

  await card(sidebar, "Archive me").locator('[data-tooltip="Archive"]').click();
  await expect(card(sidebar, "Archive me")).toHaveCount(0);
  await waitForData(session, (d) => d.items.some((n) => n.title === "Archive me" && n.archived));

  await sidebar.locator("#btn-archive-toggle").click();
  await expect(sidebar.locator("#btn-archive-toggle")).toHaveText("Hide archive");
  await expect(card(sidebar, "Archive me")).toHaveClass(/archived/);
  await sidebar.locator("#btn-archive-toggle").click();
  await expect(sidebar.locator("#btn-archive-toggle")).toHaveText("Archive");
  await expect(card(sidebar, "Archive me")).toHaveCount(0);
});

test("the priority control works with the mouse and the keyboard", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "No priority yet" }]) });
  const sidebar = await showSidebar(session.page);

  // An existing note without a priority opens with nothing selected and a hint.
  await card(sidebar, "No priority yet").locator('[data-tooltip="Edit"]').click();
  await expect(sidebar.locator("#f-priority-hint")).toBeVisible();
  await expect(sidebar.locator('.pc-option[aria-checked="true"]')).toHaveCount(0);
  await session.page.keyboard.press("Escape");
  await expect(sidebar.locator("#modal")).toBeHidden();

  await runCommand(session.page, "MindStream: Quick Note");
  await expect(sidebar.locator("#modal")).toBeVisible();
  await expect(sidebar.locator('.pc-option[data-value="low"]')).toHaveAttribute("aria-checked", "true");
  await expect(sidebar.locator("#f-priority-hint")).toBeHidden();

  await sidebar.locator('.pc-option[data-value="high"]').click();
  await expect(sidebar.locator('.pc-option[data-value="high"]')).toHaveAttribute("aria-checked", "true");
  await sidebar.locator('.pc-option[data-value="high"]').focus();
  await session.page.keyboard.press("ArrowRight");
  await expect(sidebar.locator('.pc-option[data-value="medium"]')).toHaveAttribute("aria-checked", "true");
  await expect(sidebar.locator('.pc-option[data-value="medium"]')).toBeFocused();

  await sidebar.locator("#f-title").fill("Prioritized note");
  await sidebar.locator("#modal-save").click();
  await expect(sidebar.locator("#modal")).toBeHidden();
  await waitForData(session, (d) => d.items.some((n) => n.title === "Prioritized note" && n.priority === "medium"));
});

test("the viewer's options menu copies the id, and Escape closes the menu before the viewer", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "View me", description: "Some details" }]) });
  const sidebar = await showSidebar(session.page);

  await card(sidebar, "View me").dblclick();
  await expect(sidebar.locator("#view-modal")).toBeVisible();
  await expect(sidebar.locator("#view-title")).toHaveText("View me");
  await expect(sidebar.locator("#view-desc-content")).toHaveText("Some details");

  await sidebar.locator("#viewer-option-btn").click();
  await expect(sidebar.locator("#viewer-options-menu")).toBeVisible();
  await session.page.keyboard.press("Escape");
  await expect(sidebar.locator("#viewer-options-menu")).toBeHidden();
  await expect(sidebar.locator("#view-modal")).toBeVisible();

  await sidebar.locator("#viewer-option-btn").click();
  await sidebar.locator('#viewer-options-menu .cs-item[data-action="copy-id"]').click();
  await expect(sidebar.locator("#viewer-options-menu")).toBeHidden();
  await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe("seed-1");

  await session.page.keyboard.press("Escape");
  await expect(sidebar.locator("#view-modal")).toBeHidden();
});

test("types: add one with a picked icon, rename it, and change another type's icon", async ({ launch }) => {
  const session = await launch({ data: buildData() });
  const sidebar = await showSidebar(session.page);

  await runCommand(session.page, "MindStream: Manage Types");
  await expect(sidebar.locator("#types-modal")).toBeVisible();

  await sidebar.locator("#btn-type-icon").click();
  await expect(sidebar.locator("#icons-modal")).toBeVisible();
  await sidebar.locator("#f-icon-filter").fill("beaker");
  await sidebar.locator('.icon-pick[data-icon="beaker"]').click();
  await expect(sidebar.locator("#icons-modal")).toBeHidden();
  await expect(sidebar.locator("#btn-type-icon-glyph")).toHaveClass(/codicon-beaker/);

  await sidebar.locator("#f-type-name").fill("Bug hunt");
  await sidebar.locator("#btn-add-type").click();
  await waitForData(session, (d) => d.types.some((t) => t.label === "Bug hunt" && t.icon === "beaker"));
  const newRow = sidebar.locator("#types-list .mgmt-row", { hasText: "Bug hunt" });
  await expect(newRow).toBeVisible();
  await expect(sidebar.locator("#btn-type-icon-glyph")).toHaveClass(/codicon-tag/);

  await newRow.locator('[data-tooltip="Rename"]').click();
  await sidebar.locator("#types-list .mgmt-rename-input").fill("Bug hunts");
  await sidebar.locator("#types-list .mgmt-rename-input").press("Enter");
  await waitForData(session, (d) => d.types.some((t) => t.label === "Bug hunts"));
  await expect(sidebar.locator("#types-list .mgmt-row", { hasText: "Bug hunts" })).toBeVisible();

  // Escape closes the icons picker first, then the types modal.
  const ideaRow = sidebar.locator("#types-list .mgmt-row", { hasText: "Idea" });
  await ideaRow.locator(".type-icon-btn").click();
  await expect(sidebar.locator("#icons-modal")).toBeVisible();
  await expect(ideaRow.locator(".type-icon-btn")).toHaveClass(/active/);
  await session.page.keyboard.press("Escape");
  await expect(sidebar.locator("#icons-modal")).toBeHidden();
  await expect(sidebar.locator("#types-modal")).toBeVisible();

  await ideaRow.locator(".type-icon-btn").click();
  await sidebar.locator("#f-icon-filter").fill("rocket");
  await sidebar.locator('.icon-pick[data-icon="rocket"]').click();
  await waitForData(session, (d) => d.types.some((t) => t.label === "Idea" && t.icon === "rocket"));
  await expect(ideaRow.locator(".codicon-rocket")).toBeVisible();

  await session.page.keyboard.press("Escape");
  await expect(sidebar.locator("#types-modal")).toBeHidden();
});

test("categories: add, rename, and a default type that the editor pre-selects", async ({ launch }) => {
  const session = await launch({ data: buildData() });
  const sidebar = await showSidebar(session.page);

  await runCommand(session.page, "MindStream: Manage Categories");
  await expect(sidebar.locator("#categories-modal")).toBeVisible();
  await sidebar.locator("#f-category-name").fill("Backend");
  await sidebar.locator("#f-category-name").press("Enter");
  await waitForData(session, (d) => d.categories.some((c) => c.label === "Backend"));
  const row = sidebar.locator("#categories-list .mgmt-row", { hasText: "Backend" });
  await expect(row).toBeVisible();

  await row.locator('[data-tooltip="Rename"]').click();
  await sidebar.locator("#categories-list .mgmt-rename-input").fill("Backend API");
  await sidebar.locator("#categories-list .mgmt-rename-input").press("Enter");
  await waitForData(session, (d) => d.categories.some((c) => c.label === "Backend API"));

  const renamedRow = sidebar.locator("#categories-list .mgmt-row", { hasText: "Backend API" });
  await renamedRow.locator('[data-tooltip="Set Default Type"]').click();
  // Filter the quick pick down to one entry before accepting it: a click can
  // land on another row while the list is still being laid out.
  await session.page.locator(".quick-input-widget .quick-input-box input").fill("Idea");
  await expect(session.page.locator(".quick-input-list .quick-input-list-entry")).toHaveCount(1);
  await expect(session.page.locator(".quick-input-list .quick-input-list-entry")).toContainText("Idea");
  await session.page.keyboard.press("Enter");
  const ideaId = readData(session).types.find((t) => t.label === "Idea")?.id;
  await waitForData(session, (d) => d.categories.some((c) => c.label === "Backend API" && c.defaultTypeId === ideaId));
  await expect(renamedRow.locator('[data-tooltip="Default Type: Idea"]')).toBeVisible();

  // The quick pick took the focus out of the webview; give it back before Escape.
  await sidebar.locator("#f-category-name").click();
  await session.page.keyboard.press("Escape");
  await expect(sidebar.locator("#categories-modal")).toBeHidden();

  // Picking that category in a new note switches the type to its default.
  const categoryId = readData(session).categories.find((c) => c.label === "Backend API")?.id;
  await runCommand(session.page, "MindStream: Quick Note");
  await expect(sidebar.locator("#modal")).toBeVisible();
  await expect(sidebar.locator("#f-type-btn .cs-btn-label")).toHaveText("General");
  await sidebar.locator("#f-category-btn").click();
  await sidebar.locator(`#f-category-menu .cs-item[data-value="${categoryId}"]`).click();
  await expect(sidebar.locator("#f-category-btn .cs-btn-label")).toHaveText("Backend API");
  await expect(sidebar.locator("#f-type-btn .cs-btn-label")).toHaveText("Idea");
});

test("the weekly report opens with its summary and closes", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "Some note" }]) });
  const sidebar = await showSidebar(session.page);

  await runExactCommand(session.page, "MindStream: Weekly Report");
  await expect(sidebar.locator("#report-modal")).toBeVisible();
  await expect(sidebar.locator("#report-title")).toContainText("Weekly Report — Week of");
  await expect(sidebar.locator("#report-summary .report-stat")).toHaveCount(4);
  await sidebar.locator("#report-close").click();
  await expect(sidebar.locator("#report-modal")).toBeHidden();

  await runExactCommand(session.page, "MindStream: Weekly Report");
  await expect(sidebar.locator("#report-modal")).toBeVisible();
  // The report focuses nothing itself: click into it so Escape reaches the webview.
  await sidebar.locator("#report-summary").click();
  await session.page.keyboard.press("Escape");
  await expect(sidebar.locator("#report-modal")).toBeHidden();
});

test("emoji: the picker inserts at the caret, the shortcut repeats the last one, and the list can be edited", async ({ launch }) => {
  const session = await launch({ data: buildData() });
  const sidebar = await showSidebar(session.page);

  await runCommand(session.page, "MindStream: Quick Note");
  await expect(sidebar.locator("#modal")).toBeVisible();
  await expect(sidebar.locator("#emoji-symbols-grid .emoji-pick").first()).toHaveText("❖");

  await sidebar.locator("#f-title").fill("Hello");
  await sidebar.locator("#emoji-hint").click();
  await expect(sidebar.locator("#emoji-picker")).toBeVisible();
  const first = sidebar.locator("#emoji-grid .emoji-pick").first();
  const emoji = (await first.textContent()) ?? "";
  expect(emoji.length).toBeGreaterThan(0);
  await first.click();
  await expect(sidebar.locator("#emoji-picker")).toBeHidden();
  await expect(sidebar.locator("#f-title")).toHaveValue(`Hello${emoji}`);

  // Ctrl+/ inserts the most recent emoji again.
  await sidebar.locator("#f-title").press("Control+Slash");
  await expect(sidebar.locator("#f-title")).toHaveValue(`Hello${emoji}${emoji}`);

  // Ctrl+Shift+/ opens the picker with the recent row; Escape closes it before the editor.
  await sidebar.locator("#f-desc").press("Control+Shift+Slash");
  await expect(sidebar.locator("#emoji-picker")).toBeVisible();
  await expect(sidebar.locator("#emoji-recents-row")).toBeVisible();
  await expect(sidebar.locator("#emoji-recents-grid .emoji-pick").first()).toHaveText(emoji);
  await session.page.keyboard.press("Escape");
  await expect(sidebar.locator("#emoji-picker")).toBeHidden();
  await expect(sidebar.locator("#modal")).toBeVisible();

  // Edit the palette.
  await sidebar.locator("#emoji-hint").click();
  await sidebar.locator("#emoji-edit-btn").click();
  await expect(sidebar.locator("#emoji-edit-modal")).toBeVisible();
  await expect(sidebar.locator("#emoji-picker")).toBeHidden();
  await sidebar.locator("#f-emoji-list").fill("😀 abc 🎉");
  await expect(sidebar.locator("#emoji-edit-preview .emoji-edit-preview-item")).toHaveCount(2);
  await sidebar.locator("#emoji-edit-save").click();
  await expect(sidebar.locator("#emoji-edit-modal")).toBeHidden();

  await sidebar.locator("#emoji-hint").click();
  await expect(sidebar.locator("#emoji-grid .emoji-pick")).toHaveCount(2);
  await expect(sidebar.locator("#emoji-grid .emoji-pick").first()).toHaveText("😀");

  // Escape walks back: picker, then the editor.
  await session.page.keyboard.press("Escape");
  await expect(sidebar.locator("#emoji-picker")).toBeHidden();
  await session.page.keyboard.press("Escape");
  await expect(sidebar.locator("#modal")).toBeHidden();
  await expect(sidebar.locator(".card")).toHaveCount(0);
  expect(readData(session).items.filter((n) => n.categoryId === GENERAL_CATEGORY_ID)).toHaveLength(0);
});
