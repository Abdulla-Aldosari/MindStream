/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { MindStreamTask } from "./models";

/** Longest stored task title, in characters. */
export const MAX_TASK_TITLE = 500;

/**
 * Cleans a raw task list (from the webview or a hand-edited file): keeps
 * entries whose `title` is a string, trims it and folds line breaks into
 * spaces (a title is a single line), drops empty titles, caps the length, and
 * reads `completed` as true only when it is exactly `true`. Returns
 * `undefined` when no task is left, so the caller removes the key.
 */
export function sanitizeTasks(raw: unknown): MindStreamTask[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const tasks: MindStreamTask[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const { title, completed } = entry as { title?: unknown; completed?: unknown };
    if (typeof title !== "string") {
      continue;
    }
    const clean = title
      .replace(/\s*[\r\n]+\s*/g, " ")
      .trim()
      .slice(0, MAX_TASK_TITLE)
      .trim();
    if (!clean) {
      continue;
    }
    tasks.push({ title: clean, completed: completed === true });
  }
  return tasks.length ? tasks : undefined;
}
