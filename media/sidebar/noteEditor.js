/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The note editor modal (new / edit): type, category and priority fields,
// the code link, the description height, and the Save round trip with the host.

import { $, DEFAULT_DESCRIPTION_HEIGHT, listEl, MODAL_GUTTER, modalEl, state, vscode } from "./core.js";
import { bindCustomSelect, renderCustomSelect } from "./customSelect.js";
import { closeAllModals } from "./overlays.js";
import { buildLinkBadge, fitLinkRow, linkRowObserver } from "./linkBadge.js";
import { flashCard } from "./list.js";
import { fillPriorityControl } from "./priorityControl.js";
import { getFormTasks, isFocusMode, resetTaskListScroll, setFormTasks } from "./taskEditor.js";

const MIN_DESCRIPTION_HEIGHT = 55;
const MAX_DESCRIPTION_HEIGHT = 600;

let pendingFlashId = null;
let appliedDescHeight = null;
// The note editor's Save waiting for the host's answer ({ id, isEditing }), or
// null. The editor closes only once the host confirms the note was stored.
let pendingNoteSave = null;
let nextNoteSaveId = 1;
// The form's fields as they were when it opened (NoteForm.snapshot), to tell
// whether closing the form would lose changes.
let initialForm = null;
// True while the host's "save or discard your changes?" question is open.
let closeConfirming = false;
// A host request for a new note that waits for the user's answer about the
// open form's changes ({ link }), or null.
let pendingOpenRequest = null;
// The request to honor once the Save chosen in that question is confirmed, or null.
let openAfterSave = null;
// True while the description is being edited in an editor tab. The textarea is
// then read-only and shows the tab's text, so the text has a single source.
let descExternal = false;

// Locks or unlocks the description textarea for the editor tab. `text`, when
// given, becomes the textarea's value (the tab's latest text).
function setDescExternal(on, text) {
  descExternal = on;
  const desc = $("f-desc");
  if (typeof text === "string") {
    desc.value = text;
  }
  desc.readOnly = on;
  $("f-desc-external-hint").hidden = !on;
  const btn = $("f-desc-external");
  btn.classList.toggle("active", on);
  btn.setAttribute("aria-pressed", String(on));
}

// Ends the description tab when the form no longer needs it (the host closes it).
function endExternalDescription() {
  if (descExternal) {
    vscode.postMessage({ type: "closeDescriptionEditor" });
  }
  setDescExternal(false);
}

function openDescriptionEditor() {
  if (pendingNoteSave) {
    return;
  }
  vscode.postMessage({ type: "openDescriptionEditor", title: $("f-title").value.trim(), description: $("f-desc").value });
}

// The host opened (or revealed) the tab and sends its text, which may be newer
// than the form's when the tab was already open.
export function handleDescriptionEditorOpened(msg) {
  if (modalEl.hidden) {
    // The form was closed while the tab was opening: the tab has no owner.
    vscode.postMessage({ type: "closeDescriptionEditor" });
    return;
  }
  setDescExternal(true, msg.text);
}

// Every edit or save made in the tab flows into the form.
export function handleDescriptionEditorText(msg) {
  if (descExternal && !modalEl.hidden) {
    $("f-desc").value = msg.text;
  }
}

// The user closed the tab: the textarea is editable again with the final text.
export function handleDescriptionEditorClosed(msg) {
  if (descExternal && !modalEl.hidden) {
    setDescExternal(false, msg.text);
  }
}

// The form's current fields in the shape NoteForm compares.
function currentForm() {
  return NoteForm.snapshot({
    title: $("f-title").value,
    description: $("f-desc").value,
    typeId: state.formTypeId,
    categoryId: state.formCategoryId,
    priority: state.priority.editor ? state.formPriority : null,
    tasks: getFormTasks(),
  });
}

// Remembers the fields a freshly opened form starts with.
function rememberInitialForm() {
  closeConfirming = false;
  initialForm = currentForm();
}

// X, Cancel and Esc share this path: close at once when nothing would be lost
// (or the setting says to leave without asking), otherwise ask the host, which
// answers with "noteCloseAnswer".
export function requestCloseModal() {
  if (modalEl.hidden || pendingNoteSave || closeConfirming) {
    return;
  }
  if (NoteForm.closeAction(state.noteFormCloseBehavior, initialForm, currentForm()) === "close") {
    closeModal();
    return;
  }
  closeConfirming = true;
  vscode.postMessage({ type: "confirmCloseNoteForm" });
}

// The host's answer: "save" runs the form's own Save (the form closes only once
// the host confirms the note was stored), "discard" closes it, "cancel" keeps it.
export function handleNoteCloseAnswer(msg) {
  if (!closeConfirming) {
    return;
  }
  closeConfirming = false;
  const request = pendingOpenRequest;
  pendingOpenRequest = null;
  if (modalEl.hidden) {
    if (request) {
      startNewNote(request.link);
    }
    return;
  }
  if (msg.choice === "save") {
    saveModal();
    // The new form opens only once the host confirms the note was stored.
    openAfterSave = pendingNoteSave ? request : null;
  } else if (msg.choice === "discard") {
    closeModal();
    if (request) {
      startNewNote(request.link);
    }
  } else {
    $("f-title").focus();
  }
}

// Opens the empty form and tells the host, which then applies the code link of
// the request (a link never comes from the webview).
function startNewNote(link) {
  openAdd(link);
  vscode.postMessage({ type: "newNoteFormOpened", linked: !!link });
}

// A command asked for a new note (Ctrl+Alt+M, "Add note to this line"). A form
// that is already open is never replaced silently: with unsaved changes the
// user is asked first (Save / Discard / Cancel), following the same setting as
// closing the form.
export function requestOpenAdd(link) {
  if (pendingNoteSave || closeConfirming) {
    return;
  }
  if (modalEl.hidden || NoteForm.closeAction(state.noteFormCloseBehavior, initialForm, currentForm()) === "close") {
    startNewNote(link);
    return;
  }
  closeConfirming = true;
  pendingOpenRequest = { link };
  vscode.postMessage({ type: "confirmCloseNoteForm" });
}

function fillTypeSelect(selectedTypeId) {
  const options = state.types.map(function (t) {
    const badgeStart = t.icon ? `<span class="${iconClass(t.icon)}"></span>` : "";
    return { value: t.id, label: t.label, badgeStart: badgeStart };
  });
  state.formTypeId = selectedTypeId != null ? selectedTypeId : (state.types[0] && state.types[0].id) || null;
  $("f-type-container").innerHTML = renderCustomSelect("f-type-wrap", "f-type-btn", "f-type-menu", options, state.formTypeId, "", false, "cs-wrap-full");
  bindCustomSelect("f-type-wrap", "f-type-btn", "f-type-menu", function (value) {
    state.formTypeId = value;
    state.formTypeTouched = true;
  });
}

function fillCategorySelect(selectedCategoryId) {
  const options = state.categories.map(function (c) {
    return { value: c.id, label: c.label };
  });
  state.formCategoryId = selectedCategoryId != null ? selectedCategoryId : (state.categories[0] && state.categories[0].id) || null;
  $("f-category-container").innerHTML = renderCustomSelect("f-category-wrap", "f-category-btn", "f-category-menu", options, state.formCategoryId, "", false, "cs-wrap-full");
  bindCustomSelect("f-category-wrap", "f-category-btn", "f-category-menu", function (value) {
    state.formCategoryId = value;
    // When adding a new note, keep the type in sync with the newly picked
    // category's default type unless the user already changed the type.
    if (!state.editingId && !state.formTypeTouched) {
      const cat = state.categories.find((c) => c.id === value) || null;
      fillTypeSelect(resolveCategoryDefaultTypeId(cat, state.types, state.typeFilter !== "all" ? state.typeFilter : null));
    }
  });
}

function clampDescriptionHeight(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) {
    return DEFAULT_DESCRIPTION_HEIGHT;
  }
  return Math.min(MAX_DESCRIPTION_HEIGHT, Math.max(MIN_DESCRIPTION_HEIGHT, n));
}

// Applies the persisted description height (and the drag ceiling) so the
// note-editor card never overflows the current viewport. It runs when the
// editor opens and again on window resize while it is open, so the form shrinks
// as soon as the viewport edges would touch it (a tall height saved while the
// sidebar was large must not overflow after reopening it small).
function applyDescHeight() {
  const desc = $("f-desc");
  const card = modalEl.querySelector(".modal-card");
  // Drop any height the browser wrote inline during a previous manual drag so
  // the CSS custom property below is authoritative again.
  desc.style.removeProperty("height");
  // Measure the card with the description collapsed to its minimum, then
  // compute the largest height that still fits inside the viewport.
  desc.style.setProperty("--desc-height", MIN_DESCRIPTION_HEIGHT + "px");
  const cardAtMin = card.offsetHeight;
  const available = modalEl.clientHeight - MODAL_GUTTER;
  const maxDesc = Math.max(MIN_DESCRIPTION_HEIGHT, MIN_DESCRIPTION_HEIGHT + (available - cardAtMin));
  // Cap the drag at that same ceiling (and never past the absolute maximum), so
  // a manual resize cannot push the card outside the window.
  desc.style.maxHeight = `${Math.min(MAX_DESCRIPTION_HEIGHT, maxDesc)}px`;
  const height = Math.max(MIN_DESCRIPTION_HEIGHT, Math.min(MAX_DESCRIPTION_HEIGHT, state.descriptionHeight, maxDesc));
  desc.style.setProperty("--desc-height", height + "px");
  appliedDescHeight = height;
}

// Shows the read-only code link of the open form (hidden for unlinked notes).
// `item` is a note-shaped object so the same badge is used as on cards.
function renderFormLink(item) {
  const field = $("f-link-field");
  const holder = $("f-link");
  holder.textContent = "";
  state.formLinked = !!(item && item.link);
  field.hidden = !state.formLinked;
  if (state.formLinked) {
    holder.appendChild(buildLinkBadge(item));
    linkRowObserver.observe(holder);
    fitLinkRow(holder);
  }
}

// The title and description follow the `mindstream.ui.direction` setting.
export function applyFormDirection() {
  $("f-title").setAttribute("dir", state.direction);
  $("f-desc").setAttribute("dir", state.direction);
}

// `link` is present only when the host started the form from the editor
// context menu ("Add note to this line").
export function openAdd(link) {
  closeAllModals();
  clearPendingNoteSave();
  endExternalDescription();
  state.editingId = null;
  state.formTypeTouched = false;
  renderFormLink(link ? { id: null, link } : null);
  $("modal-title").textContent = link ? "New note for code" : "New note";
  $("f-title").value = "";
  $("f-desc").value = "";
  // Default to the currently filtered category when adding a note.
  const catId = state.categoryFilter !== "all" ? state.categoryFilter : (state.categories[0] && state.categories[0].id) || null;
  fillCategorySelect(catId);
  const cat = state.categories.find((c) => c.id === catId) || null;
  fillTypeSelect(resolveCategoryDefaultTypeId(cat, state.types, state.typeFilter !== "all" ? state.typeFilter : null));
  // New notes start at the host's default priority (saved even if untouched).
  fillPriorityControl(state.priority.defaultValue);
  setFormTasks([]);
  applyFormDirection();
  modalEl.hidden = false;
  resetTaskListScroll();
  applyDescHeight();
  rememberInitialForm();
  $("f-title").focus();
}

export function openEdit(item) {
  closeAllModals();
  clearPendingNoteSave();
  endExternalDescription();
  state.editingId = item.id;
  renderFormLink(item);
  $("modal-title").textContent = "Edit note";
  $("f-title").value = item.title;
  $("f-desc").value = item.description || "";
  fillTypeSelect(item.typeId);
  fillCategorySelect(item.categoryId);
  // A note without a priority opens with nothing selected (plus a hint).
  fillPriorityControl(item.priority || null);
  setFormTasks(item.tasks);
  applyFormDirection();
  modalEl.hidden = false;
  resetTaskListScroll();
  applyDescHeight();
  rememberInitialForm();
  $("f-title").focus();
}

// Forgets a Save that is still waiting, so a late answer cannot close a newer form.
function clearPendingNoteSave() {
  pendingNoteSave = null;
  openAfterSave = null;
  $("modal-save").disabled = false;
}

// The host's answer to the editor's Save: close on success; otherwise keep
// everything the user typed so nothing is lost (the host shows the reason).
export function handleNoteSaveResult(msg) {
  if (!pendingNoteSave || msg.saveId !== pendingNoteSave.id) {
    return;
  }
  const isEditing = pendingNoteSave.isEditing;
  const request = openAfterSave;
  clearPendingNoteSave();
  if (msg.ok) {
    closeModal(isEditing ? { deferFlash: true } : undefined);
    if (request) {
      startNewNote(request.link);
    }
  }
}

export function closeModal(options) {
  const deferFlash = !!(options && options.deferFlash);
  const itemId = state.editingId;
  clearPendingNoteSave();
  endExternalDescription();
  closeConfirming = false;
  initialForm = null;
  modalEl.hidden = true;
  $("emoji-picker").hidden = true;
  $("emoji-edit-modal").hidden = true;
  state.emojiTarget = null;
  state.editingId = null;

  // Highlight the note whose editor just closed. When saving, the list is
  // rebuilt from an incoming state message right after, so defer the flash
  // (it is applied to the freshly rebuilt card via changedIds); otherwise
  // (cancel / close / escape) flash the existing card immediately.
  if (itemId) {
    if (deferFlash) {
      pendingFlashId = itemId;
    } else {
      const card = listEl.querySelector(`.card[data-id="${itemId}"]`);
      if (card) {
        flashCard(card);
      }
    }
  }
}

function saveModal() {
  if (pendingNoteSave) {
    return;
  }
  const title = $("f-title").value.trim();
  if (!title) {
    $("f-title").focus();
    return;
  }
  const isEditing = !!state.editingId;
  pendingNoteSave = { id: nextNoteSaveId++, isEditing: isEditing };
  const payload = {
    type: isEditing ? "updateItem" : "addItem",
    saveId: pendingNoteSave.id,
    title: title,
    description: $("f-desc").value,
    typeId: state.formTypeId,
    categoryId: state.formCategoryId,
    // Always the full list: the host drops empty titles, and an empty list
    // turns a task group back into a regular note.
    tasks: getFormTasks(),
  };
  // Only sent while the system is enabled and a level is selected; the host
  // applies the default for new notes and leaves edits without one untouched.
  if (state.priority.editor && state.formPriority) {
    payload.priority = state.formPriority;
  }
  if (isEditing) {
    payload.id = state.editingId;
  } else if (state.formLinked) {
    // Only a flag: the host owns the link and attaches it itself.
    payload.linked = true;
  }
  // Stays open until the host answers with "noteSaveResult".
  $("modal-save").disabled = true;
  vscode.postMessage(payload);
}

// The id of the note whose editor was just saved, to flash once the rebuilt
// list arrives; reading it clears it.
export function takePendingFlashId() {
  const id = pendingFlashId;
  pendingFlashId = null;
  return id;
}

export function initNoteEditor() {
  $("modal-close").addEventListener("click", requestCloseModal);
  $("modal-cancel").addEventListener("click", requestCloseModal);
  $("modal-save").addEventListener("click", saveModal);
  $("f-desc-external").addEventListener("click", openDescriptionEditor);

  // Persist the description height only when the user manually resizes the
  // textarea (never on the programmatic apply that runs when the editor opens).
  const descObserver = new ResizeObserver((entries) => {
    // A description folded away by Focus mode reports a height of 0: that is
    // not a user resize and must never be saved.
    if (modalEl.hidden || isFocusMode()) {
      return;
    }
    for (const entry of entries) {
      const h = Math.round(entry.contentRect.height);
      if (!Number.isFinite(h) || h === 0 || h === appliedDescHeight) {
        continue;
      }
      const clamped = clampDescriptionHeight(h);
      if (clamped !== state.descriptionHeight) {
        state.descriptionHeight = clamped;
        vscode.postMessage({ type: "setDescriptionHeight", height: clamped });
      }
    }
  });
  descObserver.observe($("f-desc"));

  // Keep the card inside the window when the window is resized while the editor
  // is open: re-clamp the description as soon as the edges would touch it. Focus
  // mode hides the description and sizes the task list itself, so it is left out
  // here (taskEditor.js handles its own resize).
  window.addEventListener("resize", () => {
    if (!modalEl.hidden && !isFocusMode()) {
      applyDescHeight();
    }
  });
}
