/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The note list: category/type/priority filtering, the empty state, groups,
// and the FLIP animation when cards move.

import { emptyEl, esc, listEl, persist, state, typeOf } from "./core.js";
import { buildCard } from "./card.js";
import { openAdd } from "./noteEditor.js";
import { setView } from "./toolbar.js";

// --- Ordering / grouping ---

export function itemsInCategory() {
  if (state.categoryFilter === "all") {
    return state.items;
  }
  return state.items.filter((it) => it.categoryId === state.categoryFilter);
}

function filteredItems() {
  const items = itemsInCategory();
  if (state.typeFilter === "all") {
    return items;
  }
  return items.filter((it) => it.typeId === state.typeFilter);
}

// Category/type filters, then the priority filter. Items arrive from the
// host in file order, which "Fixed order" keeps as-is.
function visibleItems() {
  return ViewOptions.visibleItems(filteredItems(), state.view, state.priority);
}

function renderEmptyState() {
  function createButton(label) {
    return `<button type="button" class="btn btn-primary empty-create-btn">${label}</button>`;
  }

  if (state.items.length === 0) {
    emptyEl.innerHTML = `<div class="empty-text">Looks like there are no notes yet.</div>${createButton("Create your first note")}`;
    emptyEl.hidden = false;
    return;
  }

  if (itemsInCategory().length === 0) {
    emptyEl.innerHTML = `<div class="empty-text">No notes in this category.</div>${createButton("Create one")}`;
    emptyEl.hidden = false;
    return;
  }

  if (filteredItems().length === 0) {
    const t = typeOf(state.typeFilter);
    emptyEl.innerHTML = `<div class="empty-text">Looks like there are no <span class="${iconClass(t.icon)}"></span> ${esc(t.label)} notes yet.</div>${createButton("Create one")}`;
    emptyEl.hidden = false;
    return;
  }

  if (visibleItems().length === 0) {
    emptyEl.innerHTML = `<div class="empty-text">All notes here are hidden by the priority filter.</div><button type="button" class="btn btn-primary empty-show-all-btn">Show all priorities</button>`;
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
}

export function renderList(changedIds) {
  const prevPositions = capturePositions();

  listEl.innerHTML = "";
  renderEmptyState();

  const visible = visibleItems();
  if (visible.length === 0) {
    return;
  }

  const sorted = ViewOptions.sortItems(visible, state.view, state.priority);
  const groups = ViewOptions.buildGroups(sorted, state.view, state.priority, state.statusLabels);
  if (groups) {
    for (const group of groups) {
      const section = document.createElement("div");
      section.className = "group";
      section.appendChild(buildGroupHeader(group));
      if (!state.collapsed[group.key]) {
        for (const item of group.items) {
          section.appendChild(buildCard(item));
        }
      }
      listEl.appendChild(section);
    }
  } else {
    for (const item of sorted) {
      listEl.appendChild(buildCard(item));
    }
  }

  // Mark cards whose description is truncated so the "view" button appears.
  markTruncatedCards();

  // FLIP animation; "Fixed order" without groups never reorders on edits.
  if (ViewOptions.sortChain(state.view, state.priority).length > 0 || groups) {
    animateFlip(prevPositions, changedIds);
  }
}

function capturePositions() {
  const map = {};
  listEl.querySelectorAll(".card[data-id]").forEach((el) => {
    map[el.dataset.id] = el.getBoundingClientRect();
  });
  return map;
}

// Brief color-only flash used to draw attention to a card (status change,
// or the note whose view modal was just closed). Background-only so it never
// affects size, shape, or position. Only the start color is given (offset 0
// is required: a lone keyframe would otherwise be the end frame): the browser
// animates to the card's own computed background, so normal and archived
// cards (and any future state) settle on their real color.
export function flashCard(el) {
  el.animate([{ backgroundColor: "var(--ms-card-flash-color)", offset: 0 }], {
    duration: 500,
    easing: "ease",
  });
}

function animateFlip(prevPositions, changedIds) {
  const cards = listEl.querySelectorAll(".card[data-id]");
  const hasMoves = Object.keys(prevPositions).length > 0;

  cards.forEach((el) => {
    const id = el.dataset.id;
    const prev = prevPositions[id];

    if (!prev) {
      // Newly added card
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease" });
      return;
    }

    if (hasMoves) {
      const next = el.getBoundingClientRect();
      const dy = prev.top - next.top;
      if (Math.abs(dy) > 1) {
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0px)" }], {
          duration: 250,
          easing: "ease",
        });
      }
    }

    if (changedIds && changedIds[id]) {
      flashCard(el);
    }
  });
}

function markTruncatedCards() {
  listEl.querySelectorAll(".card").forEach((el) => {
    const desc = el.querySelector(".card-desc");
    if (desc && desc.scrollHeight > desc.clientHeight) {
      el.classList.add("has-overflow");
    } else {
      el.classList.remove("has-overflow");
    }
  });
}

// group: { key, label, level, items } from ViewOptions.buildGroups().
// `key` is scoped ("status:done", "priority:high") so collapse state never
// leaks between grouping modes.
function buildGroupHeader(group) {
  const header = document.createElement("div");
  header.className = `group-header${state.collapsed[group.key] ? " collapsed" : ""}`;
  header.dataset.group = group.key;

  const chevron = document.createElement("span");
  chevron.className = "chevron codicon codicon-chevron-down";
  header.appendChild(chevron);

  if (group.level) {
    const dot = document.createElement("span");
    dot.className = `prio-dot prio-${group.level}`;
    header.appendChild(dot);
  }

  const label = document.createElement("span");
  label.textContent = group.label;
  header.appendChild(label);

  const count = document.createElement("span");
  count.className = "group-count";
  count.textContent = `(${group.items.length})`;
  header.appendChild(count);

  header.addEventListener("click", () => {
    if (state.collapsed[group.key]) {
      delete state.collapsed[group.key];
    } else {
      state.collapsed[group.key] = true;
    }
    persist();
    renderList();
  });
  return header;
}

export function initList() {
  emptyEl.addEventListener("click", (e) => {
    if (e.target.closest(".empty-create-btn")) {
      openAdd();
    } else if (e.target.closest(".empty-show-all-btn")) {
      setView({ ...state.view, hiddenPriorities: [] });
    }
  });
}
