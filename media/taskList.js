/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Rules of task group notes: a note with at least one task in `item.tasks`
// (order = index). Side-effect-free (no DOM, no acquireVsCodeApi), so it is
// loaded as a global before sidebar.js and required directly by Mocha tests.

const TaskList = (() => {
  /** True when the note has at least one task. */
  function isTaskGroup(item) {
    return !!item && Array.isArray(item.tasks) && item.tasks.length > 0;
  }

  /**
   * Completed count, total, and the rounded percentage (0 for no tasks).
   * Only the count matters: tasks may be completed in any order.
   */
  function progress(tasks) {
    const list = Array.isArray(tasks) ? tasks : [];
    const total = list.length;
    const done = list.filter((t) => t && t.completed === true).length;
    return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  /**
   * Returns a new array with the entry at `from` moved to `to` (both clamped
   * to the list). The input is never changed.
   */
  function move(list, from, to) {
    const next = list.slice();
    if (!next.length) {
      return next;
    }
    const last = next.length - 1;
    const src = Math.min(Math.max(from, 0), last);
    const dst = Math.min(Math.max(to, 0), last);
    if (src === dst) {
      return next;
    }
    const [entry] = next.splice(src, 1);
    next.splice(dst, 0, entry);
    return next;
  }

  // The editor's Focus mode (description folded away) is offered only for lists
  // longer than this many tasks.
  const FOCUS_MIN_TASKS = 5;

  /** True when a list of `count` tasks is long enough to offer Focus mode. */
  function focusAvailable(count) {
    return Number.isFinite(count) && count > FOCUS_MIN_TASKS;
  }

  return { isTaskGroup, progress, move, focusAvailable, FOCUS_MIN_TASKS };
})();

// Exposes the helpers to Node-based unit tests. This branch never runs in the
// real webview, where `module` is undefined.
if (typeof module !== "undefined" && module.exports) {
  module.exports = TaskList;
}
