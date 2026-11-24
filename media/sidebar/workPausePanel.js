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
//   wp.earlier   "Pause work" found a note from an earlier break: the editor
//                shows it with "Start a new note" / "Keep it" above
//   wp.preview   while editing, the draft is shown formatted instead of the
//                textarea (the draft itself is kept in the textarea)
const wp = { note: { text: "", updatedAt: "", paused: false }, mode: "view", enabling: false, confirming: false, base: "", saving: null, earlier: false, preview: false };
const workPauseEl = $("work-pause");
const wpCard = $("work-pause-card");
const wpView = $("work-pause-view");
const wpInput = $("work-pause-input");
const wpTools = $("work-pause-tools");
const wpEdit = $("work-pause-edit");
const wpActions = $("work-pause-actions");
const wpViewActions = $("work-pause-view-actions");
const wpSave = $("work-pause-save");
const wpHint = $("work-pause-hint");
const wpEarlier = $("work-pause-earlier");
const wpEditTools = $("work-pause-edit-tools");
const wpPreview = $("work-pause-preview");
const wpPreviewToggle = $("work-pause-preview-toggle");
const wpExample = $("work-pause-example");
const wpExampleView = $("work-pause-example-view");
const wpExampleRaw = $("work-pause-example-raw");
const wpExampleSource = $("work-pause-example-source");

const { formatDateTime: formatDate } = DateFormat;

// The preview toggle names what a click does next, and shows its state.
function renderPreviewToggle(previewing) {
  const label = previewing ? "Back to editing" : "Preview formatting";
  wpPreviewToggle.setAttribute("aria-pressed", String(previewing));
  wpPreviewToggle.setAttribute("aria-label", label);
  wpPreviewToggle.dataset.tooltip = label;
  const icon = wpPreviewToggle.querySelector(".codicon");
  icon.classList.toggle("codicon-eye", !previewing);
  icon.classList.toggle("codicon-edit", previewing);
}

function renderWorkPause() {
  const editing = wp.mode === "edit";
  const previewing = editing && wp.preview;
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
  wpTools.hidden = editing;
  wpEditTools.hidden = !editing;
  wpInput.hidden = !editing || previewing;
  wpPreview.hidden = !previewing;
  if (previewing) {
    // Rendered from the draft, exactly as Save will show it (direction included).
    wpPreview.setAttribute("dir", WorkPause.directionFor(wpInput.value));
    wpPreview.innerHTML = WorkPause.previewHtml(wpInput.value);
  }
  renderPreviewToggle(previewing);
  if (!editing) {
    // The example belongs to the editor: it never outlives it.
    closeWorkPauseExample();
  }
  wpActions.hidden = !editing;
  // Resume and delete exist only while the note is shown as the lock.
  wpViewActions.hidden = editing || !wp.note.paused;
  wpHint.hidden = !editing;
  wpHint.textContent = WorkPause.editHint(!wp.note.paused);
  wpEarlier.hidden = !(editing && wp.earlier);
  $("work-pause-earlier-text").textContent = WorkPause.earlierNoteLabel(wp.note.updatedAt, formatDate, new Date());
  wpCard.classList.toggle("is-editing", editing);
  $("work-pause-updated").textContent = WorkPause.updatedLabel(wp.note.updatedAt, formatDate, new Date());
  wpSave.disabled = editing && (!!wp.saving || !WorkPause.canSave(wpInput.value));
}

function enterWorkPauseEdit() {
  wp.mode = "edit";
  wp.base = wp.note.text;
  wp.saving = null;
  wp.earlier = false;
  wp.preview = false;
  wpInput.value = wp.note.text;
  renderWorkPause();
  wpInput.focus();
}

// "Start a new note": empties the editor only. Nothing is stored until Save,
// and Cancel leaves the saved note as it was.
function startFreshWorkPauseNote() {
  wp.earlier = false;
  wp.preview = false;
  wpInput.value = "";
  renderWorkPause();
  wpInput.focus();
}

// "Keep it": the earlier note stays in the editor, to be saved as it is or changed.
function keepEarlierWorkPauseNote() {
  wp.earlier = false;
  wp.preview = false;
  renderWorkPause();
  wpInput.focus();
}

// Switches the editor between the textarea and the formatted draft. Nothing
// is saved: the draft stays in the textarea, with its caret and scroll.
function toggleWorkPausePreview() {
  if (wp.mode !== "edit") {
    return;
  }
  wp.preview = !wp.preview;
  renderWorkPause();
  if (!wp.preview) {
    wpInput.focus();
  }
}

// --- Formatting example ---
// A separate page over the whole sidebar. It shows a sample note rendered by
// the same code as the real note, with its source one click away.

function setExampleSource(showSource) {
  wpExampleView.hidden = showSource;
  wpExampleRaw.hidden = !showSource;
  const label = showSource ? "Show formatted" : "Show source";
  wpExampleSource.setAttribute("aria-pressed", String(showSource));
  wpExampleSource.setAttribute("aria-label", label);
  wpExampleSource.dataset.tooltip = label;
}

function openWorkPauseExample() {
  if (wp.mode !== "edit") {
    return;
  }
  wpExampleView.innerHTML = WorkPause.renderNoteHtml(WorkPause.EXAMPLE_NOTE);
  wpExampleRaw.textContent = WorkPause.EXAMPLE_NOTE;
  setExampleSource(false);
  wpExample.hidden = false;
  // The editor underneath cannot be reached while the example covers it.
  workPauseEl.inert = true;
  // The sheet has no tooltip, so focusing it pops nothing up; it scrolls with the keyboard.
  wpExampleView.focus();
}

function closeWorkPauseExample() {
  if (wpExample.hidden) {
    return;
  }
  wpExample.hidden = true;
  workPauseEl.inert = false;
  if (wp.mode === "edit" && !wp.preview) {
    wpInput.focus();
  }
}

// Esc on the Work Pause page: closes the example first, otherwise it is the editor's Cancel.
export function handleWorkPauseEscape() {
  if (!wpExample.hidden) {
    closeWorkPauseExample();
    return;
  }
  requestWorkPauseCancel();
}

function leaveWorkPauseEdit() {
  wp.mode = "view";
  wp.earlier = false;
  wp.preview = false;
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
    wp.earlier = false;
    wp.preview = false;
  }
  renderWorkPause();
}

// "Pause work": the editor opens first and the lock turns on after Save. A
// note from an earlier break is shown in the editor with the choice to start
// a new one. `note` is the stored note, sent with the request.
export function openWorkPauseEditor(note) {
  closeAllModals();
  if (wp.mode === "edit") {
    // Already open: never replace what is being typed.
    if (!wp.preview) {
      wpInput.focus();
    }
    return;
  }
  if (note && typeof note.text === "string") {
    wp.note = note;
  }
  wp.enabling = true;
  enterWorkPauseEdit();
  if (WorkPause.needsFreshStartChoice(wp.note)) {
    wp.earlier = true;
    renderWorkPause();
  }
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
  wpPreviewToggle.addEventListener("click", toggleWorkPausePreview);
  $("work-pause-example-open").addEventListener("click", openWorkPauseExample);
  $("work-pause-example-close").addEventListener("click", closeWorkPauseExample);
  wpExampleSource.addEventListener("click", () => setExampleSource(wpExampleRaw.hidden));
  $("work-pause-fresh").addEventListener("click", startFreshWorkPauseNote);
  $("work-pause-keep").addEventListener("click", keepEarlierWorkPauseNote);
  // The host copies the stored note and opens its read-only copy, so no text is sent.
  $("work-pause-copy").addEventListener("click", () => vscode.postMessage({ type: "copyWorkPauseNote" }));
  $("work-pause-open").addEventListener("click", () => vscode.postMessage({ type: "openWorkPauseNoteInEditor" }));
  $("work-pause-resume").addEventListener("click", () => vscode.postMessage({ type: "resumeWork" }));
  // The host asks first; `base` is the text on screen, so a note changed elsewhere is never deleted unread.
  $("work-pause-delete").addEventListener("click", () => vscode.postMessage({ type: "deleteWorkPauseNote", base: wp.note.text }));
  wpInput.addEventListener("input", () => {
    wpSave.disabled = !WorkPause.canSave(wpInput.value);
    // Typing into the earlier note is the same choice as "Keep it".
    if (wp.earlier) {
      wp.earlier = false;
      wpEarlier.hidden = true;
    }
  });
}
