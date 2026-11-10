/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Picks the most informative form of a file path that fits a given width.
// Kept in its own side-effect-free file (no acquireVsCodeApi/document usage) so
// it can be loaded as a global before sidebar.js in the webview, and required
// directly by Node-based unit tests (Mocha) without any DOM/vscode stubbing.
//
// A path is a list of folders plus a file name. The file name is never cut:
// folders in the middle are replaced by an ellipsis, so every candidate keeps
// the file name, and the candidates are tried from the longest to the shortest.
//
//   src/media/styles/sidebar.css      (everything fits)
//   src/…/styles/sidebar.css          (first folder + last folders)
//   …/styles/sidebar.css              (last folders only)
//   …/sidebar.css                     (file name with a hint of folders)
//   sidebar.css                       (file name alone)
const ELLIPSIS = "\u2026";

// Every form of `path` from the full path down to the bare file name, ordered
// from the longest to the shortest. Folders are always dropped from the middle.
function pathCandidates(path) {
  const parts = String(path).split("/");
  const file = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  if (dirs.length === 0) {
    return [file];
  }
  const found = [{ text: path, tail: dirs.length }];
  for (let head = 0; head < dirs.length; head++) {
    for (let tail = 0; head + tail < dirs.length; tail++) {
      const kept = dirs.slice(0, head).concat([ELLIPSIS], dirs.slice(dirs.length - tail));
      found.push({ text: kept.concat([file]).join("/"), tail: tail });
    }
  }
  // Longest first; between equal lengths prefer the one that keeps more of the
  // folders nearest to the file.
  found.sort((a, b) => b.text.length - a.text.length || b.tail - a.tail);
  const texts = [];
  for (const candidate of found) {
    if (texts.indexOf(candidate.text) === -1) {
      texts.push(candidate.text);
    }
  }
  texts.push(file);
  return texts;
}

// Returns the longest candidate whose measured width is within `available`.
// `measure(text)` returns the rendered width of a string (any unit, as long as
// it matches `available`). When nothing fits, the bare file name is returned
// and the caller's CSS ellipsis is the last resort.
function fitPath(path, available, measure) {
  const candidates = pathCandidates(path);
  for (const text of candidates) {
    if (measure(text) <= available) {
      return text;
    }
  }
  return candidates[candidates.length - 1];
}

// Exposes the functions to Node-based unit tests. This branch never executes
// inside the real webview, where `module` is undefined, so it has no effect
// on production behavior.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { pathCandidates, fitPath };
}
