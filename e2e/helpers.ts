import { _electron, expect, test as base, type ElectronApplication, type Frame, type Page } from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GENERAL_CATEGORY_ID, type MindStreamData, type MindStreamLink, type MindStreamPriority, type MindStreamStatus, type MindStreamTask } from "../src/models";
import { buildLink } from "../src/linkResolver";
import { createEmptyData } from "../src/storage";

/** The sidebar's data file, relative to the workspace folder. */
export const DATA_FILE = path.join(".vscode", "mindstream.data.json");

const EXTENSION_ROOT = path.resolve(__dirname, "..");
const VSCODE_CACHE = path.join(os.homedir(), ".vscode-test");

export interface SeedNote {
  title: string;
  description?: string;
  status?: MindStreamStatus;
  priority?: MindStreamPriority;
  /** A code link written straight into the data file (as the editor command would create it). */
  link?: MindStreamLink;
  /** Makes the note a task group. */
  tasks?: MindStreamTask[];
}

/** The link the editor command stores for 1-based lines `lineStart`..`lineEnd` of `lines`. */
export function seedLink(filePath: string, lines: string[], lineStart: number, lineEnd = lineStart): MindStreamLink {
  const link = buildLink("/ws", `/ws/${filePath}`, lines, lineStart, lineEnd);
  if (!link) {
    throw new Error(`Cannot build a link for ${filePath}:${lineStart}-${lineEnd}`);
  }
  return link;
}

/** Builds a data file with the default types and the given notes. */
export function buildData(notes: SeedNote[] = []): MindStreamData {
  const data = createEmptyData();
  const typeId = data.types[0].id;
  const at = "2026-11-01T10:00:00.000Z";
  notes.forEach((n, i) => {
    const status = n.status ?? "pending";
    data.items.push({
      id: `seed-${i + 1}`,
      typeId,
      categoryId: GENERAL_CATEGORY_ID,
      title: n.title,
      description: n.description,
      status,
      ...(n.priority ? { priority: n.priority } : {}),
      ...(n.link ? { link: n.link } : {}),
      ...(n.tasks ? { tasks: n.tasks } : {}),
      ...(status === "done" ? { completedAt: at } : {}),
      archived: false,
      createdAt: at,
      updatedAt: at,
    });
  });
  return data;
}

export interface LaunchOptions {
  /** Data written to the workspace's data file before VS Code starts. */
  data?: MindStreamData;
  /** Exact file text instead of `data` (to start from a broken file). */
  rawData?: string;
  /** Workspace files written before VS Code starts: relative path to the file's lines. */
  files?: Record<string, string[]>;
}

export interface Session {
  app: ElectronApplication;
  page: Page;
  workspace: string;
  /** Absolute path of the workspace's data file. */
  dataFile: string;
  close(): Promise<void>;
}

async function resolveVscodeExecutable(): Promise<string> {
  // An explicit path keeps the tests working offline.
  const fromEnv = process.env.MINDSTREAM_E2E_VSCODE;
  if (fromEnv) {
    return fromEnv;
  }
  return downloadAndUnzipVSCode({ version: "stable", cachePath: VSCODE_CACHE });
}

function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // A file still locked by the closing window is left to the OS temp cleanup.
  }
}

/** Writes a text file (LF line endings) into the workspace, creating its folders. */
export function writeWorkspaceFile(workspace: string, relPath: string, lines: string[]): void {
  const file = path.join(workspace, ...relPath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

/** Starts an isolated VS Code window with this extension loaded and a fresh workspace. */
export async function launchVscode(options: LaunchOptions = {}): Promise<Session> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-e2e-ws-"));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-e2e-user-"));
  const extensions = fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-e2e-ext-"));
  const dataFile = path.join(workspace, DATA_FILE);
  if (options.rawData !== undefined || options.data) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, options.rawData ?? JSON.stringify(options.data, null, 2), "utf8");
  }
  for (const [relPath, lines] of Object.entries(options.files ?? {})) {
    writeWorkspaceFile(workspace, relPath, lines);
  }

  const app = await _electron.launch({
    executablePath: await resolveVscodeExecutable(),
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-updates",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
      "--disable-extensions",
      `--user-data-dir=${userData}`,
      `--extensions-dir=${extensions}`,
      `--extensionDevelopmentPath=${EXTENSION_ROOT}`,
      workspace,
    ],
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".monaco-workbench", { timeout: 60_000 });

  return {
    app,
    page,
    workspace,
    dataFile,
    async close() {
      await app.close().catch(() => undefined);
      [workspace, userData, extensions].forEach(removeDir);
    },
  };
}

/** `test` with a `launch` fixture: every window it opens is closed (and photographed on failure) afterwards. */
export const test = base.extend<{ launch: (options?: LaunchOptions) => Promise<Session> }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern here
  launch: async ({}, use, testInfo) => {
    const sessions: Session[] = [];
    await use(async (options) => {
      const session = await launchVscode(options);
      sessions.push(session);
      return session;
    });
    for (const session of sessions) {
      if (testInfo.status !== testInfo.expectedStatus) {
        const body = await session.page.screenshot().catch(() => undefined);
        if (body) {
          await testInfo.attach("window", { body, contentType: "image/png" });
        }
      }
      await session.close();
    }
  },
});

export { expect };

/** Opens the MindStream view from the activity bar. */
export async function openSidebar(page: Page): Promise<void> {
  await page.locator('.activitybar .action-label[aria-label="MindStream"]').click();
}

/** The sidebar webview's frame, once its page has been built. */
export async function sidebarFrame(page: Page, timeoutMs = 30_000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (!frame.url().includes("fake.html")) {
        continue;
      }
      if (
        (await frame
          .locator("#toolbar")
          .count()
          .catch(() => 0)) > 0
      ) {
        return frame;
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error("The MindStream sidebar did not appear.");
}

/** Opens the sidebar and returns its frame. */
export async function showSidebar(page: Page): Promise<Frame> {
  await openSidebar(page);
  return sidebarFrame(page);
}

/** Runs a command from the Command Palette by its title, e.g. "MindStream: Refresh". */
export async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press("F1");
  await page.locator(".quick-input-widget .quick-input-box input").fill(`>${title}`);
  await page.locator(".quick-input-list .quick-input-list-entry", { hasText: title }).first().waitFor();
  await page.keyboard.press("Enter");
}

/**
 * Clicks an item of the sidebar's More (...) menu by its title. Commands hidden
 * from the Command Palette (such as resuming work) can only be reached here.
 */
export async function clickMoreMenuItem(page: Page, title: string): Promise<void> {
  await page.locator('.part.sidebar .title-actions .action-label[aria-label="More"]').first().click();
  await page.locator(".monaco-menu .action-item", { hasText: title }).first().click();
}

/** A VS Code notification (toast) containing the text. */
export function notification(page: Page, text: string | RegExp) {
  return page.locator(".notifications-toasts").getByText(text);
}

/** Reads the data file from disk. */
export function readData(session: Session): MindStreamData {
  return JSON.parse(fs.readFileSync(session.dataFile, "utf8")) as MindStreamData;
}

/** Waits until the data file satisfies the check (the extension writes it a moment after the click). */
export async function waitForData(session: Session, check: (data: MindStreamData) => boolean): Promise<void> {
  await expect
    .poll(() => {
      try {
        return check(readData(session));
      } catch {
        return false;
      }
    })
    .toBe(true);
}
