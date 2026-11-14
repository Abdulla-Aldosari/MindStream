/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Keeps a single overlay (modal or dropdown) open at a time.

import { $, modalEl, state, viewModalEl } from "./core.js";
import { closeAllDropdowns } from "./customSelect.js";

// Ensures only one overlay (modal or dropdown) is visible at a time within
// the sidebar.
export function closeAllModals() {
  closeAllDropdowns();
  modalEl.hidden = true;
  viewModalEl.hidden = true;
  $("categories-modal").hidden = true;
  $("report-modal").hidden = true;
  $("types-modal").hidden = true;
  $("icons-modal").hidden = true;
  $("emoji-picker").hidden = true;
  $("emoji-edit-modal").hidden = true;
  state.emojiTarget = null;
}
