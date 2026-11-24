/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The Work Pause note panel. View/edit/cancel rules live in media/workPause.js.

import { $, vscode } from "./core.js";
import { closeAllModals } from "./overlays.js";

// --- Work Pause note ---
// While `wp.note.paused` the page shows only this note (every other element
// is hidden by `body.work-pause-locked`, and the host sends nothing else to
// draw). View/edit/cancel rules live in media/workPause.js.
//   wp.mode      "view" | "edit"
//   wp.enabling  the editor is open before the lock is on ("Pause work" with no note yet)
//   wp.confirming  a discard question is waiting for the host's answer
//   wp.base      the saved text when editing started, sent with Save so a text
//                changed elsewhere meanwhile is never overwritten
//   wp.saving    a Save is waiting for the host's answer ("workPauseSaveResult")
const wp = { note: { text: "", updatedAt: "", paused: false }, mode: "view", enabling: false, confirming: false, base: "", saving: null };
const workPauseEl = $("work-pause");
const wpCard = $("work-pause-card");
const wpView = $("work-pause-view");
const wpInput = $("work-pause-input");
const wpEdit = $("work-pause-edit");
const wpActions = $("work-pause-actions");
const wpSave = $("work-pause-save");

function renderWorkPause() {
  const editing = wp.mode === "edit";
  workPauseEl.hidden = !(wp.note.paused || wp.enabling);
  document.body.classList.toggle("work-pause-locked", wp.note.paused);
  // The direction follows the saved text (first non-empty line) and applies to
  // the note text only; the rest of the card never flips. It is set while the
  // note is shown, not while typing, so the caret never jumps mid-edit.
  if (!editing) {
    const dir = WorkPause.directionFor(wp.note.text);
    wpView.setAttribute("dir", dir);
    wpInput.setAttribute("dir", dir);
  }
  wpView.innerHTML = WorkPause.renderNoteHtml(wp.note.text);
  wpView.hidden = editing;
  wpEdit.hidden = editing;
  wpInput.hidden = !editing;
  wpActions.hidden = !editing;
  wpCard.classList.toggle("is-editing", editing);
  $("work-pause-updated").textContent = WorkPause.updatedLabel(wp.note.updatedAt, (d) => d.toLocaleString());
  wpSave.disabled = editing && (!!wp.saving || !WorkPause.canSave(wpInput.value));
}

function enterWorkPauseEdit() {
  wp.mode = "edit";
  wp.base = wp.note.text;
  wp.saving = null;
  wpInput.value = wp.note.text;
  renderWorkPause();
  wpInput.focus();
}

function leaveWorkPauseEdit() {
  wp.mode = "view";
  // The editor opened by Enable (no lock yet) closes completely when left.
  if (!wp.note.paused) {
    wp.enabling = false;
  }
  // Focus is not moved back to the Edit button: the tooltip system shows the
  // tooltip of any element that receives focus, even from a script.
  renderWorkPause();
}

// Cancel and Esc share this path: leave at once when nothing would be lost,
// otherwise ask the host (the answer comes back as "workPauseDiscardAnswer").
export function requestWorkPauseCancel() {
  if (wp.mode !== "edit" || wp.confirming || wp.saving) {
    return;
  }
  if (WorkPause.cancelAction(wp.note.text, wpInput.value) === "leave") {
    leaveWorkPauseEdit();
    return;
  }
  wp.confirming = true;
  vscode.postMessage({ type: "confirmDiscardWorkPauseDraft" });
}

function saveWorkPause() {
  if (wp.mode !== "edit" || wp.saving || !WorkPause.canSave(wpInput.value)) {
    return;
  }
  const text = wpInput.value.trim();
  // Not locked yet means this save is the Enable: the host saves, then locks.
  const pause = !wp.note.paused;
  // The draft stays open until the host answers: a refused save keeps it.
  wp.saving = { text };
  vscode.postMessage({ type: "saveWorkPauseNote", text, pause, base: wp.base });
  renderWorkPause();
}

// The host's answer to Save: show the note on success; otherwise keep the
// draft (the host shows the reason, for example a note changed elsewhere).
export function handleWorkPauseSaveResult(msg) {
  const saving = wp.saving;
  wp.saving = null;
  if (saving && msg.ok && wp.mode === "edit") {
    // Shown at once; the saved copy (with its new date) arrives right after.
    wp.note = { ...wp.note, text: saving.text };
    wp.mode = "view";
  }
  renderWorkPause();
}

// "Pause work" with no saved note: edit first, the lock turns on after Save.
export function openWorkPauseEditor() {
  closeAllModals();
  wp.enabling = true;
  enterWorkPauseEdit();
}

// Applies the note part of a "state" message. Returns true while locked, in
// which case the caller must not render anything else.
export function applyWorkPauseState(msg) {
  const note = msg.workPause || { text: "", updatedAt: "", paused: false };
  if (WorkPause.shouldReplaceDraft(wp.mode)) {
    wp.mode = "view";
    wp.enabling = wp.enabling && !note.paused;
  } else if (!note.paused) {
    // Unlocked from outside while a draft is open: keep the draft on screen.
    wp.enabling = true;
  }
  wp.note = note;
  if (note.paused) {
    closeAllModals();
  }
  renderWorkPause();
  return note.paused;
}

// The host's answer to "discard the unsaved draft?" (asked by Cancel / Esc).
export function handleWorkPauseDiscardAnswer(msg) {
  wp.confirming = false;
  if (wp.mode === "edit") {
    if (msg.discard) {
      leaveWorkPauseEdit();
    } else {
      wpInput.focus();
    }
  }
}

// True while work is paused (the page shows only the note).
export function isWorkPaused() {
  return wp.note.paused;
}

// True while the note covers the page (paused, or the editor opened by "Pause work").
export function isWorkPauseShown() {
  return !workPauseEl.hidden;
}

export function initWorkPausePanel() {
  wpEdit.addEventListener("click", enterWorkPauseEdit);
  $("work-pause-cancel").addEventListener("click", requestWorkPauseCancel);
  wpSave.addEventListener("click", saveWorkPause);
  wpInput.addEventListener("input", () => {
    wpSave.disabled = !WorkPause.canSave(wpInput.value);
  });
}
