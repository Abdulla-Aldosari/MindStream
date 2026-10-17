/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Pure emoji helpers for the webview. Kept side-effect-free (no
// acquireVsCodeApi/document usage) so it can be loaded as a global before
// sidebar.js in the webview, and required directly by Node-based unit tests
// (Mocha) without any DOM/vscode stubbing.

// Splits a plain text sequence into individual emoji (grapheme clusters),
// discarding whitespace/newlines, so users can paste or type emoji one after
// another without worrying about separators. Intl.Segmenter keeps multi-codepoint
// sequences (ZWJ families, flags, variation selectors) intact.
function splitEmojis(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const out = [];
  for (const { segment } of segmenter.segment(text)) {
    if (segment.trim().length > 0) {
      out.push(segment);
    }
  }
  return out;
}

// Returns true when the given grapheme is an emoji rather than plain text
// (letters, digits, punctuation). Matches emoji-presentation symbols,
// pictographs, regional indicators (flags), and keycap/variation markers, but
// deliberately excludes the bare keycap bases (digits, #, *) that also carry
// the Emoji property.
const EMOJI_GLYPH_RE = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}|\uFE0F|\u20E3/u;

function isEmoji(text) {
  return typeof text === "string" && EMOJI_GLYPH_RE.test(text);
}

// Exposes the functions to Node-based unit tests. This branch never executes
// inside the real webview, where `module` is undefined, so it has no effect
// on production behavior.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { splitEmojis, isEmoji };
}
