/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Custom select (replaces native <select>) and the lightweight action menu,
// plus the registry that lets every open dropdown be closed at once.

// --- Custom select component (replaces native <select>) ---

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

const csIcons = {
  chevron:
    '<svg width="17" height="17" viewBox="0 0 21 21" class="cs-chevron" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="m6 9l6 6l6-6"></path></svg>',
  checkmark:
    '<svg width="17" height="17" viewBox="0 0 24 24" class="cs-check" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 6L9 17l-5-5"></path></svg>',
};

// Registry of bound dropdown close functions, keyed by menuId. Populated by
// bindCustomSelect() and consumed by closeAllDropdowns() so that every open
// menu can be dismissed atomically (hidden + its document/window listeners
// removed) from a single choke point, e.g. when opening any modal.
export const menuCloseHandlers = {};

export function renderCustomSelect(wrapperId, btnId, menuId, options, selectedValue, btnExtraClass, menuUp, wrapExtraClass) {
  const selectedOption = options.find(function (o) {
    return o.value === selectedValue;
  });
  const selectedLabel = selectedOption ? selectedOption.label : options.length ? options[0].label : "—";

  const items = options
    .map(function (opt) {
      const isSelected = opt.value === selectedValue;
      const badgeStartHtml = opt.badgeStart ? `<span class="cs-item-badge">${opt.badgeStart}</span>` : "";
      const badgeEndHtml = opt.badgeEnd ? `<span class="cs-item-badge">${opt.badgeEnd}</span>` : "";
      const itemClass = opt.itemClass ? ` ${opt.itemClass}` : "";
      return `<div class="cs-item${itemClass}" role="menuitem" tabindex="-1" data-value="${escapeAttr(opt.value)}">
        <span class="cs-item-label-group">${badgeStartHtml}<span class="cs-item-label">${escapeHtml(opt.label)}</span>${badgeEndHtml}</span>
        ${isSelected ? csIcons.checkmark : ""}
      </div>`;
    })
    .join("");

  const menuClass = `cs-menu${menuUp ? " cs-menu-up" : ""}`;
  const wrapClass = `cs-wrap${wrapExtraClass ? ` ${wrapExtraClass}` : ""}`;
  const selectedItemClass = selectedOption && selectedOption.itemClass ? ` ${selectedOption.itemClass}` : "";
  const btnClass = `cs-btn${btnExtraClass ? ` ${btnExtraClass}` : ""}${selectedItemClass}`;

  return `<div class="${wrapClass}" id="${escapeAttr(wrapperId)}">
    <button class="${btnClass}" type="button" aria-haspopup="menu" aria-expanded="false" id="${escapeAttr(btnId)}">
      <span class="cs-btn-label">${escapeHtml(selectedLabel)}</span>
      ${csIcons.chevron}
    </button>
    <div class="${menuClass}" role="menu" id="${escapeAttr(menuId)}" hidden>
      <div class="cs-menu-items-wrapper">${items}</div>
    </div>
  </div>`;
}

export function bindCustomSelect(wrapperId, btnId, menuId, onChange) {
  const wrap = document.getElementById(wrapperId);
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);

  if (!btn || !menu) {
    return;
  }

  function closeMenu() {
    if (!menu.hidden) {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("blur", onWindowBlur);
  }

  // Expose this dropdown's close function so closeAllDropdowns() can dismiss
  // it (and clean up its listeners) from outside the closure. Re-binding the
  // same menuId after a re-render simply overwrites the stale entry.
  menuCloseHandlers[menuId] = closeMenu;

  function onPointerDown(e) {
    if (wrap && !wrap.contains(e.target)) {
      closeMenu();
    }
  }

  function onWindowBlur() {
    closeMenu();
  }

  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!menu.hidden) {
      closeMenu();
    } else {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      menu.querySelectorAll(".cs-item").forEach(function (el) {
        el.removeAttribute("data-highlighted");
      });
      const checkEl = menu.querySelector(".cs-check");
      if (checkEl) {
        const highlightedItem = checkEl.closest(".cs-item");
        highlightedItem.setAttribute("data-highlighted", "");
        const itemsWrapper = menu.querySelector(".cs-menu-items-wrapper");
        if (itemsWrapper) {
          itemsWrapper.scrollTop = highlightedItem.offsetTop - itemsWrapper.clientHeight / 2 + highlightedItem.offsetHeight / 2;
        }
      }
      document.addEventListener("pointerdown", onPointerDown, true);
      window.addEventListener("blur", onWindowBlur);
    }
  });

  menu.querySelectorAll(".cs-item").forEach(function (item) {
    item.addEventListener("click", function () {
      const labelEl = btn.querySelector(".cs-btn-label");
      const itemLabelEl = item.querySelector(".cs-item-label");
      if (labelEl && itemLabelEl) {
        labelEl.textContent = itemLabelEl.textContent;
      }
      menu.querySelectorAll(".cs-check").forEach(function (el) {
        el.remove();
      });
      item.insertAdjacentHTML("beforeend", csIcons.checkmark);
      onChange(item.dataset.value);
      closeMenu();
    });
    item.addEventListener("mouseenter", function () {
      menu.querySelectorAll(".cs-item").forEach(function (el) {
        el.removeAttribute("data-highlighted");
      });
      item.setAttribute("data-highlighted", "");
    });
    item.addEventListener("mouseleave", function () {
      item.removeAttribute("data-highlighted");
    });
  });
}

// --- Lightweight action menu (reusable) ---
// Renders a themed dropdown of actions (same look as the custom-select menus)
// without a persistent selection or checkmark. The trigger button is authored
// by the caller in the surrounding HTML; bindActionMenu() wires it up, and
// both the trigger and the menu must live inside the same positioned wrapper
// (position: relative) so the .cs-menu opens below the trigger.
// Item schema:
//   { action, label, icon?, tooltip?, danger? }  - a clickable action
//   { divider: true }                            - a horizontal separator
export function renderActionMenu(menuId, items, extraClass) {
  const children = items
    .map(function (item) {
      if (item.divider) {
        return `<div class="cs-item-divider" role="separator"></div>`;
      }
      const iconHtml = item.icon ? `<span class="cs-item-badge"><span class="codicon codicon-${escapeAttr(item.icon)}"></span></span>` : "";
      const tooltipAttr = item.tooltip ? ` data-tooltip="${escapeAttr(item.tooltip)}"` : "";
      const dangerClass = item.danger ? " cs-item-danger" : "";
      return `<div class="cs-item${dangerClass}" role="menuitem" tabindex="-1" data-action="${escapeAttr(item.action)}"${tooltipAttr}>
        <span class="cs-item-label-group">${iconHtml}<span class="cs-item-label">${escapeHtml(item.label)}</span></span>
      </div>`;
    })
    .join("");
  const menuClass = `cs-menu${extraClass ? ` ${extraClass}` : ""}`;
  return `<div class="${menuClass}" role="menu" id="${escapeAttr(menuId)}" hidden>
    <div class="cs-menu-items-wrapper">${children}</div>
  </div>`;
}

// Binds a trigger button to the action menu returned by renderActionMenu().
// onTrigger(action) receives the clicked item's `action` value.
export function bindActionMenu(triggerId, menuId, onTrigger) {
  const trigger = document.getElementById(triggerId);
  const menu = document.getElementById(menuId);

  if (!trigger || !menu) {
    return;
  }

  const wrap = trigger.parentElement;

  function closeMenu() {
    if (!menu.hidden) {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", onWindowBlur);
  }

  // Register the close function so closeAllDropdowns() can dismiss this menu
  // atomically too (e.g. when another modal opens).
  menuCloseHandlers[menuId] = closeMenu;

  function onPointerDown(e) {
    if (wrap && !wrap.contains(e.target)) {
      closeMenu();
    }
  }

  // Escaped while open: capture phase so it runs before the global Escape
  // handler, which would otherwise close the whole modal underneath the menu.
  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      closeMenu();
    }
  }

  function onWindowBlur() {
    closeMenu();
  }

  trigger.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!menu.hidden) {
      closeMenu();
      return;
    }
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    menu.querySelectorAll(".cs-item").forEach(function (el) {
      el.removeAttribute("data-highlighted");
    });
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onWindowBlur);
  });

  menu.querySelectorAll(".cs-item[data-action]").forEach(function (item) {
    item.addEventListener("click", function () {
      onTrigger(item.dataset.action);
      closeMenu();
    });
    item.addEventListener("mouseenter", function () {
      menu.querySelectorAll(".cs-item").forEach(function (el) {
        el.removeAttribute("data-highlighted");
      });
      item.setAttribute("data-highlighted", "");
    });
    item.addEventListener("mouseleave", function () {
      item.removeAttribute("data-highlighted");
    });
  });
}

// Closes every open custom-select dropdown at once by invoking each bound
// menu's own close function, which hides the menu and removes its
// document/window listeners immediately (atomic cleanup).
export function closeAllDropdowns() {
  Object.keys(menuCloseHandlers).forEach(function (menuId) {
    menuCloseHandlers[menuId]();
  });
}
