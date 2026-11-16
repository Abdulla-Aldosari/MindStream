/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The note editor's task list: one row per task (sequence, single-line title,
// completed checkbox, drag handle, remove). The list is the form's own copy;
// the host stores it only when the note is saved (and drops empty titles).

import { $, MODAL_GUTTER, modalEl, state } from "./core.js";
import { buildTaskCheck, setTaskCheck } from "./taskProgress.js";

// The form's tasks, in order: [{ title, completed }].
let formTasks = [];
// The pointer drag in progress ({ row, pointerId }), or null.
let drag = null;

const listEl = () => $("f-tasks");

/** Fills the form with a copy of `tasks` (none for a new note). */
export function setFormTasks(tasks) {
  formTasks = Array.isArray(tasks) ? tasks.map((t) => ({ title: t.title, completed: !!t.completed })) : [];
  endDrag();
  // Every editor opens in the normal layout.
  setFocusMode(false);
  renderFormTasks();
}

/** A copy of the form's tasks, for the editor's Save. */
export function getFormTasks() {
  return formTasks.map((t) => ({ title: t.title, completed: t.completed }));
}

/**
 * Brings the list back to the first task. The editor fills the form while the
 * modal is still hidden; a hidden scroll container keeps the scroll offset it
 * had before it was hidden, and the browser restores it when it becomes
 * visible again. Without an explicit reset here a reopened editor would start
 * scrolled to whatever task was last visible. Called by the editor right after
 * it shows the modal.
 */
export function resetTaskListScroll() {
  listEl().scrollTop = 0;
}

function rowIndex(row) {
  return Array.prototype.indexOf.call(listEl().children, row);
}

function renderFormTasks() {
  const list = listEl();
  list.textContent = "";
  list.setAttribute("dir", state.direction);
  formTasks.forEach((task) => list.appendChild(buildRow(task)));
  renumber();
  syncFocusMode();
  syncInfoButton();
}

// ----- Focus mode -----
// A manual toggle that folds the description away so the task list gets the
// room. The button exists only for long lists; when the list shrinks back the
// mode is switched off by itself. Never persisted: every editor opens normally.

// The vertical gap between the card's fields (.modal-card gap).
const FOCUS_CARD_GAP = 10;

const focusBtn = () => $("f-tasks-focus");

/** Whether Focus mode is on (the description is folded away). */
export function isFocusMode() {
  return focusBtn().getAttribute("aria-pressed") === "true";
}

// Focus mode sizes the list against a fixed measurement of the card's chrome
// (everything the card keeps besides the description and the list). It is
// captured once when the mode turns on, before the description hides. Deriving
// the list height from the live card would feed the list's own height back into
// the measurement and oscillate while the window is resized.
let focusChrome = 0;

function measureFocusChrome(card) {
  focusChrome = card.offsetHeight - $("f-desc-field").offsetHeight - FOCUS_CARD_GAP - listEl().offsetHeight;
}

// The list's max-height while focusing: all the viewport room the fixed chrome
// leaves. Only the modal height changes between re-measures, so it is stable.
function applyFocusMax(card) {
  const available = modalEl.clientHeight - MODAL_GUTTER;
  card.style.setProperty("--focus-max", `${Math.max(0, available - focusChrome)}px`);
}

function setFocusMode(on) {
  const card = listEl().closest(".modal-card");
  if (on && !card.classList.contains("tasks-focus")) {
    measureFocusChrome(card);
    applyFocusMax(card);
  }
  card.classList.toggle("tasks-focus", on);
  const btn = focusBtn();
  btn.setAttribute("aria-pressed", String(on));
  btn.dataset.tooltip = on ? "Show description" : "Focus on tasks";
  btn.firstElementChild.className = `codicon ${on ? "codicon-screen-normal" : "codicon-screen-full"}`;
  if (on && state.emojiTarget === $("f-desc")) {
    // The picker must not stay anchored to the folded description.
    $("emoji-picker").hidden = true;
    state.emojiTarget = null;
  }
}

function syncFocusMode() {
  const available = TaskList.focusAvailable(formTasks.length);
  focusBtn().hidden = !available;
  if (!available) {
    setFocusMode(false);
  }
}

// The info icon (the task shortcut list) only matters once there is more than
// one task to move between, so it stays hidden otherwise.
const infoBtn = () => $("f-tasks-info");

function syncInfoButton() {
  infoBtn().hidden = formTasks.length <= 1;
}

// Sequence numbers and labels follow the row order after any move.
function renumber() {
  Array.prototype.forEach.call(listEl().children, (row, index) => {
    const seq = row.querySelector(".task-seq");
    seq.textContent = `${index + 1}.`;
    seq.setAttribute("aria-label", `Reorder task ${index + 1} (Alt+Up / Alt+Down)`);
    row.querySelector(".task-title-input").setAttribute("aria-label", `Task ${index + 1}`);
  });
}

function buildRow(task) {
  const row = document.createElement("li");
  row.className = "task-row";

  // The sequence number is the drag handle. No data-tooltip: it gets focus back
  // by script after a keyboard move, and tooltip.js shows the tooltip of any
  // focused element.
  const seq = document.createElement("button");
  seq.type = "button";
  seq.className = "task-seq";
  seq.addEventListener("keydown", (e) => {
    const to = moveByKey(e, row);
    if (to >= 0) {
      listEl().children[to].querySelector(".task-seq").focus();
    }
  });
  seq.addEventListener("pointerdown", (e) => startDrag(e, row, seq));
  row.appendChild(seq);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "task-title-input";
  input.placeholder = "Task title";
  input.value = task.title;
  input.addEventListener("input", () => {
    formTasks[rowIndex(row)].title = input.value;
  });
  input.addEventListener("keydown", (e) => onTitleKeyDown(e, row, input));
  row.appendChild(input);

  const check = buildTaskCheck(task.completed, "Completed");
  updateCheckTooltip(check, task.completed);
  check.addEventListener("click", () => {
    const entry = formTasks[rowIndex(row)];
    entry.completed = !entry.completed;
    setTaskCheck(check, entry.completed);
    updateCheckTooltip(check, entry.completed);
    row.classList.toggle("completed", entry.completed);
  });
  row.classList.toggle("completed", task.completed);
  row.appendChild(check);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-btn task-remove";
  remove.dataset.tooltip = "Remove task";
  remove.setAttribute("aria-label", "Remove task");
  remove.innerHTML = '<span class="codicon codicon-close" aria-hidden="true"></span>';
  remove.addEventListener("click", () => removeTask(rowIndex(row)));
  row.appendChild(remove);

  return row;
}

function updateCheckTooltip(check, completed) {
  check.dataset.tooltip = completed ? "Mark as not done" : "Mark as done";
}

function focusTitle(index) {
  const row = listEl().children[index];
  if (row) {
    const input = row.querySelector(".task-title-input");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function addTask(at) {
  formTasks.splice(at, 0, { title: "", completed: false });
  renderFormTasks();
  focusTitle(at);
}

function removeTask(index) {
  formTasks.splice(index, 1);
  renderFormTasks();
  if (formTasks.length) {
    focusTitle(Math.max(0, index - 1));
  } else {
    $("f-task-add").focus();
  }
}

// Alt+Up / Alt+Down moves the row (the list is rebuilt). Returns the row's new
// index, or -1 when the key is not a move (or the row is already at that end).
function moveByKey(e, row) {
  if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) {
    return -1;
  }
  e.preventDefault();
  const from = rowIndex(row);
  const to = e.key === "ArrowUp" ? from - 1 : from + 1;
  if (to < 0 || to >= formTasks.length) {
    return -1;
  }
  formTasks = TaskList.move(formTasks, from, to);
  renderFormTasks();
  return to;
}

// Ctrl+Up / Ctrl+Down (Cmd on macOS) moves focus between title inputs without
// reordering, unlike Alt+Up/Down. Returns the new index, or -1 when ignored.
function moveFocusByKey(e, row) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) {
    return -1;
  }
  e.preventDefault();
  const from = rowIndex(row);
  const to = e.key === "ArrowUp" ? from - 1 : from + 1;
  if (to < 0 || to >= formTasks.length) {
    return -1;
  }
  focusTitle(to);
  return to;
}

function onTitleKeyDown(e, row, input) {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    moveFocusByKey(e, row);
    return;
  }
  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    const to = moveByKey(e, row);
    if (to >= 0) {
      focusTitle(to);
    }
    return;
  }
  if (e.key === "Enter" && !e.isComposing) {
    e.preventDefault();
    addTask(rowIndex(row) + 1);
  } else if (e.key === "Backspace" && input.value === "" && !e.isComposing) {
    e.preventDefault();
    removeTask(rowIndex(row));
  }
}

// ----- Pointer drag on the handle -----
// The dragged row never leaves the DOM (its neighbours move around it), so the
// handle keeps its pointer capture for the whole drag.

function startDrag(e, row, handle) {
  if (e.button !== 0 || drag) {
    return;
  }
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  drag = { row, pointerId: e.pointerId };
  row.classList.add("dragging");
  listEl().classList.add("is-dragging");
  handle.addEventListener("pointermove", onDragMove);
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("lostpointercapture", endDrag);
}

function onDragMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) {
    return;
  }
  const list = listEl();
  const row = drag.row;
  const prev = row.previousElementSibling;
  const next = row.nextElementSibling;
  const middle = (el) => {
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2;
  };
  const from = rowIndex(row);
  if (prev && e.clientY < middle(prev)) {
    list.insertBefore(prev, row.nextElementSibling);
    formTasks = TaskList.move(formTasks, from, from - 1);
    renumber();
  } else if (next && e.clientY > middle(next)) {
    list.insertBefore(next, row);
    formTasks = TaskList.move(formTasks, from, from + 1);
    renumber();
  }
}

function endDrag() {
  if (!drag) {
    return;
  }
  const handle = drag.row.querySelector(".task-seq");
  handle.removeEventListener("pointermove", onDragMove);
  handle.removeEventListener("pointerup", endDrag);
  handle.removeEventListener("pointercancel", endDrag);
  handle.removeEventListener("lostpointercapture", endDrag);
  if (handle.hasPointerCapture(drag.pointerId)) {
    handle.releasePointerCapture(drag.pointerId);
  }
  drag.row.classList.remove("dragging");
  listEl().classList.remove("is-dragging");
  drag = null;
}

export function initTaskEditor() {
  focusBtn().addEventListener("click", () => {
    setFocusMode(!isFocusMode());
  });
  // Keep the focused list's allowance correct when the webview is resized (e.g.
  // the sidebar width changes the editor height) so it keeps filling the viewport.
  window.addEventListener("resize", () => {
    if (!modalEl.hidden && isFocusMode()) {
      applyFocusMax(listEl().closest(".modal-card"));
    }
  });
  $("f-task-add").addEventListener("click", () => {
    // An empty last row is reused instead of piling up blank tasks.
    const last = formTasks.length - 1;
    if (last >= 0 && !formTasks[last].title.trim()) {
      focusTitle(last);
    } else {
      addTask(formTasks.length);
    }
  });
}
