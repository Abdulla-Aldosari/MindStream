/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Entry point of the sidebar webview app, bundled by esbuild into
// dist/media/sidebar.js (see esbuild.js). The modules in this folder only
// declare things at load; this file wires them up in a fixed order, renders
// the toolbar, and asks the host for the first state.

import { $, modalEl, viewModalEl, vscode } from "./core.js";
import { initList } from "./list.js";
import { initPriorityControl } from "./priorityControl.js";
import { closeModal, initNoteEditor } from "./noteEditor.js";
import { closeView, initNoteViewer } from "./noteViewer.js";
import { initWorkPausePanel, isWorkPauseShown, requestWorkPauseCancel } from "./workPausePanel.js";
import { closeCategoriesModal, initCategoriesModal } from "./categoriesModal.js";
import { closeWeeklyReport, initWeeklyReport } from "./weeklyReport.js";
import { closeIconsModal, closeTypesModal, initTypesModal } from "./typesModal.js";
import { closeEmojiEditModal, closeEmojiPicker, initEmojiPicker } from "./emojiPicker.js";
import { initToolbar, populateCategoryFilter, populateTypeFilter, renderViewOptions } from "./toolbar.js";
import { initMessages } from "./messages.js";

initWorkPausePanel();
initMessages();
initToolbar();
initList();
initPriorityControl();
initNoteEditor();
initNoteViewer();
initCategoriesModal();
initWeeklyReport();
initEmojiPicker();
initTypesModal();

// Esc closes the topmost overlay. Registered after every other listener.
document.addEventListener("keydown", (e) => {
  // The Work Pause note covers the whole page: Esc only ever concerns its editor.
  if (isWorkPauseShown()) {
    if (e.key === "Escape") {
      requestWorkPauseCancel();
    }
    return;
  }
  if (e.key === "Escape") {
    if (!$("emoji-picker").hidden) {
      closeEmojiPicker();
    } else if (!$("emoji-edit-modal").hidden) {
      closeEmojiEditModal();
    } else if (!modalEl.hidden) {
      closeModal();
    } else if (!viewModalEl.hidden) {
      closeView();
    } else if (!$("categories-modal").hidden) {
      closeCategoriesModal();
    } else if (!$("report-modal").hidden) {
      closeWeeklyReport();
    } else if (!$("icons-modal").hidden) {
      closeIconsModal();
    } else if (!$("types-modal").hidden) {
      closeTypesModal();
    }
  }
});

// The data-tooltip system itself (show/hide, positioning, scroll/escape/
// focus handling) lives in media/tooltip.js, loaded as a global before
// this script; see sidebarProvider.ts's getHtml().

// Initialize the toolbar controls (all are re-rendered whenever new state
// arrives, so render an initial empty set).
renderViewOptions();
populateCategoryFilter();
populateTypeFilter();

// Request the initial state on startup
vscode.postMessage({ type: "refresh" });
