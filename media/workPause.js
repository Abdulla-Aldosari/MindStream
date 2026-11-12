/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// View/edit rules of the Work Pause note. Side-effect-free (no DOM, no
// acquireVsCodeApi), so it is loaded as a global before sidebar.js and required
// directly by Mocha tests.
//
// The note is either being read ("view") or edited ("edit"). The saved text
// comes from the host; a draft exists only while editing and is never written
// anywhere until the user saves it.

const WorkPause = (() => {
  /**
   * Whether a state message may replace the shown text. While editing, the
   * draft is the user's work: an incoming (possibly external) change must not
   * overwrite it, so only the saved copy and the date are refreshed.
   */
  function shouldReplaceDraft(mode) {
    return mode !== "edit";
  }

  /** True when the draft differs from the saved text, so leaving needs a confirmation. */
  function hasUnsavedChanges(savedText, draft) {
    return String(draft == null ? "" : draft) !== String(savedText == null ? "" : savedText);
  }

  /** A draft can be saved only when it has visible text. */
  function canSave(draft) {
    return String(draft == null ? "" : draft).trim().length > 0;
  }

  /**
   * What Cancel / Esc does while editing:
   * - "leave": nothing would be lost, go back at once;
   * - "confirm": the draft differs from the saved text, so ask the host first
   *   (the answer arrives as a message).
   */
  function cancelAction(savedText, draft) {
    return hasUnsavedChanges(savedText, draft) ? "confirm" : "leave";
  }

  // A letter of the Arabic script (the lookahead excludes Arabic-Indic digits
  // and Arabic punctuation, which share the script but are not letters).
  const ARABIC_LETTER = /(?=\p{L})\p{Script=Arabic}/u;

  /**
   * Text direction of a note, decided by its first non-empty line only: "rtl"
   * when that line contains an Arabic letter, otherwise "ltr". The
   * `mindstream.ui.direction` setting plays no part in it.
   */
  function directionFor(text) {
    const firstLine = String(text == null ? "" : text)
      .split(/\r\n|\r|\n/)
      .find((line) => line.trim().length > 0);
    return firstLine !== undefined && ARABIC_LETTER.test(firstLine) ? "rtl" : "ltr";
  }

  /**
   * Builds the "last updated" line, or "" when no valid date is known.
   * `format` turns a Date into text (the webview passes toLocaleString).
   */
  function updatedLabel(updatedAt, format) {
    if (!updatedAt) {
      return "";
    }
    const date = new Date(updatedAt);
    return isNaN(date.getTime()) ? "" : `Updated: ${format(date)}`;
  }

  /**
   * Renders the note text for view mode: escapes all HTML, then turns a
   * leading "- [x]" / "- [ ]" (or "*…") into a display-only checkbox, a
   * leading "# " into a heading, a lone "---" into a divider, and `code` spans
   * into inline code. Lines keep their "\n" (except after block lines) so the
   * pre-wrap container preserves the original line breaks.
   */
  function renderNoteHtml(source) {
    const text = String(source ?? "");
    const escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const tick =
      '<svg viewBox="0 0 12 12" focusable="false" aria-hidden="true"><path d="M3 6.5 5.2 8.7 9 4.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    // Escapes a line's text, then turns `code` spans into <code>. Backticks are not
    // touched by escapeHtml, and the span content is already escaped, so no raw
    // user HTML can get in. An unclosed or empty pair stays literal.
    const inline = (value) => escapeHtml(value).replace(/`([^`]+)`/g, '<code class="work-pause-code">$1</code>');

    const CHECK_LINE = /^(\s*)(?:[-*]\s+)?\[([ xX])\](?=\s|$)/;

    // `block` lines (heading, divider, first checkbox of a group) are
    // display:block, so they fill their own line: a "\n" after them would render
    // as an extra blank line.
    const renderLine = (line, startsGroup) => {
      const check = line.match(CHECK_LINE);
      if (check) {
        const checked = check[2].toLowerCase() === "x";
        const rest = line.slice(check[0].length);
        const html = `${check[1]}<span class="work-pause-check" aria-hidden="true">${checked ? tick : ""}</span>${inline(rest)}`;
        // The first checkbox of a group sits in a block so CSS can space it from the line above.
        return startsGroup ? { html: `<span class="work-pause-list-start">${html}</span>`, block: true } : { html, block: false };
      }

      const heading = line.match(/^#(?=\s)(.*)$/);
      if (heading) {
        return { html: `<span class="work-pause-h1">${inline(heading[1].replace(/^\s+/, ""))}</span>`, block: true };
      }

      if (/^-{3}$/.test(line)) {
        return { html: '<span class="work-pause-divider" aria-hidden="true"></span>', block: true };
      }

      return { html: inline(line), block: false };
    };

    const lines = text.split(/\r\n|\r|\n/);
    // A group starts at a checkbox line whose previous line is not a checkbox. The
    // very first line and a line after a blank one get no extra space: nothing is
    // above them, or the blank line already separates them.
    const startsGroup = (index) => index > 0 && CHECK_LINE.test(lines[index]) && !CHECK_LINE.test(lines[index - 1]) && lines[index - 1].trim() !== "";
    return lines
      .map((line, index) => {
        const { html, block } = renderLine(line, startsGroup(index));
        return block || index === lines.length - 1 ? html : `${html}\n`;
      })
      .join("");
  }

  return { shouldReplaceDraft, hasUnsavedChanges, canSave, cancelAction, directionFor, updatedLabel, renderNoteHtml };
})();

// Exposes the helpers to Node-based unit tests. This branch never runs in the
// real webview, where `module` is undefined.
if (typeof module !== "undefined" && module.exports) {
  module.exports = WorkPause;
}
