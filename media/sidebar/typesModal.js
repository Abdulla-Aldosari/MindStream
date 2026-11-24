/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The "Manage Types" modal and its icons picker (they drive each other).

import { $, esc, state, vscode } from "./core.js";
import { closeAllModals } from "./overlays.js";

// Unique codicon names (one per glyph, shortest alias per glyph), generated
// at build time from the codicons package and loaded before this script.
const AVAILABLE_ICONS = window.CODICON_NAMES && window.CODICON_NAMES.length ? window.CODICON_NAMES : ["wrench", "edit", "star", "sync", "code", "beaker", "note", "link", "tag"];

// --- Types management modal ---

export function openTypesModal() {
  closeAllModals();
  state.pendingTypeIcon = "tag";
  state.iconsModalMode = null;
  renderTypes();
  renderTypeIconButton();
  $("types-modal").hidden = false;
  $("f-type-name").value = "";
  $("f-type-name").focus();
}

export function closeTypesModal() {
  $("types-modal").hidden = true;
  $("icons-modal").hidden = true;
  state.iconsModalMode = null;
  clearTypeIconActive();
}

function renderTypeIconButton() {
  const glyph = $("btn-type-icon-glyph");
  glyph.className = "codicon " + (state.pendingTypeIcon ? "codicon-" + state.pendingTypeIcon : "codicon-tag");
}

export function renderTypes(highlightId) {
  const listElT = $("types-list");
  listElT.innerHTML = "";
  let highlightRow = null;
  let highlightBadge = null;

  for (const t of state.types) {
    const row = document.createElement("div");
    row.className = "mgmt-row";

    const iconBtn = document.createElement("button");
    iconBtn.className = "icon-btn type-icon-btn";
    iconBtn.dataset.typeId = t.id;
    iconBtn.dataset.tooltip = "Change icon";
    iconBtn.innerHTML = `<span class="${iconClass(t.icon)}" data-type-icon="${esc(t.id)}"></span>`;
    iconBtn.addEventListener("click", () => {
      if (isIconsModalOpen() && state.iconsModalMode && state.iconsModalMode.mode === "edit" && state.iconsModalMode.typeId === t.id) {
        closeIconsModal();
      } else {
        openIconsModal({ mode: "edit", typeId: t.id });
      }
    });
    row.appendChild(iconBtn);

    const label = document.createElement("span");
    label.className = "mgmt-label";
    label.textContent = t.label;
    row.appendChild(label);

    const count = document.createElement("span");
    count.className = "mgmt-count";
    count.textContent = String(t.count || 0);
    row.appendChild(count);

    if (t.id === highlightId) {
      highlightRow = row;
      highlightBadge = document.createElement("span");
      highlightBadge.className = "mgmt-new-badge";
      highlightBadge.textContent = "New";
      row.appendChild(highlightBadge);
    }

    const spacer = document.createElement("span");
    spacer.className = "spacer";
    row.appendChild(spacer);

    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.dataset.tooltip = "Rename";
    editBtn.innerHTML = '<span class="codicon codicon-edit"></span>';
    editBtn.addEventListener("click", () => startRenameType(t, label));
    row.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn danger";
    delBtn.dataset.tooltip = "Delete";
    delBtn.innerHTML = '<span class="codicon codicon-trash"></span>';
    delBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "deleteType", id: t.id });
    });
    row.appendChild(delBtn);

    listElT.appendChild(row);
  }

  if (highlightRow) {
    highlightRow.classList.add("just-added");
    requestAnimationFrame(() => {
      highlightRow.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setTimeout(() => {
      highlightRow.classList.remove("just-added");
      if (highlightBadge && highlightBadge.parentNode) {
        highlightBadge.remove();
      }
    }, 1700);
  }
  setTypeIconActive();
}

function startRenameType(type, labelEl) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "mgmt-rename-input";
  input.value = type.label;
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (rename) => {
    if (done) {
      return;
    }
    done = true;
    const value = input.value.trim();
    if (rename && value && value !== type.label) {
      vscode.postMessage({ type: "renameType", id: type.id, label: value });
    } else {
      renderTypes();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.stopPropagation();
      finish(true);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

function addTypeFromInput() {
  const input = $("f-type-name");
  const value = input.value.trim();
  if (!value) {
    return;
  }
  vscode.postMessage({ type: "addType", label: value, icon: state.pendingTypeIcon });
  input.value = "";
  state.pendingTypeIcon = "tag";
  renderTypeIconButton();
}

// --- Icons picker (opens below the types modal like a dropdown) ---

function isIconsModalOpen() {
  return !$("icons-modal").hidden;
}

function clearTypeIconActive() {
  document.querySelectorAll(".type-icon-btn.active").forEach((el) => el.classList.remove("active"));
}

function setTypeIconActive() {
  clearTypeIconActive();
  const mode = state.iconsModalMode;
  if (!mode) return;
  if (mode.mode === "new") {
    $("btn-type-icon").classList.add("active");
  } else if (mode.mode === "edit") {
    const btn = document.querySelector(`.type-icon-btn[data-type-id="${mode.typeId}"]`);
    if (btn) btn.classList.add("active");
  }
}

function selectedIconName() {
  const mode = state.iconsModalMode;
  if (!mode) return null;
  if (mode.mode === "new") return state.pendingTypeIcon;
  if (mode.mode === "edit") {
    const t = state.types.find((x) => x.id === mode.typeId);
    return t ? t.icon : null;
  }
  return null;
}

function scrollSelectedIconIntoView() {
  const selected = document.querySelector(".icon-pick.selected");
  if (selected) {
    requestAnimationFrame(() => {
      selected.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
}

function openIconsModal(mode) {
  state.iconsModalMode = mode;
  $("icons-modal").hidden = false;
  $("f-icon-filter").value = "";
  renderIcons("");
  scrollSelectedIconIntoView();
  $("f-icon-filter").focus();
  setTypeIconActive();
}

export function closeIconsModal() {
  $("icons-modal").hidden = true;
  state.iconsModalMode = null;
  clearTypeIconActive();
}

export function renderIcons(filter) {
  const grid = $("icons-grid");
  grid.innerHTML = "";
  const term = (filter || "").trim().toLowerCase();
  const selectedIcon = selectedIconName();
  let matched = 0;
  for (const name of AVAILABLE_ICONS) {
    if (term && name.toLowerCase().indexOf(term) === -1) {
      continue;
    }
    matched++;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `icon-pick${name === selectedIcon ? " selected" : ""}`;
    btn.dataset.tooltip = name;
    btn.dataset.icon = name;
    btn.innerHTML = `<span class="codicon codicon-${name}"></span>`;
    btn.addEventListener("click", () => commitIcon(name));
    if (state.iconsModalMode && state.iconsModalMode.mode === "edit") {
      const typeId = state.iconsModalMode.typeId;
      const originalIcon = (state.types.find((x) => x.id === typeId) || {}).icon;
      btn.addEventListener("mouseenter", () => previewTypeIcon(typeId, name));
      btn.addEventListener("mouseleave", () => previewTypeIcon(typeId, originalIcon));
    }
    grid.appendChild(btn);
  }
  if (matched === 0) {
    const empty = document.createElement("div");
    empty.className = "icons-empty";
    empty.textContent = "No icons match this filter";
    grid.appendChild(empty);
  }
}

function previewTypeIcon(typeId, icon) {
  const el = document.querySelector(`[data-type-icon="${typeId}"]`);
  if (el) {
    el.className = `codicon ${icon ? `codicon-${icon}` : "codicon-tag"}`;
  }
}

function commitIcon(icon) {
  if (!state.iconsModalMode) {
    closeIconsModal();
    return;
  }
  if (state.iconsModalMode.mode === "new") {
    state.pendingTypeIcon = icon;
    renderTypeIconButton();
  } else if (state.iconsModalMode.mode === "edit") {
    vscode.postMessage({ type: "setTypeIcon", id: state.iconsModalMode.typeId, icon: icon });
  }
  closeIconsModal();
}

export function initTypesModal() {
  $("types-close").addEventListener("click", closeTypesModal);
  $("btn-add-type").addEventListener("click", addTypeFromInput);
  $("btn-restore-types").addEventListener("click", () => {
    vscode.postMessage({ type: "restoreDefaultTypes" });
  });
  $("btn-type-icon").addEventListener("click", () => {
    if (isIconsModalOpen() && state.iconsModalMode && state.iconsModalMode.mode === "new") {
      closeIconsModal();
    } else {
      openIconsModal({ mode: "new" });
    }
  });
  $("f-type-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addTypeFromInput();
    }
  });
  $("f-icon-filter").addEventListener("input", (e) => {
    renderIcons(e.target.value);
  });

  // Close the icons picker when clicking or focusing anywhere outside it,
  // except on the type-icon controls (those toggle it themselves).
  document.addEventListener("mousedown", (e) => {
    if (!isIconsModalOpen()) return;
    if ($("icons-modal").contains(e.target)) return;
    if (e.target.closest && e.target.closest(".type-icon-btn")) return;
    closeIconsModal();
  });

  document.addEventListener("focusin", (e) => {
    if (!isIconsModalOpen()) return;
    if ($("icons-modal").contains(e.target)) return;
    if (e.target.closest && e.target.closest(".type-icon-btn")) return;
    closeIconsModal();
  });
}
