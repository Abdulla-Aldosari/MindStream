/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The "Manage Categories" modal: list, add, rename, delete, default type.

import { $, esc, state, vscode } from "./core.js";
import { closeAllModals } from "./overlays.js";

// --- Categories management modal ---

export function openCategoriesModal() {
  closeAllModals();
  renderCategories();
  $("categories-modal").hidden = false;
  $("f-category-name").value = "";
  $("f-category-name").focus();
}

export function closeCategoriesModal() {
  $("categories-modal").hidden = true;
}

export function renderCategories(highlightId) {
  const listElC = $("categories-list");
  listElC.innerHTML = "";
  let highlightRow = null;
  let highlightBadge = null;

  for (const c of state.categories) {
    const row = document.createElement("div");
    row.className = "mgmt-row";

    const label = document.createElement("span");
    label.className = "mgmt-label";
    label.textContent = c.label;
    row.appendChild(label);

    const count = document.createElement("span");
    count.className = "mgmt-count";
    count.textContent = String(c.count || 0);
    row.appendChild(count);

    if (c.id === highlightId) {
      highlightRow = row;
      highlightBadge = document.createElement("span");
      highlightBadge.className = "mgmt-new-badge";
      highlightBadge.textContent = "New";
      row.appendChild(highlightBadge);
    }

    if (c.isDefault) {
      const badge = document.createElement("span");
      badge.className = "category-default-badge";
      badge.textContent = "Default";
      row.appendChild(badge);
    }

    const spacer = document.createElement("span");
    spacer.className = "spacer";
    row.appendChild(spacer);

    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.dataset.tooltip = "Rename";
    editBtn.innerHTML = '<span class="codicon codicon-edit"></span>';
    editBtn.addEventListener("click", () => startRenameCategory(c, label));
    row.appendChild(editBtn);

    const typeBtn = document.createElement("button");
    typeBtn.className = "icon-btn";
    const catDefaultType = state.types.find((t) => t.id === c.defaultTypeId);
    typeBtn.dataset.tooltip = catDefaultType ? `Default Type: ${esc(catDefaultType.label)}` : "Set Default Type";
    typeBtn.innerHTML = `<span class="codicon ${catDefaultType ? "codicon-star-full" : "codicon-star-empty"}"></span>`;
    typeBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "setCategoryDefaultType", id: c.id });
    });
    row.appendChild(typeBtn);

    if (!c.isDefault) {
      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn danger";
      delBtn.dataset.tooltip = "Delete";
      delBtn.innerHTML = '<span class="codicon codicon-trash"></span>';
      delBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "deleteCategory", id: c.id });
      });
      row.appendChild(delBtn);
    }

    listElC.appendChild(row);
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
}

function startRenameCategory(cat, labelEl) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "mgmt-rename-input";
  input.value = cat.label;
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
    if (rename && value && value !== cat.label) {
      vscode.postMessage({ type: "renameCategory", id: cat.id, label: value });
    } else {
      renderCategories();
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

function addCategoryFromInput() {
  const input = $("f-category-name");
  const value = input.value.trim();
  if (!value) {
    return;
  }
  vscode.postMessage({ type: "addCategory", label: value });
  input.value = "";
}

export function initCategoriesModal() {
  $("categories-close").addEventListener("click", closeCategoriesModal);

  $("btn-add-category").addEventListener("click", addCategoryFromInput);
  $("f-category-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addCategoryFromInput();
    }
  });
}
