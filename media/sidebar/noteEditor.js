/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The note editor modal (new / edit): type, category and priority fields,
// the code link, the description height, and the Save round trip with the host.

import { $, DEFAULT_DESCRIPTION_HEIGHT, listEl, modalEl, state, vscode } from "./core.js";
import { bindCustomSelect, renderCustomSelect } from "./customSelect.js";
import { closeAllModals } from "./overlays.js";
import { buildLinkBadge, fitLinkRow, linkRowObserver } from "./linkBadge.js";
import { flashCard } from "./list.js";
import { fillPriorityControl } from "./priorityControl.js";

const MIN_DESCRIPTION_HEIGHT = 55;
const MAX_DESCRIPTION_HEIGHT = 600;
const MODAL_GUTTER = 24;

let pendingFlashId = null;
let appliedDescHeight = null;
// The note editor's Save waiting for the host's answer ({ id, isEditing }), or
// null. The editor closes only once the host confirms the note was stored.
let pendingNoteSave = null;
let nextNoteSaveId = 1;

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

// Applies the persisted description height, clamped so the note-editor card
// never overflows the current viewport (e.g. a tall height saved while the
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

// `link` is present only when the host started the form from the editor
// context menu ("Add note to this line").
export function openAdd(link) {
  closeAllModals();
  clearPendingNoteSave();
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
  modalEl.hidden = false;
  applyDescHeight();
  $("f-title").focus();
}

export function openEdit(item) {
  closeAllModals();
  clearPendingNoteSave();
  state.editingId = item.id;
  renderFormLink(item);
  $("modal-title").textContent = "Edit note";
  $("f-title").value = item.title;
  $("f-desc").value = item.description || "";
  fillTypeSelect(item.typeId);
  fillCategorySelect(item.categoryId);
  // A note without a priority opens with nothing selected (plus a hint).
  fillPriorityControl(item.priority || null);
  modalEl.hidden = false;
  applyDescHeight();
  $("f-title").focus();
}

// Forgets a Save that is still waiting, so a late answer cannot close a newer form.
function clearPendingNoteSave() {
  pendingNoteSave = null;
  $("modal-save").disabled = false;
}

// The host's answer to the editor's Save: close on success; otherwise keep
// everything the user typed so nothing is lost (the host shows the reason).
export function handleNoteSaveResult(msg) {
  if (!pendingNoteSave || msg.saveId !== pendingNoteSave.id) {
    return;
  }
  const isEditing = pendingNoteSave.isEditing;
  clearPendingNoteSave();
  if (msg.ok) {
    closeModal(isEditing ? { deferFlash: true } : undefined);
  }
}

export function closeModal(options) {
  const deferFlash = !!(options && options.deferFlash);
  const itemId = state.editingId;
  clearPendingNoteSave();
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
  $("modal-close").addEventListener("click", closeModal);
  $("modal-cancel").addEventListener("click", closeModal);
  $("modal-save").addEventListener("click", saveModal);

  // Persist the description height only when the user manually resizes the
  // textarea (never on the programmatic apply that runs when the editor opens).
  const descObserver = new ResizeObserver((entries) => {
    if (modalEl.hidden) {
      return;
    }
    for (const entry of entries) {
      const h = Math.round(entry.contentRect.height);
      if (!Number.isFinite(h) || h === appliedDescHeight) {
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
}
