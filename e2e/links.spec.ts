import * as fs from "node:fs";
import * as path from "node:path";
import { buildData, expect, notification, readData, seedLink, showSidebar, sidebarFrame, test, waitForData, writeWorkspaceFile, type LaunchOptions, type Session } from "./helpers";

const SOURCE = ["import { run } from './run';", "", "export function main() {", "  const answer = compute();", "  return run(answer);", "}", "", "export const done = true;"];
const FILE = "src/app.ts";
/** How long the extension host needs to learn about a just-opened editor and its cursor. */
const EDITOR_SETTLE_MS = 1000;

/** One linked note on `answer = compute()` (line 4), in a workspace that has the file. */
function linkedSession(launch: (options?: LaunchOptions) => Promise<Session>): Promise<Session> {
  return launch({
    data: buildData([{ title: "Check the answer", link: seedLink(FILE, SOURCE, 4) }]),
    files: { [FILE]: SOURCE },
  });
}

test("a linked note shows its location and opens the file at that line", async ({ launch }) => {
  const session = await linkedSession(launch);
  const sidebar = await showSidebar(session.page);

  const badge = sidebar.locator(".card", { hasText: "Check the answer" }).locator(".link-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveClass(/link-ok/);
  await expect(badge).toContainText("app.ts:4");

  await badge.click();

  await expect(session.page.locator(".tabs-container .tab", { hasText: "app.ts" })).toBeVisible();
  // The cursor sits on the linked line: the status bar reads "Ln 4".
  await expect(session.page.locator(".statusbar").getByText(/Ln 4,/)).toBeVisible();
});

test("a multi-line link opens with the whole range selected", async ({ launch }) => {
  const session = await launch({
    data: buildData([{ title: "Review the body", link: seedLink(FILE, SOURCE, 3, 6) }]),
    files: { [FILE]: SOURCE },
  });
  const sidebar = await showSidebar(session.page);

  const badge = sidebar.locator(".card", { hasText: "Review the body" }).locator(".link-badge");
  await expect(badge).toContainText("app.ts:3-6");
  await badge.click();

  await expect(session.page.locator(".statusbar").getByText(/\(\d+ selected\)/)).toBeVisible();
});

test("the link follows the code when lines are added above it (changed outside VS Code)", async ({ launch }) => {
  const session = await linkedSession(launch);
  const sidebar = await showSidebar(session.page);
  const badge = sidebar.locator(".card", { hasText: "Check the answer" }).locator(".link-badge");
  await expect(badge).toContainText("app.ts:4");

  // Two lines are added at the top, as `git pull` or another tool would do.
  writeWorkspaceFile(session.workspace, FILE, ["// header", "// header 2", ...SOURCE]);
  await badge.click();

  await expect(badge).toContainText("app.ts:6");
  await expect(badge).toHaveClass(/link-ok/);
  await waitForData(session, (d) => d.items[0].link?.lineStart === 6);
  expect(readData(session).items[0].link?.state).toBe("ok");
});

test("when the linked code is rewritten the link is flagged changed, with a warning", async ({ launch }) => {
  const session = await linkedSession(launch);
  const sidebar = await showSidebar(session.page);
  const badge = sidebar.locator(".card", { hasText: "Check the answer" }).locator(".link-badge");

  writeWorkspaceFile(session.workspace, FILE, ["export function main() {", "  return nothingLikeBefore();", "}"]);
  await badge.click();

  await expect(notification(session.page, /the linked code changed/)).toBeVisible();
  await expect(badge).toHaveClass(/link-changed/);
  await waitForData(session, (d) => d.items[0].link?.state === "changed");
});

test("when the file is deleted the note is kept and its link is flagged missing", async ({ launch }) => {
  const session = await linkedSession(launch);
  const sidebar = await showSidebar(session.page);
  const badge = sidebar.locator(".card", { hasText: "Check the answer" }).locator(".link-badge");
  await expect(badge).toHaveClass(/link-ok/);

  fs.rmSync(path.join(session.workspace, ...FILE.split("/")));
  await badge.click();

  await expect(notification(session.page, /no longer exists at this path/)).toBeVisible();
  await expect(badge).toHaveClass(/link-missing/);
  await expect(sidebar.locator(".card", { hasText: "Check the answer" })).toBeVisible();
  await waitForData(session, (d) => d.items[0].link?.state === "missing");
  expect(readData(session).items).toHaveLength(1);
});

test("a link in a hand-edited file that points outside the workspace is dropped, the note stays", async ({ launch }) => {
  const data = buildData([{ title: "Crafted link" }]);
  data.items[0].link = { filePath: "../secret.txt", lineStart: 1, state: "ok" };
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  const card = sidebar.locator(".card", { hasText: "Crafted link" });
  await expect(card).toBeVisible();
  await expect(card.locator(".link-badge")).toHaveCount(0);
});

test("a note linked to a code line is created from the editor's context menu", async ({ launch }) => {
  const session = await launch({ data: buildData(), files: { [FILE]: SOURCE } });
  const { page } = session;
  await showSidebar(page);

  // Open the file with Ctrl+P. The cursor starts on line 1.
  await page.keyboard.press("Control+P");
  await page.locator(".quick-input-widget .quick-input-box input").fill("app.ts");
  await page.locator(".quick-input-list .quick-input-list-entry", { hasText: "app.ts" }).first().waitFor();
  await page.keyboard.press("Enter");
  await page.locator(".monaco-editor .view-lines").first().waitFor();
  await expect(page.locator(".statusbar").getByText(/Ln 1,/)).toBeVisible();

  // Settle: the window shows the editor and its cursor before the extension host knows about them, and
  // there is no signal to wait for. The command reads `activeTextEditor` there, so a click made in the
  // first moments is ignored without any message. This is the one fixed wait in the suite.
  await page.waitForTimeout(EDITOR_SETTLE_MS);
  await page
    .locator(".monaco-editor .view-line", { hasText: "const answer" })
    .first()
    .click({ button: "right", position: { x: 40, y: 5 } });
  await expect(page.locator(".statusbar").getByText(/Ln 4,/)).toBeVisible();
  await page.waitForTimeout(EDITOR_SETTLE_MS);
  await page.locator(".monaco-menu .action-item", { hasText: "Add note to this line" }).first().click();

  const sidebar = await sidebarFrame(page);
  await expect(sidebar.locator("#modal")).toBeVisible();
  await expect(sidebar.locator("#f-link .link-badge")).toContainText("app.ts:4");
  await expect(sidebar.locator("#modal-title")).toHaveText("New note for code");
  await sidebar.locator("#f-title").fill("Why is compute() called here?");
  await sidebar.locator("#modal-save").click();

  await expect(sidebar.locator("#modal")).toBeHidden();
  await waitForData(session, (d) => d.items.some((n) => n.title === "Why is compute() called here?" && n.link?.filePath === FILE));
  const saved = readData(session).items[0];
  expect(saved.link?.state).toBe("ok");
  expect(saved.link?.anchor?.text.length).toBeGreaterThan(0);
});
