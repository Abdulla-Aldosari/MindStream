/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The emoji picker (anchored to the title/description field), its keyboard
// shortcuts, and the palette editor modal.

import { $, state, vscode } from "./core.js";

const MAX_EMOJI_RECENTS = 12;
// Fixed row of text symbols shown below "Recent" in the emoji picker. They
// are always visible and never part of the editable palette (a separate,
// non-editable quick-insert set). Note: "❖" is listed once (deduplicated).
const FIXED_EMOJI_SYMBOLS = ["❖", "✫", "★", "☆", "◆", "◇", "■", "□", "●", "○", "◉", "◎", "◈", "▶", "▷", "➜", "➤", "➔", "➣", "✔", "✘", "☑", "☒"];

// The last field the user focused that accepts an emoji (title, description,
// or a task title input). Tracked via focusin so dynamically created task
// inputs are covered without re-binding listeners per row.
let lastEmojiField = null;

/** Whether `el` is an input the emoji picker can insert into. */
function isEmojiField(el) {
  if (!el || !(el instanceof Element)) {
    return false;
  }
  return el.id === "f-title" || el.id === "f-desc" || el.classList.contains("task-title-input");
}

// --- Emoji picker (anchored to the focused title/description field) ---

function insertEmojiAtCaret(input, emoji) {
  const start = typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
  const end = typeof input.selectionEnd === "number" ? input.selectionEnd : input.value.length;
  input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
  const caret = start + emoji.length;
  input.setSelectionRange(caret, caret);
  // Setting `.value` programmatically fires no `input` event, so fields whose
  // own state is synced by that event (like the task editor's title -> form
  // model copy) would otherwise lose the emoji on save. Dispatch one manually.
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

function recordEmojiUse(emoji) {
  state.emojiRecents = [emoji, ...state.emojiRecents.filter((e) => e !== emoji)].slice(0, MAX_EMOJI_RECENTS);
  vscode.postMessage({ type: "recordEmojiUse", emoji });
}

function emojiButton(emoji) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "emoji-pick";
  btn.textContent = emoji;
  btn.addEventListener("click", () => {
    const target = state.emojiTarget;
    if (target) {
      insertEmojiAtCaret(target, emoji);
    }
    recordEmojiUse(emoji);
    closeEmojiPicker();
  });
  return btn;
}

function renderEmojiPicker() {
  const recentsRow = $("emoji-recents-row");
  const recentsGrid = $("emoji-recents-grid");
  recentsGrid.innerHTML = "";
  if (state.emojiRecents.length) {
    recentsRow.hidden = false;
    state.emojiRecents.forEach((emoji) => recentsGrid.appendChild(emojiButton(emoji)));
  } else {
    recentsRow.hidden = true;
  }

  const grid = $("emoji-grid");
  grid.innerHTML = "";
  state.emojiPalette.forEach((emoji) => grid.appendChild(emojiButton(emoji)));
}

function renderEmojiSymbols() {
  const grid = $("emoji-symbols-grid");
  grid.innerHTML = "";
  FIXED_EMOJI_SYMBOLS.forEach((symbol) => grid.appendChild(emojiButton(symbol)));
}

function positionEmojiPicker(input) {
  const picker = $("emoji-picker");
  picker.hidden = false;
  const rect = input.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const width = Math.max(100, Math.min(rect.width, vw - 16));
  picker.style.setProperty("--picker-width", `${width}px`);

  let left = rect.left;
  if (left + width > vw - 8) {
    left = vw - width - 8;
  }
  if (left < 8) {
    left = 8;
  }
  picker.style.setProperty("--picker-left", `${left}px`);

  const height = picker.offsetHeight;
  let top = rect.bottom + 6;
  if (top + height > vh - 8) {
    top = rect.top - height - 6;
  }
  if (top < 8) {
    top = 8;
  }
  picker.style.setProperty("--picker-top", `${top}px`);
}

function openEmojiPicker(input) {
  state.emojiTarget = input;
  renderEmojiPicker();
  positionEmojiPicker(input);
}

export function closeEmojiPicker() {
  $("emoji-picker").hidden = true;
  state.emojiTarget = null;
}

let emojiNoticeTimer = null;

function openEmojiEditModal() {
  closeEmojiPicker();
  $("f-emoji-list").value = state.emojiPalette.join("");
  renderEmojiEditPreview();
  $("emoji-edit-modal").hidden = false;
  $("f-emoji-list").focus();
}

export function closeEmojiEditModal() {
  $("emoji-edit-modal").hidden = true;
  if (emojiNoticeTimer) {
    clearTimeout(emojiNoticeTimer);
    emojiNoticeTimer = null;
  }
  $("emoji-notice").hidden = true;
}

export function renderEmojiEditPreview() {
  const preview = $("emoji-edit-preview");
  preview.innerHTML = "";
  const list = splitEmojis($("f-emoji-list").value).filter(isEmoji);
  list.forEach((emoji) => {
    const span = document.createElement("span");
    span.className = "emoji-edit-preview-item";
    span.textContent = emoji;
    preview.appendChild(span);
  });
}

function saveEmojiEdit() {
  const list = splitEmojis($("f-emoji-list").value).filter(isEmoji);
  state.emojiPalette = list;
  vscode.postMessage({ type: "updateEmojiPalette", palette: list });
  closeEmojiEditModal();
}

function restoreEmojiPalette() {
  vscode.postMessage({ type: "restoreEmojiPalette" });
}

function showEmojiNotice(text) {
  const el = $("emoji-notice");
  if (!el.hidden) {
    return;
  }
  el.textContent = text;
  el.hidden = false;
  emojiNoticeTimer = setTimeout(() => {
    el.hidden = true;
    emojiNoticeTimer = null;
  }, 3000);
}

function handleEmojiPaste(e) {
  const textarea = $("f-emoji-list");
  const data = e.clipboardData ? e.clipboardData.getData("text") : "";
  if (!data) {
    return;
  }
  e.preventDefault();
  const graphemes = splitEmojis(data);
  if (!graphemes.length) {
    return;
  }
  const existing = new Set(splitEmojis(textarea.value));
  const accepted = [];
  for (const grapheme of graphemes) {
    if (!isEmoji(grapheme)) {
      continue;
    }
    if (existing.has(grapheme)) {
      showEmojiNotice("Already exists");
      continue;
    }
    existing.add(grapheme);
    accepted.push(grapheme);
  }
  if (!accepted.length) {
    return;
  }
  const start = typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length;
  const end = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : textarea.value.length;
  const inserted = accepted.join("");
  textarea.value = textarea.value.slice(0, start) + inserted + textarea.value.slice(end);
  const caret = start + inserted.length;
  textarea.setSelectionRange(caret, caret);
  renderEmojiEditPreview();
}

function isEmojiShortcut(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.code !== "Slash") {
    return null;
  }
  return e.shiftKey ? "picker" : "insert";
}

function handleEmojiShortcut(e, input) {
  const action = isEmojiShortcut(e);
  if (!action) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (action === "picker") {
    openEmojiPicker(input);
  } else {
    const last = state.emojiRecents[0];
    if (last) {
      insertEmojiAtCaret(input, last);
      recordEmojiUse(last);
    }
  }
}

export function initEmojiPicker() {
  // Shortcuts and focus tracking are delegated to the document so dynamically
  // created task title inputs participate without per-row bindings.
  document.addEventListener("keydown", (e) => {
    if (isEmojiField(e.target)) {
      handleEmojiShortcut(e, e.target);
    }
  });

  // The hint button opens the picker anchored to the last focused emoji field.
  $("emoji-hint").addEventListener("click", () => {
    const field = lastEmojiField && lastEmojiField.isConnected ? lastEmojiField : $("f-title");
    openEmojiPicker(field);
  });

  // macOS uses Cmd instead of Ctrl; the keydown handler accepts both
  // (metaKey or ctrlKey), so only the hint label differs per platform.
  if (/Mac/i.test(navigator.platform || "") || /Macintosh/i.test(navigator.userAgent || "")) {
    $("emoji-hint").textContent = "💡 ⌘⇧/ inserts an emoji";
  }

  $("emoji-edit-btn").addEventListener("click", openEmojiEditModal);
  $("emoji-edit-close").addEventListener("click", closeEmojiEditModal);
  $("emoji-edit-cancel").addEventListener("click", closeEmojiEditModal);
  $("emoji-edit-save").addEventListener("click", saveEmojiEdit);
  $("emoji-restore-btn").addEventListener("click", restoreEmojiPalette);
  $("f-emoji-list").addEventListener("input", renderEmojiEditPreview);
  $("f-emoji-list").addEventListener("paste", handleEmojiPaste);

  renderEmojiSymbols();

  // Close the emoji picker when clicking or focusing anywhere outside it.
  document.addEventListener("mousedown", (e) => {
    if ($("emoji-picker").hidden) return;
    if ($("emoji-picker").contains(e.target)) return;
    closeEmojiPicker();
  });
  document.addEventListener("focusin", (e) => {
    if (isEmojiField(e.target)) {
      lastEmojiField = e.target;
    }
    if ($("emoji-picker").hidden) return;
    if ($("emoji-picker").contains(e.target)) return;
    closeEmojiPicker();
  });

  // Keep the open picker pinned to its input when the window is resized.
  window.addEventListener("resize", () => {
    if ($("emoji-picker").hidden) return;
    if (state.emojiTarget) positionEmojiPicker(state.emojiTarget);
  });
}
