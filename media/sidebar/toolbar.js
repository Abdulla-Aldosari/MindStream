/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The toolbar: category and type filters, the "View" menu, and the archive toggle.

import { $, persist, state, vscode } from "./core.js";
import { bindCustomSelect, menuCloseHandlers, renderCustomSelect } from "./customSelect.js";
import { itemsInCategory, renderList } from "./list.js";

// The toolbar "View" menu, created by initToolbar().
let viewMenu = null;

export function setArchiveVisible(visible) {
  state.includeArchived = visible;
  $("btn-archive-toggle").textContent = visible ? "Hide archive" : "Archive";
}

export function populateCategoryFilter() {
  const current = state.categoryFilter;
  const totalCount = state.items.length;
  const options = [{ value: "all", label: "All Categories", badgeEnd: `(${totalCount})` }].concat(
    state.categories.map(function (c) {
      const count = state.items.filter(function (it) {
        return it.categoryId === c.id;
      }).length;
      return { value: c.id, label: c.label, badgeEnd: `(${count})` };
    })
  );
  if (state.categories.length && !state.categories.some((c) => c.id === current)) {
    state.categoryFilter = "all";
  }
  $("category-filter-container").innerHTML = renderCustomSelect(
    "category-filter-wrap",
    "category-filter-btn",
    "category-filter-menu",
    options,
    state.categoryFilter,
    "cs-btn-toolbar",
    false,
    ""
  );
  // Tooltip goes on the button itself, not the outer container: the
  // container also holds the dropdown menu, and a tooltip attribute on an
  // ancestor of .cs-item would be picked up by closest() while hovering
  // menu items, showing the wrong tooltip.
  $("category-filter-btn").dataset.tooltip = "Filter by category";
  bindCustomSelect("category-filter-wrap", "category-filter-btn", "category-filter-menu", function (value) {
    state.categoryFilter = value;
    persist();
    populateTypeFilter();
    renderList();
  });
}

export function populateTypeFilter() {
  const current = state.typeFilter;
  const inCategory = itemsInCategory();
  const options = [{ value: "all", label: "All Types", badgeEnd: `(${inCategory.length})` }].concat(
    state.types.map(function (t) {
      const count = inCategory.filter(function (it) {
        return it.typeId === t.id;
      }).length;
      return {
        value: t.id,
        label: t.label,
        badgeStart: t.icon ? `<span class="${iconClass(t.icon)}"></span>` : "",
        badgeEnd: `(${count})`,
      };
    })
  );
  if (state.types.length && !state.types.some((t) => t.id === current)) {
    state.typeFilter = "all";
  }
  $("type-filter-container").innerHTML = renderCustomSelect("type-filter-wrap", "type-filter-btn", "type-filter-menu", options, state.typeFilter, "cs-btn-toolbar", false, "");
  // Tooltip on the button (not the container), matching the other filters.
  $("type-filter-btn").dataset.tooltip = "Filter by type";
  bindCustomSelect("type-filter-wrap", "type-filter-btn", "type-filter-menu", function (value) {
    state.typeFilter = value;
    persist();
    renderList();
  });
}

export function setView(next) {
  state.view = next;
  persist();
  renderViewOptions();
  renderList();
}

export function renderViewOptions() {
  const filtered = ViewOptions.isFilterActive(state.view, state.priority);
  $("view-options-label").textContent = ViewOptions.triggerLabel(state.view, state.priority);
  $("view-options-icon").className = `codicon ${filtered ? "codicon-filter-filled view-options-filtered" : "codicon-list-filter"}`;
  $("view-options-btn").dataset.tooltip = filtered ? "View options (some priorities are hidden)" : "View options";
  viewMenu.setEntries(ViewOptions.menuEntries(state.view, state.priority));
}

export function initToolbar() {
  // --- Toolbar "View" menu (group / sort / priority filter) ---
  // DropdownMenu (media/dropdown-menu.js) is appended to <body>, so the
  // button's own data-tooltip never wraps the menu items (unlike .cs-wrap).
  viewMenu = DropdownMenu.create({
    trigger: $("view-options-btn"),
    label: "View options",
    entries: [],
    onSelect(detail) {
      const next = ViewOptions.applySelection(state.view, detail);
      if (next) {
        setView(next);
      }
    },
  });
  // Lets closeAllDropdowns() dismiss it together with the custom selects.
  menuCloseHandlers["view-options-menu"] = () => viewMenu.close(false);

  $("btn-archive-toggle").addEventListener("click", () => {
    vscode.postMessage({ type: "toggleArchiveView" });
  });
}
