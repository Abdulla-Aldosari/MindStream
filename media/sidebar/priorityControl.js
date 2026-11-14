/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The note editor's priority control (a segmented radiogroup).

import { $, state } from "./core.js";

// --- Note-editor priority control (segmented radiogroup) ---
// Rendered only while the priority system is enabled. `value` is the
// level to select, or null for "no priority yet" (an existing note without
// a priority), which shows a hint and selects nothing until the user picks.
export function fillPriorityControl(value) {
  const field = $("f-priority-field");
  const enabled = state.priority.editor;
  field.hidden = !enabled;
  const levels = enabled ? state.priority.levels : [];
  state.formPriority = levels.includes(value) ? value : null;

  const group = $("f-priority");
  group.querySelectorAll(".pc-option").forEach((el) => el.remove());
  group.style.setProperty("--pc-count", String(Math.max(levels.length, 1)));
  for (const level of levels) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `pc-option prio-${level}`;
    option.setAttribute("role", "radio");
    option.dataset.value = level;
    const dot = document.createElement("span");
    dot.className = "pc-dot";
    dot.setAttribute("aria-hidden", "true");
    option.appendChild(dot);
    const label = document.createElement("span");
    label.className = "pc-label";
    label.textContent = state.priority.labels[level] || level;
    option.appendChild(label);
    group.appendChild(option);
  }
  syncPriorityControl();
}

// Reflects state.formPriority on the control (checked option, indicator
// position/color, roving tabindex, and the "no priority" hint).
function syncPriorityControl() {
  const group = $("f-priority");
  const options = [...group.querySelectorAll(".pc-option")];
  const index = options.findIndex((el) => el.dataset.value === state.formPriority);
  options.forEach((el, i) => {
    const checked = i === index;
    el.setAttribute("aria-checked", String(checked));
    // With nothing selected, the first option is the tab stop.
    el.tabIndex = checked || (index === -1 && i === 0) ? 0 : -1;
  });
  group.classList.toggle("pc-empty", index === -1);
  group.style.setProperty("--pc-index", String(Math.max(index, 0)));
  group.dataset.value = state.formPriority || "";
  $("f-priority-hint").hidden = index !== -1;
}

function selectPriority(level, focus) {
  if (!state.priority.levels.includes(level)) {
    return;
  }
  state.formPriority = level;
  syncPriorityControl();
  if (focus) {
    const option = $("f-priority").querySelector(`.pc-option[data-value="${level}"]`);
    if (option) {
      option.focus();
    }
  }
}

function onPriorityKeyDown(e) {
  const levels = state.priority.levels;
  if (!levels.length || !e.target.closest(".pc-option")) {
    return;
  }
  const current = levels.indexOf(e.target.dataset.value);
  // Arrows follow the visual order, which flips in a right-to-left layout.
  const rtl = getComputedStyle($("f-priority")).direction === "rtl";
  const step = { ArrowRight: rtl ? -1 : 1, ArrowDown: 1, ArrowLeft: rtl ? 1 : -1, ArrowUp: -1 }[e.key];
  let next = -1;
  if (step) {
    next = (current + step + levels.length) % levels.length;
  } else if (e.key === "Home") {
    next = 0;
  } else if (e.key === "End") {
    next = levels.length - 1;
  } else if (e.key === " " || e.key === "Enter") {
    next = current;
  }
  if (next === -1) {
    return;
  }
  e.preventDefault();
  selectPriority(levels[next], true);
}

export function initPriorityControl() {
  $("f-priority").addEventListener("click", (e) => {
    const option = e.target.closest(".pc-option");
    if (option) {
      selectPriority(option.dataset.value, false);
    }
  });
  $("f-priority").addEventListener("keydown", onPriorityKeyDown);
}
