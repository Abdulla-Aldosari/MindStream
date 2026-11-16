/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Shared state of the sidebar app: the VS Code API handle (acquireVsCodeApi()
// may be called only once per webview), the UI state, the persisted view
// choices, the main elements, and small helpers used everywhere.

export const vscode = acquireVsCodeApi();

// iconClass() is defined in media/iconClass.js, loaded as a global before
// this bundle (see sidebarProvider.ts's getHtml()). The data-tooltip
// system (media/tooltip.js) is loaded the same way.

const saved = vscode.getState() || {};

export const DEFAULT_DESCRIPTION_HEIGHT = 128;

// Vertical breathing room kept between the note-editor card and the viewport
// edge (12px top + 12px bottom). The description height is clamped against it
// in media/sidebar/noteEditor.js, and Focus mode uses it in taskEditor.js.
export const MODAL_GUTTER = 24;

export const state = {
  items: [],
  types: [],
  categories: [],
  statusLabels: {},
  includeArchived: false,
  editingId: null,
  // Group / sort / priority filter; rules live in media/viewOptions.js.
  view: ViewOptions.restoreView(saved),
  collapsed: ViewOptions.restoreCollapsed(saved.collapsed),
  // Priority feature set from the host (disabled until the first state arrives).
  priority: ViewOptions.NO_PRIORITY,
  // Value picked in the note editor's priority control (null = none selected).
  formPriority: null,
  categoryFilter: saved.categoryFilter || "all",
  typeFilter: saved.typeFilter || "all",
  formTypeId: null,
  formCategoryId: null,
  formTypeTouched: false,
  // True while the open "new note" form carries a code link (display only).
  formLinked: false,
  pendingTypeIcon: "tag",
  iconsModalMode: null,
  direction: "ltr",
  emojiPalette: [],
  emojiRecents: [],
  descriptionHeight: DEFAULT_DESCRIPTION_HEIGHT,
  copyIncludeNoteInfo: true,
  emojiTarget: null,
};

export const $ = (id) => document.getElementById(id);
export const listEl = $("list");
export const emptyEl = $("empty");
export const modalEl = $("modal");
export const viewModalEl = $("view-modal");

export function persist() {
  vscode.setState({
    groupBy: state.view.groupBy,
    sortBy: state.view.sortBy,
    hiddenPriorities: state.view.hiddenPriorities,
    collapsed: state.collapsed,
    categoryFilter: state.categoryFilter,
    typeFilter: state.typeFilter,
  });
}

export function typeOf(typeId) {
  const t = state.types.find((x) => x.id === typeId);
  return t || { id: typeId, label: "(Deleted type)", icon: "tag" };
}

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
