/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Rules for telling whether the note form holds changes that closing it would
// lose. Side-effect-free (no DOM, no acquireVsCodeApi), so it is loaded as a
// global before sidebar.js and required directly by Mocha tests.

const NoteForm = (() => {
  /** Line breaks as the form stores them: LF only (the description tab may use CRLF). */
  function normalizeText(text) {
    return String(text == null ? "" : text).replace(/\r\n?/g, "\n");
  }

  /**
   * A comparable copy of the form's fields. Tasks with a blank title are left
   * out because the host drops them on Save, and the title is trimmed for the
   * same reason.
   */
  function snapshot(fields) {
    const f = fields || {};
    const tasks = Array.isArray(f.tasks) ? f.tasks : [];
    return {
      title: String(f.title == null ? "" : f.title).trim(),
      description: normalizeText(f.description),
      typeId: f.typeId == null ? null : f.typeId,
      categoryId: f.categoryId == null ? null : f.categoryId,
      priority: f.priority == null ? null : f.priority,
      tasks: tasks.filter((t) => t && String(t.title == null ? "" : t.title).trim() !== "").map((t) => ({ title: String(t.title).trim(), completed: t.completed === true })),
    };
  }

  /** True when any field of `current` differs from the `initial` snapshot. */
  function hasChanges(initial, current) {
    if (!initial || !current) {
      return false;
    }
    return JSON.stringify(initial) !== JSON.stringify(current);
  }

  /**
   * What closing the form should do: "close" at once, or "confirm" (ask the
   * host). Closing never loses anything when nothing changed or when the
   * setting says to leave without asking.
   */
  function closeAction(behavior, initial, current) {
    if (behavior === "discard") {
      return "close";
    }
    return hasChanges(initial, current) ? "confirm" : "close";
  }

  return { normalizeText, snapshot, hasChanges, closeAction };
})();

// Node-only export for the unit tests; the browser keeps the global above.
if (typeof module !== "undefined" && module.exports) {
  module.exports = NoteForm;
}
