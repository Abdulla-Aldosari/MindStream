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
import { buildProgressBar, buildTaskCheck, setTaskCheck } from "./taskProgress.js";

let viewingItem = null;

const { formatDateTime: formatDate } = DateFormat;

export function openView(item) {
  closeAllModals();
  renderView(item);
  viewModalEl.hidden = false;
}

// Re-reads the open note from the latest state (after a task was checked, or
// an external file change). A note that no longer exists closes the viewer.
export function refreshView() {
  if (viewModalEl.hidden || !viewingItem) {
    return;
  }
  const fresh = state.items.find((it) => it.id === viewingItem.id);
  if (!fresh) {
    closeView({ skipFlash: true });
    return;
  }
  renderView(fresh);
}

// Identifies the rows currently drawn: same note, same archived state, and
// same titles in the same order means only the check marks can differ, so rows
// are updated in place and keep their focus (moving focus by script would show
// the tooltip). Archiving or unarchiving redraws the rows (read-only or not).
let renderedTasksKey = null;

function tasksKey(item) {
  return TaskList.isTaskGroup(item) ? JSON.stringify([item.id, !!item.archived, item.tasks.map((t) => t.title)]) : null;
}

// Draws the checklist of a task group note with its progress bar.
function renderViewTasks(item) {
  const box = $("view-tasks");
  const list = $("view-tasks-list");
  const progressHolder = $("view-tasks-progress");
  box.hidden = !TaskList.isTaskGroup(item);
  progressHolder.textContent = "";
  if (box.hidden) {
    list.textContent = "";
    renderedTasksKey = null;
    return;
  }
  box.setAttribute("dir", state.direction);
  progressHolder.appendChild(buildProgressBar(item.tasks));

  // An archived note is read-only: its tasks are shown but cannot be checked.
  const readOnly = !!item.archived;
  list.classList.toggle("read-only", readOnly);
  const key = tasksKey(item);
  if (key !== renderedTasksKey) {
    renderedTasksKey = key;
    list.textContent = "";
    item.tasks.forEach((task, index) => list.appendChild(buildViewTaskRow(task, index, readOnly)));
  }
  item.tasks.forEach((task, index) => {
    const row = list.children[index];
    row.classList.toggle("completed", task.completed);
    const check = row.querySelector(".task-check");
    setTaskCheck(check, task.completed);
    if (readOnly) {
      delete check.dataset.tooltip;
    } else {
      check.dataset.tooltip = task.completed ? "Mark as not done" : "Mark as done";
    }
  });
}

function buildViewTaskRow(task, index, readOnly) {
  const row = document.createElement("li");
  row.className = "task-row";

  const seq = document.createElement("span");
  seq.className = "task-seq";
  seq.textContent = `${index + 1}.`;
  row.appendChild(seq);

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;
  row.appendChild(title);

  const check = buildTaskCheck(task.completed, task.title);
  row.appendChild(check);
  if (readOnly) {
    // Out of the tab order and not clickable; aria-checked still reports the state.
    check.disabled = true;
    return row;
  }
  // The whole row toggles the task; clicks on the check box bubble to this
  // handler too, and its Enter/Space activation keeps keyboard access.
  row.addEventListener("click", () => toggleTask(index));
  return row;
}

// Flips one task right away, then asks the host to store it. The host checks
// the title at that index, and its next state confirms or corrects the view.
function toggleTask(index) {
  if (!viewingItem || viewingItem.archived || !viewingItem.tasks || !viewingItem.tasks[index]) {
    return;
  }
  const task = viewingItem.tasks[index];
  const completed = !task.completed;
  const tasks = viewingItem.tasks.slice();
  tasks[index] = { title: task.title, completed };
  // A copy, so the note in `state.items` changes only through the host's state.
  viewingItem = Object.assign({}, viewingItem, { tasks });
  renderViewTasks(viewingItem);
  vscode.postMessage({ type: "setTaskCompleted", id: viewingItem.id, index, title: task.title, completed });
}

function renderView(item) {
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

  renderViewTasks(item);

  const linkEl = $("view-link");
  linkEl.textContent = "";
  linkEl.hidden = !item.link;
  if (item.link) {
    linkEl.appendChild(buildLinkBadge(item));
    linkRowObserver.observe(linkEl);
  }

  $("view-timestamps").textContent = `Created: ${formatDate(item.createdAt)}\u2003\u00b7\u2003Updated: ${formatDate(item.updatedAt)}`;

  // An archived note is read-only: unarchive it to edit. The hint says why
  // there is no Edit button.
  $("view-edit").hidden = !!item.archived;
  $("view-archived-hint").hidden = !item.archived;
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
  if (TaskList.isTaskGroup(item)) {
    lines.push("");
    item.tasks.forEach((task) => lines.push(`- [${task.completed ? "x" : " "}] ${task.title}`));
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
    if (item && item.archived) {
      return;
    }
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
