/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * The local window profile: where the test window sits, how big it is, and how
 * wide the sidebar is. It is captured once by `npm run e2e:profile` from a real
 * window the developer arranges by hand, is git-ignored, and is optional: when
 * it is missing every window simply opens with VS Code's defaults.
 */
export const PROFILE_DIR = path.join(__dirname, ".profile");

const PROFILE_STATE = path.join(PROFILE_DIR, "state.vscdb");
const PROFILE_WINDOW = path.join(PROFILE_DIR, "window.json");

export const EXTENSION_ROOT = path.resolve(__dirname, "..");
const VSCODE_CACHE = path.join(os.homedir(), ".vscode-test");

/** User settings written for every window: no AI chat, and no secondary side bar. */
const WINDOW_SETTINGS = {
  "chat.disableAIFeatures": true,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
};

/** The window rectangle VS Code stores (`mode` 1 is a normal window). */
export interface WindowState {
  mode: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function resolveVscodeExecutable(): Promise<string> {
  // An explicit path keeps the tests working offline.
  const fromEnv = process.env.MINDSTREAM_E2E_VSCODE;
  if (fromEnv) {
    return fromEnv;
  }
  return downloadAndUnzipVSCode({ version: "stable", cachePath: VSCODE_CACHE });
}

/** The command-line arguments of every test window. */
export function vscodeArgs(dirs: { userData: string; extensions: string; workspace: string }): string[] {
  return [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-updates",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
    "--disable-extensions",
    `--user-data-dir=${dirs.userData}`,
    `--extensions-dir=${dirs.extensions}`,
    `--extensionDevelopmentPath=${EXTENSION_ROOT}`,
    dirs.workspace,
  ];
}

function globalStorageDir(userData: string): string {
  return path.join(userData, "User", "globalStorage");
}

function isWindowState(value: unknown): value is WindowState {
  const v = value as Record<string, unknown> | null;
  return !!v && ["mode", "x", "y", "width", "height"].every((k) => typeof v[k] === "number");
}

function readSavedWindow(): WindowState | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(PROFILE_WINDOW, "utf8"));
    return isWindowState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Prepares a fresh user-data dir: the settings every window needs, then the
 * local profile when one was captured (a missing or unreadable profile is
 * skipped, never an error).
 */
export function prepareUserData(userData: string): void {
  const settingsDir = path.join(userData, "User");
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(path.join(settingsDir, "settings.json"), JSON.stringify(WINDOW_SETTINGS, null, 2), "utf8");

  const storageDir = globalStorageDir(userData);
  const window = readSavedWindow();
  if (window) {
    fs.mkdirSync(storageDir, { recursive: true });
    const state = { windowsState: { lastPluginDevelopmentHostWindow: { uiState: window }, openedWindows: [] } };
    fs.writeFileSync(path.join(storageDir, "storage.json"), JSON.stringify(state, null, 2), "utf8");
  }
  if (fs.existsSync(PROFILE_STATE)) {
    fs.mkdirSync(storageDir, { recursive: true });
    fs.copyFileSync(PROFILE_STATE, path.join(storageDir, "state.vscdb"));
  }
}

/**
 * Saves the profile from a user-data dir whose window has been closed (VS Code
 * writes the window rectangle and the sidebar width when it closes). Only the
 * window rectangle is taken from `storage.json`: the rest holds machine ids.
 * Returns a one-line description of what was saved.
 */
export function saveProfile(userData: string): string {
  const storageDir = globalStorageDir(userData);
  const storageFile = path.join(storageDir, "storage.json");
  const stateFile = path.join(storageDir, "state.vscdb");
  if (!fs.existsSync(storageFile) || !fs.existsSync(stateFile)) {
    throw new Error("VS Code did not write its state: close the window normally (not by killing the process).");
  }
  const storage = JSON.parse(fs.readFileSync(storageFile, "utf8")) as {
    windowsState?: { lastPluginDevelopmentHostWindow?: { uiState?: unknown } };
  };
  const uiState = storage.windowsState?.lastPluginDevelopmentHostWindow?.uiState;
  if (!isWindowState(uiState)) {
    throw new Error("VS Code did not record the window position.");
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.writeFileSync(PROFILE_WINDOW, JSON.stringify(uiState, null, 2), "utf8");
  fs.copyFileSync(stateFile, PROFILE_STATE);
  return `window ${uiState.width}x${uiState.height} at (${uiState.x}, ${uiState.y})`;
}
