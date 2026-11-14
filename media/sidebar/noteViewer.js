/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The read-only note viewer and its options menu (Copy ID / Copy content).

import { $, esc, listEl, state, typeOf, viewModalEl, vscode } from "./core.js";
import { bindActionMenu, menuCloseHandlers, renderActionMenu } from "./customSelect.js";
import { closeAllModals } from "./overlays.js";
import { buildLinkBadge, linkRowObserver } from "./linkBadge.js";
import { flashCard } from "./list.js";
import { openEdit } from "./noteEditor.js";

let viewingItem = null;

function formatDate(value) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleString();
}

export function openView(item) {
  closeAllModals();
  viewingItem = item;

  const t = typeOf(item.typeId);
  const cat = state.categories.find((c) => c.id === item.categoryId);

  const titleEl = $("view-title");
  titleEl.textContent = item.title;
  titleEl.setAttribute("dir", state.direction);

  const typeEl = $("view-type");
  typeEl.innerHTML = `<span class="${iconClass(t.icon)}"></span><span class="chip-label">${esc(t.label)}</span>`;

  const catEl = $("view-category");
  catEl.innerHTML = cat ? `<span class="chip-label">${esc(cat.label)}</span>` : "";
  catEl.hidden = !cat;

  const statusEl = $("view-status");
  statusEl.className = `status ${item.status}`;
  statusEl.innerHTML = `<span class="chip-label">${esc(state.statusLabels[item.status] || item.status)}</span>`;

  const descEl = $("view-desc");
  descEl.setAttribute("dir", state.direction);
  descEl.hidden = !item.description;
  $("view-desc-content").textContent = item.description || "";

  const linkEl = $("view-link");
  linkEl.textContent = "";
  linkEl.hidden = !item.link;
  if (item.link) {
    linkEl.appendChild(buildLinkBadge(item));
    linkRowObserver.observe(linkEl);
  }

  $("view-timestamps").textContent = `Created: ${formatDate(item.createdAt)}\u2003\u00b7\u2003Updated: ${formatDate(item.updatedAt)}`;

  viewModalEl.hidden = false;
}

export function closeView(options) {
  const skipFlash = !!(options && options.skipFlash);
  const itemId = viewingItem ? viewingItem.id : null;
  viewModalEl.hidden = true;
  viewingItem = null;

  // Close the viewer options menu if it is still open (it lives inside this
  // modal and should never outlive it).
  if (menuCloseHandlers["viewer-options-menu"]) {
    menuCloseHandlers["viewer-options-menu"]();
  }

  // Flash the card that was being viewed so the user can spot it after the
  // modal closes. The card may no longer exist (deleted or filtered out
  // while viewing), in which case this is a harmless no-op. Skipped when
  // transitioning straight into another modal (e.g. Edit), where the card is
  // immediately covered and the flash would only be distracting.
  if (itemId && !skipFlash) {
    const card = listEl.querySelector(`.card[data-id="${itemId}"]`);
    if (card) {
      flashCard(card);
    }
  }
}

// Builds the formatted plain-text payload for the "Copy content" action.
// Layout: title, then an optional blank line + description, then (when the
// copy includeNoteInfo setting is enabled) a blank line + note-info footer
// with the note's category, type, status, and timestamps.
function buildNoteCopyText(item) {
  const lines = [`# ${item.title}`];
  if (item.description) {
    lines.push("");
    lines.push(item.description);
  }
  if (state.copyIncludeNoteInfo) {
    const cat = state.categories.find((c) => c.id === item.categoryId);
    const t = typeOf(item.typeId);
    const statusLabel = state.statusLabels[item.status] || item.status;

    lines.push("");
    lines.push("# Note info :");
    lines.push(`- Category: ${cat ? cat.label : "None"}`);
    lines.push(`- Type: ${t.label}`);
    lines.push(`- Status: ${statusLabel}`);
    lines.push(`- Created: ${formatDate(item.createdAt)}`);
    lines.push(`- Updated: ${formatDate(item.updatedAt)}`);
  }
  return lines.join("\n");
}

// Copying is delegated to the extension host (vscode.env.clipboard), since
// navigator.clipboard is unreliable inside VS Code webviews.
function copyTextToClipboard(text) {
  vscode.postMessage({ type: "copyToClipboard", text });
}

function handleViewerOption(action) {
  if (!viewingItem) {
    return;
  }
  if (action === "copy-id") {
    copyTextToClipboard(viewingItem.id);
  } else if (action === "copy-content") {
    copyTextToClipboard(buildNoteCopyText(viewingItem));
  }
}

export function initNoteViewer() {
  $("view-close").addEventListener("click", closeView);
  $("view-close-btn").addEventListener("click", closeView);
  $("view-edit").addEventListener("click", () => {
    const item = viewingItem;
    closeView({ skipFlash: true });
    if (item) {
      openEdit(item);
    }
  });

  // Viewer options menu: render the action menu into the header wrapper, then
  // bind the icon-only trigger once (the header is static and never re-rendered).
  $("viewer-options-wrap").insertAdjacentHTML(
    "beforeend",
    renderActionMenu(
      "viewer-options-menu",
      [
        { action: "copy-id", label: "Copy ID", icon: "link" },
        { action: "copy-content", label: "Copy content", icon: "copy" },
      ],
      ""
    )
  );
  bindActionMenu("viewer-option-btn", "viewer-options-menu", handleViewerOption);
}
