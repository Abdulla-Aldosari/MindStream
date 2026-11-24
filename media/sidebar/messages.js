/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Messages from the extension host: state updates and open-this requests.

import { $, DEFAULT_DESCRIPTION_HEIGHT, modalEl, state } from "./core.js";
import { renderList } from "./list.js";
import { fillPriorityControl } from "./priorityControl.js";
import {
  applyFormDirection,
  checkOpenNoteChanged,
  handleDescriptionEditorClosed,
  handleDescriptionEditorOpened,
  handleDescriptionEditorText,
  handleNoteCloseAnswer,
  handleNoteSaveResult,
  requestOpenAdd,
  takePendingFlashId,
} from "./noteEditor.js";
import { refreshView } from "./noteViewer.js";
import { applyWorkPauseState, handleWorkPauseDiscardAnswer, handleWorkPauseSaveResult, isWorkPaused, openWorkPauseEditor } from "./workPausePanel.js";
import { openCategoriesModal, renderCategories } from "./categoriesModal.js";
import { openWeeklyReportModal } from "./weeklyReport.js";
import { openTypesModal, renderIcons, renderTypes } from "./typesModal.js";
import { renderEmojiEditPreview } from "./emojiPicker.js";
import { populateCategoryFilter, populateTypeFilter, renderViewOptions, setArchiveVisible } from "./toolbar.js";

let prevStatusById = {};

export function initMessages() {
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg) {
      return;
    }
    if (msg.type === "workPauseDiscardAnswer") {
      handleWorkPauseDiscardAnswer(msg);
      return;
    }
    if (msg.type === "workPauseSaveResult") {
      handleWorkPauseSaveResult(msg);
      return;
    }
    if (msg.type === "openWorkPauseEditor") {
      if (!isWorkPaused()) {
        openWorkPauseEditor(msg.note);
      }
      return;
    }
    if (msg.type === "noteCloseAnswer") {
      handleNoteCloseAnswer(msg);
      return;
    }
    if (msg.type === "noteSaveResult") {
      handleNoteSaveResult(msg);
      return;
    }
    if (msg.type === "descriptionEditorOpened") {
      handleDescriptionEditorOpened(msg);
      return;
    }
    if (msg.type === "descriptionEditorText") {
      handleDescriptionEditorText(msg);
      return;
    }
    if (msg.type === "descriptionEditorClosed") {
      handleDescriptionEditorClosed(msg);
      return;
    }
    // Locked: only state messages (which carry the note) are processed.
    if (isWorkPaused() && msg.type !== "state") {
      return;
    }
    if (msg.type === "openAddNote") {
      requestOpenAdd(msg.link);
      return;
    }
    if (msg.type === "openCategories") {
      openCategoriesModal();
      return;
    }
    if (msg.type === "openTypes") {
      openTypesModal();
      return;
    }
    if (msg.type === "openWeeklyReport") {
      openWeeklyReportModal(msg.report);
      return;
    }
    if (msg.type !== "state") {
      return;
    }
    if (applyWorkPauseState(msg)) {
      return;
    }
    const newItems = msg.items || [];
    const changedIds = {};
    newItems.forEach((it) => {
      if (prevStatusById[it.id] !== undefined && prevStatusById[it.id] !== it.status) {
        changedIds[it.id] = true;
      }
    });
    const flashId = takePendingFlashId();
    if (flashId) {
      changedIds[flashId] = true;
    }

    const prevCategories = state.categories || [];
    const prevTypes = state.types || [];
    state.items = newItems;
    state.types = msg.types || [];
    state.categories = msg.categories || [];
    state.statusLabels = msg.statusLabels || {};
    state.includeArchived = !!msg.includeArchived;
    state.direction = msg.direction === "rtl" ? "rtl" : "ltr";
    applyFormDirection();
    state.emojiPalette = msg.emojiPalette || [];
    state.emojiRecents = msg.emojiRecents || [];
    // Keep the open emoji edit modal in sync after a server-side restore.
    if (!$("emoji-edit-modal").hidden) {
      $("f-emoji-list").value = state.emojiPalette.join("");
      renderEmojiEditPreview();
    }
    state.descriptionHeight = typeof msg.descriptionHeight === "number" ? msg.descriptionHeight : DEFAULT_DESCRIPTION_HEIGHT;
    state.copyIncludeNoteInfo = msg.copyIncludeNoteInfo !== false;
    state.noteFormCloseBehavior = msg.noteFormCloseBehavior === "discard" ? "discard" : "ask";
    const prevPriorityEditor = state.priority.editor;
    state.priority = ViewOptions.normalizeFeatures(msg.priority);
    renderViewOptions();
    // The setting changed while the editor is open: add or remove the control.
    if (!modalEl.hidden && prevPriorityEditor !== state.priority.editor) {
      const editing = state.editingId ? state.items.find((it) => it.id === state.editingId) : null;
      fillPriorityControl(editing ? editing.priority || null : state.priority.defaultValue);
    }
    setArchiveVisible(state.includeArchived);
    populateCategoryFilter();
    populateTypeFilter();
    if (!$("categories-modal").hidden) {
      let addedCategoryId = null;
      if (prevCategories.length) {
        const prevIds = new Set(prevCategories.map((p) => p.id));
        for (const c of state.categories) {
          if (!prevIds.has(c.id)) {
            addedCategoryId = c.id;
            break;
          }
        }
      }
      renderCategories(addedCategoryId);
    }
    if (!$("types-modal").hidden) {
      let addedTypeId = null;
      if (prevTypes.length) {
        const prevTypeIds = new Set(prevTypes.map((p) => p.id));
        for (const t of state.types) {
          if (!prevTypeIds.has(t.id)) {
            addedTypeId = t.id;
            break;
          }
        }
      }
      renderTypes(addedTypeId);
      if (!$("icons-modal").hidden) {
        renderIcons($("f-icon-filter").value);
      }
    }
    renderList(changedIds);
    // The open viewer follows the stored note (checked tasks, external edits).
    refreshView();
    // The open note form warns, before Save, when its note changed elsewhere.
    checkOpenNoteChanged();

    prevStatusById = {};
    newItems.forEach((it) => {
      prevStatusById[it.id] = it.status;
    });
  });
}
