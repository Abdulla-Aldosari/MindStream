/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { invalid } from "../noteInput";

/**
 * Pure matching of an agent's `workspace` path against the folders open in VS
 * Code windows. The platform is passed in (never read from `process.platform`)
 * so every case runs on every machine.
 */

export type Platform = "win32" | "posix";

/** The platform this process runs on, in the form the matching functions take. */
export function currentPlatform(): Platform {
  return process.platform === "win32" ? "win32" : "posix";
}

/**
 * Normalizes a folder path for comparison: `/` separators, no trailing
 * separator, no `.` segment, and (on Windows) lower case.
 */
export function normalizeFolder(folder: string, platform: Platform): string {
  let value = folder.replace(/\\/g, "/");
  if (platform === "win32") {
    value = value.toLowerCase();
  }
  const segments = value.split("/").filter((segment) => segment !== "" && segment !== ".");
  // A path that starts with a separator keeps one: it is the root (or the start of a UNC path).
  return `${value.startsWith("/") ? "/" : ""}${segments.join("/")}`;
}

/** True for a path that names one place on this machine: a drive or UNC path on Windows, a path starting with `/` otherwise. */
export function isAbsoluteWorkspace(workspace: string, platform: Platform): boolean {
  return platform === "win32" ? /^[a-zA-Z]:[\\/]/.test(workspace) || /^[\\/]{2}[^\\/]/.test(workspace) : workspace.startsWith("/");
}

/** Refuses a `workspace` that is not an absolute path (`INVALID_INPUT`). Returns it unchanged. */
export function requireWorkspace(workspace: unknown, platform: Platform): string {
  if (typeof workspace !== "string" || !workspace.trim() || !isAbsoluteWorkspace(workspace.trim(), platform)) {
    throw invalid("workspace is not an absolute path", "Send workspace as the absolute path of your project root, the folder open in VS Code.");
  }
  return workspace.trim();
}

/** True when `workspace` is `folder` itself or inside it, counted only on a separator boundary (`/proj` never matches `/proj-b`). */
export function isInside(workspace: string, folder: string, platform: Platform): boolean {
  const w = normalizeFolder(workspace, platform);
  const f = normalizeFolder(folder, platform);
  return w === f || w.startsWith(f.endsWith("/") ? f : `${f}/`);
}

/** The entry whose folder contains `workspace`, preferring the longest (innermost) folder; `undefined` when none does. */
export function matchWorkspace<T extends { folder: string }>(workspace: string, entries: readonly T[], platform: Platform): T | undefined {
  let best: T | undefined;
  let bestLength = -1;
  for (const entry of entries) {
    if (isInside(workspace, entry.folder, platform)) {
      const length = normalizeFolder(entry.folder, platform).length;
      if (length > bestLength) {
        best = entry;
        bestLength = length;
      }
    }
  }
  return best;
}
