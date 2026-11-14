/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Read-only code-link badge shown on cards, in the viewer, and in the editor,
// fitted to its row's width (media/linkPath.js picks the path form).

import { vscode } from "./core.js";

// "42" or "42-50".
function linkRange(link) {
  return link.lineEnd && link.lineEnd > link.lineStart ? `${link.lineStart}-${link.lineEnd}` : `${link.lineStart}`;
}

// "path/to/file.ts:42" or "path/to/file.ts:42-50".
function linkLabel(link) {
  return `${link.filePath}:${linkRange(link)}`;
}

// Text width measured with the badge's own font. A canvas keeps this free of
// layout work, so trying several path forms per resize stays cheap.
let linkMeasureCtx = null;
function measureLinkText(text, font) {
  if (!linkMeasureCtx) {
    linkMeasureCtx = document.createElement("canvas").getContext("2d");
  }
  linkMeasureCtx.font = font;
  return linkMeasureCtx.measureText(text).width;
}

// Shows the longest form of the path that fits its row (the full path when
// there is room, folders in the middle replaced by an ellipsis as the row
// narrows, the file name always kept). Re-run whenever the row is resized.
export function fitLinkRow(row) {
  const badge = row.querySelector(".link-badge");
  const textEl = badge && badge.querySelector(".link-badge-text");
  const rowWidth = row.getBoundingClientRect().width;
  if (!textEl || rowWidth === 0) {
    // Not laid out yet (hidden modal): the resize observer calls this again when shown.
    return;
  }
  const chrome = badge.getBoundingClientRect().width - textEl.getBoundingClientRect().width;
  const available = rowWidth - chrome - 1;
  const suffix = badge.dataset.suffix;
  const font = getComputedStyle(textEl).font;
  const shown = fitPath(badge.dataset.path, available, (text) => measureLinkText(`${text}${suffix}`, font));
  const next = `${shown}${suffix}`;
  if (textEl.textContent !== next) {
    textEl.textContent = next;
  }
}

// One observer for every link row (cards, viewer, editor). A row removed from
// the page reports a final empty size, which is when it is released.
export const linkRowObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    if (!entry.target.isConnected) {
      linkRowObserver.unobserve(entry.target);
      continue;
    }
    fitLinkRow(entry.target);
  }
});

function linkStateHint(link) {
  if (link.state === "missing") {
    return "The file no longer exists at this path. The note is kept.";
  }
  if (link.state === "changed") {
    return "The linked code changed, so this line may no longer match.";
  }
  return "Open this location in the editor";
}

// Read-only badge for a note's code link. Clicking it asks the host to open
// the file at the (re-resolved) line; the badge itself is never editable.
export function buildLinkBadge(item) {
  const link = item.link;
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = `link-badge link-${link.state}`;
  // The tooltip and the accessible name always carry the full, uncut location.
  badge.dataset.tooltip = `${linkLabel(link)}\n${linkStateHint(link)}`;
  badge.setAttribute("aria-label", `${linkLabel(link)}. ${linkStateHint(link)}`);
  badge.dataset.path = link.filePath;
  badge.dataset.suffix = `:${linkRange(link)}`;
  badge.setAttribute("dir", "ltr");
  const icon = document.createElement("span");
  icon.className = `codicon ${link.state === "ok" ? "codicon-file-code" : "codicon-warning"}`;
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "link-badge-text";
  text.textContent = linkLabel(link);
  badge.appendChild(icon);
  badge.appendChild(text);
  badge.addEventListener("click", (e) => {
    e.stopPropagation();
    vscode.postMessage({ type: "openLink", id: item.id });
  });
  return badge;
}
