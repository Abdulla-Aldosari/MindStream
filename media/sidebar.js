(function () {
  const vscode = acquireVsCodeApi();

  // iconClass() is defined in media/iconClass.js, loaded as a global before
  // this script (see sidebarProvider.ts's getHtml()). The data-tooltip
  // system (media/tooltip.js) is loaded the same way.

  const STATUS_CYCLE = ["pending", "in-progress", "done"];
  // Unique codicon names (one per glyph, shortest alias per glyph), generated
  // at build time from the codicons package and loaded before this script.
  const AVAILABLE_ICONS = window.CODICON_NAMES && window.CODICON_NAMES.length ? window.CODICON_NAMES : ["wrench", "edit", "star", "sync", "code", "beaker", "note", "link", "tag"];

  const saved = vscode.getState() || {};
  const MAX_EMOJI_RECENTS = 12;
  // Fixed row of text symbols shown below "Recent" in the emoji picker. They
  // are always visible and never part of the editable palette (a separate,
  // non-editable quick-insert set). Note: "❖" is listed once (deduplicated).
  const FIXED_EMOJI_SYMBOLS = ["❖", "✫", "★", "☆", "◆", "◇", "■", "□", "●", "○", "◉", "◎", "◈", "▶", "▷", "➜", "➤", "➔", "➣", "✔", "✘", "☑", "☒"];

  const DEFAULT_DESCRIPTION_HEIGHT = 128;
  const MIN_DESCRIPTION_HEIGHT = 55;
  const MAX_DESCRIPTION_HEIGHT = 600;
  const MODAL_GUTTER = 24;

  const state = {
    items: [],
    types: [],
    categories: [],
    statusLabels: {},
    includeArchived: false,
    editingId: null,
    // Group / sort / priority filter; rules live in media/viewOptions.js.
    view: ViewOptions.restoreView(saved),
    collapsed: ViewOptions.restoreCollapsed(saved.collapsed),
    // Priority feature set from the host (disabled until the first state arrives).
    priority: ViewOptions.NO_PRIORITY,
    // Value picked in the note editor's priority control (null = none selected).
    formPriority: null,
    categoryFilter: saved.categoryFilter || "all",
    typeFilter: saved.typeFilter || "all",
    formTypeId: null,
    formCategoryId: null,
    formTypeTouched: false,
    // True while the open "new note" form carries a code link (display only).
    formLinked: false,
    pendingTypeIcon: "tag",
    iconsModalMode: null,
    direction: "ltr",
    emojiPalette: [],
    emojiRecents: [],
    descriptionHeight: DEFAULT_DESCRIPTION_HEIGHT,
    copyIncludeNoteInfo: true,
    emojiTarget: null,
  };

  const $ = (id) => document.getElementById(id);
  const listEl = $("list");
  const emptyEl = $("empty");
  const modalEl = $("modal");
  const viewModalEl = $("view-modal");
  let viewingItem = null;
  let pendingFlashId = null;
  let appliedDescHeight = null;

  function persist() {
    vscode.setState({
      groupBy: state.view.groupBy,
      sortBy: state.view.sortBy,
      hiddenPriorities: state.view.hiddenPriorities,
      collapsed: state.collapsed,
      categoryFilter: state.categoryFilter,
      typeFilter: state.typeFilter,
    });
  }

  function typeOf(typeId) {
    const t = state.types.find((x) => x.id === typeId);
    return t || { id: typeId, label: "(Deleted type)", icon: "tag" };
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

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
  const menuCloseHandlers = {};

  function renderCustomSelect(wrapperId, btnId, menuId, options, selectedValue, btnExtraClass, menuUp, wrapExtraClass) {
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

  function bindCustomSelect(wrapperId, btnId, menuId, onChange) {
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
  function renderActionMenu(menuId, items, extraClass) {
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
  function bindActionMenu(triggerId, menuId, onTrigger) {
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

  // --- Ordering / grouping ---

  function itemsInCategory() {
    if (state.categoryFilter === "all") {
      return state.items;
    }
    return state.items.filter((it) => it.categoryId === state.categoryFilter);
  }

  function filteredItems() {
    const items = itemsInCategory();
    if (state.typeFilter === "all") {
      return items;
    }
    return items.filter((it) => it.typeId === state.typeFilter);
  }

  // Category/type filters, then the priority filter. Items arrive from the
  // host in file order, which "Fixed order" keeps as-is.
  function visibleItems() {
    return ViewOptions.visibleItems(filteredItems(), state.view, state.priority);
  }

  function renderEmptyState() {
    function createButton(label) {
      return `<button type="button" class="btn btn-primary empty-create-btn">${label}</button>`;
    }

    if (state.items.length === 0) {
      emptyEl.innerHTML = `<div class="empty-text">Looks like there are no notes yet.</div>${createButton("Create your first note")}`;
      emptyEl.hidden = false;
      return;
    }

    if (itemsInCategory().length === 0) {
      emptyEl.innerHTML = `<div class="empty-text">No notes in this category.</div>${createButton("Create one")}`;
      emptyEl.hidden = false;
      return;
    }

    if (filteredItems().length === 0) {
      const t = typeOf(state.typeFilter);
      emptyEl.innerHTML = `<div class="empty-text">Looks like there are no <span class="${iconClass(t.icon)}"></span> ${esc(t.label)} notes yet.</div>${createButton("Create one")}`;
      emptyEl.hidden = false;
      return;
    }

    if (visibleItems().length === 0) {
      emptyEl.innerHTML = `<div class="empty-text">All notes here are hidden by the priority filter.</div><button type="button" class="btn btn-primary empty-show-all-btn">Show all priorities</button>`;
      emptyEl.hidden = false;
      return;
    }

    emptyEl.hidden = true;
  }

  function renderList(changedIds) {
    const prevPositions = capturePositions();

    listEl.innerHTML = "";
    renderEmptyState();

    const visible = visibleItems();
    if (visible.length === 0) {
      return;
    }

    const sorted = ViewOptions.sortItems(visible, state.view, state.priority);
    const groups = ViewOptions.buildGroups(sorted, state.view, state.priority, state.statusLabels);
    if (groups) {
      for (const group of groups) {
        const section = document.createElement("div");
        section.className = "group";
        section.appendChild(buildGroupHeader(group));
        if (!state.collapsed[group.key]) {
          for (const item of group.items) {
            section.appendChild(buildCard(item));
          }
        }
        listEl.appendChild(section);
      }
    } else {
      for (const item of sorted) {
        listEl.appendChild(buildCard(item));
      }
    }

    // Mark cards whose description is truncated so the "view" button appears.
    markTruncatedCards();

    // FLIP animation; "Fixed order" without groups never reorders on edits.
    if (ViewOptions.sortChain(state.view, state.priority).length > 0 || groups) {
      animateFlip(prevPositions, changedIds);
    }
  }

  function capturePositions() {
    const map = {};
    listEl.querySelectorAll(".card[data-id]").forEach((el) => {
      map[el.dataset.id] = el.getBoundingClientRect();
    });
    return map;
  }

  // Brief color-only flash used to draw attention to a card (status change,
  // or the note whose view modal was just closed). Background-only so it never
  // affects size, shape, or position.
  function flashCard(el) {
    el.animate([{ backgroundColor: "var(--vscode-focusBorder)" }, { backgroundColor: "var(--vscode-editor-background, var(--vscode-sideBar-background))" }], {
      duration: 500,
      easing: "ease",
    });
  }

  function animateFlip(prevPositions, changedIds) {
    const cards = listEl.querySelectorAll(".card[data-id]");
    const hasMoves = Object.keys(prevPositions).length > 0;

    cards.forEach((el) => {
      const id = el.dataset.id;
      const prev = prevPositions[id];

      if (!prev) {
        // Newly added card
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease" });
        return;
      }

      if (hasMoves) {
        const next = el.getBoundingClientRect();
        const dy = prev.top - next.top;
        if (Math.abs(dy) > 1) {
          el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0px)" }], {
            duration: 250,
            easing: "ease",
          });
        }
      }

      if (changedIds && changedIds[id]) {
        flashCard(el);
      }
    });
  }

  function buildCardBase(item) {
    const t = typeOf(item.typeId);
    const card = document.createElement("div");
    card.className = "card" + (item.archived ? " archived" : "");
    card.dataset.id = item.id;
    card.setAttribute("dir", state.direction);

    const head = document.createElement("div");
    head.className = "card-head";

    // Priority indicator (style chosen by the mindstream.priority.style
    // setting). Notes without a priority get none, so unassigned notes are
    // never shown as an implicit level.
    const indicator = state.priority.cardIndicator;
    const level = indicator && state.priority.levels.includes(item.priority) ? item.priority : null;
    const levelText = level ? `Priority: ${state.priority.labels[level] || level}` : "";
    if (level) {
      card.classList.add(`prio-${level}`, `prio-ind-${indicator}`);
    }

    const title = document.createElement("div");
    title.className = "card-title";
    if (level && indicator === "dot") {
      title.appendChild(buildPriorityDot(level, levelText));
    }
    title.appendChild(document.createTextNode(item.title));
    // Stripe styles are color-only; give screen readers the level as text.
    if (level && (indicator === "stripe" || indicator === "typeStripe")) {
      const srText = document.createElement("span");
      srText.className = "sr-only";
      srText.textContent = ` (${levelText})`;
      title.appendChild(srText);
    }
    head.appendChild(title);

    const typeBadge = document.createElement("span");
    typeBadge.className = "card-type";
    typeBadge.innerHTML = `<span class="${iconClass(t.icon)}"></span> ${esc(t.label)}`;
    if (level && indicator === "typeStripe") {
      typeBadge.dataset.tooltip = levelText;
    }
    head.appendChild(typeBadge);
    card.appendChild(head);

    if (item.description) {
      const desc = document.createElement("div");
      desc.className = "card-desc";
      desc.textContent = item.description;
      card.appendChild(desc);
    }

    if (item.link) {
      const linkRow = document.createElement("div");
      linkRow.className = "card-link";
      linkRow.appendChild(buildLinkBadge(item));
      card.appendChild(linkRow);
      linkRowObserver.observe(linkRow);
    }

    const footer = document.createElement("div");
    footer.className = "card-footer";

    const status = document.createElement("span");
    status.className = "status " + item.status;
    status.textContent = state.statusLabels[item.status] || item.status;
    footer.appendChild(status);

    if (level && indicator === "chip") {
      const chip = document.createElement("span");
      chip.className = "prio-chip";
      chip.appendChild(buildPriorityDot(level, ""));
      chip.appendChild(document.createTextNode(state.priority.labels[level] || level));
      footer.appendChild(chip);
    }

    card.appendChild(footer);

    return card;
  }

  // Small colored dot for a priority level. With `label`, it is announced to
  // screen readers and shows the label as a tooltip; without, it is decorative.
  function buildPriorityDot(level, label) {
    const dot = document.createElement("span");
    dot.className = `prio-dot prio-${level}`;
    if (label) {
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", label);
      dot.dataset.tooltip = label;
    } else {
      dot.setAttribute("aria-hidden", "true");
    }
    return dot;
  }

  function buildCard(item) {
    const card = buildCardBase(item);

    const status = card.querySelector(".card-footer .status");
    status.dataset.tooltip = statusTooltip(item.status);
    status.addEventListener("click", (e) => cycleStatus(item, e));

    const footer = card.querySelector(".card-footer");

    const spacer = document.createElement("span");
    spacer.className = "spacer";
    footer.appendChild(spacer);

    const viewBtn = btnIcon("codicon-eye", "View note", () => openView(item));
    viewBtn.classList.add("card-view-btn");
    footer.appendChild(viewBtn);
    footer.appendChild(btnIcon("codicon-edit", "Edit", () => openEdit(item)));
    footer.appendChild(btnIcon("codicon-archive", item.archived ? "Unarchive" : "Archive", () => toggleArchive(item)));
    footer.appendChild(btnIcon("codicon-trash", "Delete permanently", () => deleteItem(item), true));

    card.addEventListener("dblclick", (e) => {
      if (e.target.closest("button, .status")) {
        return;
      }
      openView(item);
    });

    return card;
  }

  function buildReportCard(item) {
    return buildCardBase(item);
  }

  function markTruncatedCards() {
    listEl.querySelectorAll(".card").forEach((el) => {
      const desc = el.querySelector(".card-desc");
      if (desc && desc.scrollHeight > desc.clientHeight) {
        el.classList.add("has-overflow");
      } else {
        el.classList.remove("has-overflow");
      }
    });
  }

  // group: { key, label, level, items } from ViewOptions.buildGroups().
  // `key` is scoped ("status:done", "priority:high") so collapse state never
  // leaks between grouping modes.
  function buildGroupHeader(group) {
    const header = document.createElement("div");
    header.className = `group-header${state.collapsed[group.key] ? " collapsed" : ""}`;
    header.dataset.group = group.key;

    const chevron = document.createElement("span");
    chevron.className = "chevron codicon codicon-chevron-down";
    header.appendChild(chevron);

    if (group.level) {
      const dot = document.createElement("span");
      dot.className = `prio-dot prio-${group.level}`;
      header.appendChild(dot);
    }

    const label = document.createElement("span");
    label.textContent = group.label;
    header.appendChild(label);

    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = `(${group.items.length})`;
    header.appendChild(count);

    header.addEventListener("click", () => {
      if (state.collapsed[group.key]) {
        delete state.collapsed[group.key];
      } else {
        state.collapsed[group.key] = true;
      }
      persist();
      renderList();
    });
    return header;
  }

  // "42" or "42-50".
  function linkRange(link) {
    return link.lineEnd && link.lineEnd > link.lineStart ? `${link.lineStart}-${link.lineEnd}` : `${link.lineStart}`;
  }

  // "path/to/file.ts:42" or "path/to/file.ts:42-50".
  function linkLabel(link) {
    return `${link.filePath}:${linkRange(link)}`;
  }

  // Text width measured with the badge's own font. A canvas keeps this free of
  // layout work, so trying several path forms per resize stays cheap.
  let linkMeasureCtx = null;
  function measureLinkText(text, font) {
    if (!linkMeasureCtx) {
      linkMeasureCtx = document.createElement("canvas").getContext("2d");
    }
    linkMeasureCtx.font = font;
    return linkMeasureCtx.measureText(text).width;
  }

  // Shows the longest form of the path that fits its row (the full path when
  // there is room, folders in the middle replaced by an ellipsis as the row
  // narrows, the file name always kept). Re-run whenever the row is resized.
  function fitLinkRow(row) {
    const badge = row.querySelector(".link-badge");
    const textEl = badge && badge.querySelector(".link-badge-text");
    const rowWidth = row.getBoundingClientRect().width;
    if (!textEl || rowWidth === 0) {
      // Not laid out yet (hidden modal): the resize observer calls this again when shown.
      return;
    }
    const chrome = badge.getBoundingClientRect().width - textEl.getBoundingClientRect().width;
    const available = rowWidth - chrome - 1;
    const suffix = badge.dataset.suffix;
    const font = getComputedStyle(textEl).font;
    const shown = fitPath(badge.dataset.path, available, (text) => measureLinkText(`${text}${suffix}`, font));
    const next = `${shown}${suffix}`;
    if (textEl.textContent !== next) {
      textEl.textContent = next;
    }
  }

  // One observer for every link row (cards, viewer, editor). A row removed from
  // the page reports a final empty size, which is when it is released.
  const linkRowObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (!entry.target.isConnected) {
        linkRowObserver.unobserve(entry.target);
        continue;
      }
      fitLinkRow(entry.target);
    }
  });

  function linkStateHint(link) {
    if (link.state === "missing") {
      return "The file no longer exists at this path. The note is kept.";
    }
    if (link.state === "changed") {
      return "The linked code changed, so this line may no longer match.";
    }
    return "Open this location in the editor";
  }

  // Read-only badge for a note's code link. Clicking it asks the host to open
  // the file at the (re-resolved) line; the badge itself is never editable.
  function buildLinkBadge(item) {
    const link = item.link;
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = `link-badge link-${link.state}`;
    // The tooltip and the accessible name always carry the full, uncut location.
    badge.dataset.tooltip = `${linkLabel(link)}\n${linkStateHint(link)}`;
    badge.setAttribute("aria-label", `${linkLabel(link)}. ${linkStateHint(link)}`);
    badge.dataset.path = link.filePath;
    badge.dataset.suffix = `:${linkRange(link)}`;
    badge.setAttribute("dir", "ltr");
    const icon = document.createElement("span");
    icon.className = `codicon ${link.state === "ok" ? "codicon-file-code" : "codicon-warning"}`;
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "link-badge-text";
    text.textContent = linkLabel(link);
    badge.appendChild(icon);
    badge.appendChild(text);
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: "openLink", id: item.id });
    });
    return badge;
  }

  function btnIcon(codicon, title, onClick, danger) {
    const b = document.createElement("button");
    b.className = `icon-btn${danger ? " danger" : ""}`;
    b.dataset.tooltip = title;
    b.innerHTML = `<span class="codicon ${codicon}"></span>`;
    b.addEventListener("click", onClick);
    return b;
  }

  function statusTooltip(status) {
    if (status === "pending") {
      return "Change status to 'In Progress'\nCtrl+Click: Change to 'Done'";
    }
    if (status === "in-progress") {
      return "Change status to 'Done'\nCtrl+Click: Change to 'None'";
    }
    // done
    return "Change status to 'None'";
  }

  function cycleStatus(item, event) {
    const ctrl = !!(event && (event.ctrlKey || event.metaKey));
    let next;

    if (!ctrl) {
      // Normal click: forward cycle.
      const i = STATUS_CYCLE.indexOf(item.status);
      next = STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
    } else if (item.status === "pending") {
      next = "done";
    } else if (item.status === "in-progress") {
      next = "pending";
    } else {
      // done + Ctrl+Click: no-op
      return;
    }

    vscode.postMessage({ type: "changeStatus", id: item.id, status: next });
  }

  function toggleArchive(item) {
    vscode.postMessage({ type: "toggleArchive", id: item.id, archived: !item.archived });
  }

  function deleteItem(item) {
    vscode.postMessage({ type: "deleteItem", id: item.id });
  }

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

  // --- Note-editor priority control (segmented radiogroup) ---
  // Rendered only while the priority system is enabled. `value` is the
  // level to select, or null for "no priority yet" (an existing note without
  // a priority), which shows a hint and selects nothing until the user picks.
  function fillPriorityControl(value) {
    const field = $("f-priority-field");
    const enabled = state.priority.editor;
    field.hidden = !enabled;
    const levels = enabled ? state.priority.levels : [];
    state.formPriority = levels.includes(value) ? value : null;

    const group = $("f-priority");
    group.querySelectorAll(".pc-option").forEach((el) => el.remove());
    group.style.setProperty("--pc-count", String(Math.max(levels.length, 1)));
    for (const level of levels) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = `pc-option prio-${level}`;
      option.setAttribute("role", "radio");
      option.dataset.value = level;
      const dot = document.createElement("span");
      dot.className = "pc-dot";
      dot.setAttribute("aria-hidden", "true");
      option.appendChild(dot);
      const label = document.createElement("span");
      label.className = "pc-label";
      label.textContent = state.priority.labels[level] || level;
      option.appendChild(label);
      group.appendChild(option);
    }
    syncPriorityControl();
  }

  // Reflects state.formPriority on the control (checked option, indicator
  // position/color, roving tabindex, and the "no priority" hint).
  function syncPriorityControl() {
    const group = $("f-priority");
    const options = [...group.querySelectorAll(".pc-option")];
    const index = options.findIndex((el) => el.dataset.value === state.formPriority);
    options.forEach((el, i) => {
      const checked = i === index;
      el.setAttribute("aria-checked", String(checked));
      // With nothing selected, the first option is the tab stop.
      el.tabIndex = checked || (index === -1 && i === 0) ? 0 : -1;
    });
    group.classList.toggle("pc-empty", index === -1);
    group.style.setProperty("--pc-index", String(Math.max(index, 0)));
    group.dataset.value = state.formPriority || "";
    $("f-priority-hint").hidden = index !== -1;
  }

  function selectPriority(level, focus) {
    if (!state.priority.levels.includes(level)) {
      return;
    }
    state.formPriority = level;
    syncPriorityControl();
    if (focus) {
      const option = $("f-priority").querySelector(`.pc-option[data-value="${level}"]`);
      if (option) {
        option.focus();
      }
    }
  }

  function onPriorityKeyDown(e) {
    const levels = state.priority.levels;
    if (!levels.length || !e.target.closest(".pc-option")) {
      return;
    }
    const current = levels.indexOf(e.target.dataset.value);
    // Arrows follow the visual order, which flips in a right-to-left layout.
    const rtl = getComputedStyle($("f-priority")).direction === "rtl";
    const step = { ArrowRight: rtl ? -1 : 1, ArrowDown: 1, ArrowLeft: rtl ? 1 : -1, ArrowUp: -1 }[e.key];
    let next = -1;
    if (step) {
      next = (current + step + levels.length) % levels.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = levels.length - 1;
    } else if (e.key === " " || e.key === "Enter") {
      next = current;
    }
    if (next === -1) {
      return;
    }
    e.preventDefault();
    selectPriority(levels[next], true);
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
  function openAdd(link) {
    closeAllModals();
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

  function openEdit(item) {
    closeAllModals();
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

  function closeModal(options) {
    const deferFlash = !!(options && options.deferFlash);
    const itemId = state.editingId;
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
    const title = $("f-title").value.trim();
    if (!title) {
      $("f-title").focus();
      return;
    }
    const isEditing = !!state.editingId;
    const payload = {
      type: isEditing ? "updateItem" : "addItem",
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
    vscode.postMessage(payload);
    closeModal(isEditing ? { deferFlash: true } : undefined);
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }
    return new Date(value).toLocaleString();
  }

  function openView(item) {
    closeAllModals();
    viewingItem = item;

    const t = typeOf(item.typeId);
    const cat = state.categories.find((c) => c.id === item.categoryId);

    const titleEl = $("view-title");
    titleEl.textContent = item.title;
    titleEl.setAttribute("dir", state.direction);

    const typeEl = $("view-type");
    typeEl.innerHTML = `<span class="${iconClass(t.icon)}"></span><span class="chip-label">${esc(t.label)}</span>`;

    const catEl = $("view-category");
    catEl.innerHTML = cat ? `<span class="chip-label">${esc(cat.label)}</span>` : "";
    catEl.hidden = !cat;

    const statusEl = $("view-status");
    statusEl.className = `status ${item.status}`;
    statusEl.innerHTML = `<span class="chip-label">${esc(state.statusLabels[item.status] || item.status)}</span>`;

    const descEl = $("view-desc");
    descEl.setAttribute("dir", state.direction);
    descEl.hidden = !item.description;
    $("view-desc-content").textContent = item.description || "";

    const linkEl = $("view-link");
    linkEl.textContent = "";
    linkEl.hidden = !item.link;
    if (item.link) {
      linkEl.appendChild(buildLinkBadge(item));
      linkRowObserver.observe(linkEl);
    }

    $("view-timestamps").textContent = `Created: ${formatDate(item.createdAt)}\u2003\u00b7\u2003Updated: ${formatDate(item.updatedAt)}`;

    viewModalEl.hidden = false;
  }

  function closeView(options) {
    const skipFlash = !!(options && options.skipFlash);
    const itemId = viewingItem ? viewingItem.id : null;
    viewModalEl.hidden = true;
    viewingItem = null;

    // Close the viewer options menu if it is still open (it lives inside this
    // modal and should never outlive it).
    if (menuCloseHandlers["viewer-options-menu"]) {
      menuCloseHandlers["viewer-options-menu"]();
    }

    // Flash the card that was being viewed so the user can spot it after the
    // modal closes. The card may no longer exist (deleted or filtered out
    // while viewing), in which case this is a harmless no-op. Skipped when
    // transitioning straight into another modal (e.g. Edit), where the card is
    // immediately covered and the flash would only be distracting.
    if (itemId && !skipFlash) {
      const card = listEl.querySelector(`.card[data-id="${itemId}"]`);
      if (card) {
        flashCard(card);
      }
    }
  }

  // Builds the formatted plain-text payload for the "Copy content" action.
  // Layout: title, then an optional blank line + description, then (when the
  // copy includeNoteInfo setting is enabled) a blank line + note-info footer
  // with the note's category, type, status, and timestamps.
  function buildNoteCopyText(item) {
    const lines = [`# ${item.title}`];
    if (item.description) {
      lines.push("");
      lines.push(item.description);
    }
    if (state.copyIncludeNoteInfo) {
      const cat = state.categories.find((c) => c.id === item.categoryId);
      const t = typeOf(item.typeId);
      const statusLabel = state.statusLabels[item.status] || item.status;

      lines.push("");
      lines.push("# Note info :");
      lines.push(`- Category: ${cat ? cat.label : "None"}`);
      lines.push(`- Type: ${t.label}`);
      lines.push(`- Status: ${statusLabel}`);
      lines.push(`- Created: ${formatDate(item.createdAt)}`);
      lines.push(`- Updated: ${formatDate(item.updatedAt)}`);
    }
    return lines.join("\n");
  }

  // Copying is delegated to the extension host (vscode.env.clipboard), since
  // navigator.clipboard is unreliable inside VS Code webviews.
  function copyTextToClipboard(text) {
    vscode.postMessage({ type: "copyToClipboard", text });
  }

  function handleViewerOption(action) {
    if (!viewingItem) {
      return;
    }
    if (action === "copy-id") {
      copyTextToClipboard(viewingItem.id);
    } else if (action === "copy-content") {
      copyTextToClipboard(buildNoteCopyText(viewingItem));
    }
  }

  // Closes every open custom-select dropdown at once by invoking each bound
  // menu's own close function, which hides the menu and removes its
  // document/window listeners immediately (atomic cleanup).
  function closeAllDropdowns() {
    Object.keys(menuCloseHandlers).forEach(function (menuId) {
      menuCloseHandlers[menuId]();
    });
  }

  // Ensures only one overlay (modal or dropdown) is visible at a time within
  // the sidebar.
  function closeAllModals() {
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

  // --- Work Pause note ---
  // While `wp.note.paused` the page shows only this note (every other element
  // is hidden by `body.work-pause-locked`, and the host sends nothing else to
  // draw). View/edit/cancel rules live in media/workPause.js.
  //   wp.mode      "view" | "edit"
  //   wp.enabling  the editor is open before the lock is on ("Pause work" with no note yet)
  //   wp.confirming  a discard question is waiting for the host's answer
  const wp = { note: { text: "", updatedAt: "", paused: false }, mode: "view", enabling: false, confirming: false };
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
    wpSave.disabled = editing && !WorkPause.canSave(wpInput.value);
  }

  function enterWorkPauseEdit() {
    wp.mode = "edit";
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
  function requestWorkPauseCancel() {
    if (wp.mode !== "edit" || wp.confirming) {
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
    if (wp.mode !== "edit" || !WorkPause.canSave(wpInput.value)) {
      return;
    }
    const text = wpInput.value.trim();
    // Not locked yet means this save is the Enable: the host saves, then locks.
    const pause = !wp.note.paused;
    // Shown at once; the saved copy (with its new date) arrives right after.
    wp.note = { ...wp.note, text };
    wp.mode = "view";
    vscode.postMessage({ type: "saveWorkPauseNote", text, pause });
    renderWorkPause();
  }

  // "Pause work" with no saved note: edit first, the lock turns on after Save.
  function openWorkPauseEditor() {
    closeAllModals();
    wp.enabling = true;
    enterWorkPauseEdit();
  }

  // Applies the note part of a "state" message. Returns true while locked, in
  // which case the caller must not render anything else.
  function applyWorkPauseState(msg) {
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

  wpEdit.addEventListener("click", enterWorkPauseEdit);
  $("work-pause-cancel").addEventListener("click", requestWorkPauseCancel);
  wpSave.addEventListener("click", saveWorkPause);
  wpInput.addEventListener("input", () => {
    wpSave.disabled = !WorkPause.canSave(wpInput.value);
  });

  function setArchiveVisible(visible) {
    state.includeArchived = visible;
    $("btn-archive-toggle").textContent = visible ? "Hide archive" : "Archive";
  }

  // --- Categories management modal ---

  function openCategoriesModal() {
    closeAllModals();
    renderCategories();
    $("categories-modal").hidden = false;
    $("f-category-name").value = "";
    $("f-category-name").focus();
  }

  function closeCategoriesModal() {
    $("categories-modal").hidden = true;
  }

  // --- Weekly report modal ---

  function openWeeklyReportModal(report) {
    closeAllModals();
    renderWeeklyReport(report);
    $("report-modal").hidden = false;
  }

  function closeWeeklyReport() {
    $("report-modal").hidden = true;
  }

  function renderWeeklyReport(report) {
    $("report-title").textContent = `Weekly Report — Week of ${report.weekLabel}`;

    const summary = $("report-summary");
    summary.innerHTML = "";
    summary.appendChild(reportStat("Created this week", `${report.createdCount} notes`));
    summary.appendChild(reportStat("Completed this week", `${report.completedCount} notes`));
    summary.appendChild(reportStat("Currently in progress", `${report.inProgressCount} notes`));
    summary.appendChild(reportStat("Archived this week", `${report.archivedCount} notes`));

    const body = $("report-body");
    body.innerHTML = "";
    const completed = report.completed || [];
    const inProgress = report.inProgress || [];
    if (inProgress.length) {
      body.appendChild(reportSectionHeader("In progress", inProgress.length));
      inProgress.forEach((it) => body.appendChild(buildReportCard(it)));
    }
    if (completed.length) {
      body.appendChild(reportSectionHeader("Completed", completed.length));
      completed.forEach((it) => body.appendChild(buildReportCard(it)));
    }
    if (!completed.length && !inProgress.length) {
      const empty = document.createElement("div");
      empty.className = "report-empty";
      empty.textContent = "No completed or in-progress notes this week.";
      body.appendChild(empty);
    }
  }

  function reportStat(label, value) {
    const row = document.createElement("div");
    row.className = "report-stat";
    const l = document.createElement("span");
    l.className = "report-stat-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "report-stat-value";
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function reportSectionHeader(label, count) {
    const h = document.createElement("div");
    h.className = "report-section-header";
    h.textContent = `${label} (${count})`;
    return h;
  }

  function renderCategories(highlightId) {
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

  // --- Types management modal ---

  function openTypesModal() {
    closeAllModals();
    state.pendingTypeIcon = "tag";
    state.iconsModalMode = null;
    renderTypes();
    renderTypeIconButton();
    $("types-modal").hidden = false;
    $("f-type-name").value = "";
    $("f-type-name").focus();
  }

  function closeTypesModal() {
    $("types-modal").hidden = true;
    $("icons-modal").hidden = true;
    state.iconsModalMode = null;
    clearTypeIconActive();
  }

  function renderTypeIconButton() {
    const glyph = $("btn-type-icon-glyph");
    glyph.className = "codicon " + (state.pendingTypeIcon ? "codicon-" + state.pendingTypeIcon : "codicon-tag");
  }

  function renderTypes(highlightId) {
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

  function closeIconsModal() {
    $("icons-modal").hidden = true;
    state.iconsModalMode = null;
    clearTypeIconActive();
  }

  function renderIcons(filter) {
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

  // --- Emoji picker (anchored to the focused title/description field) ---

  function insertEmojiAtCaret(input, emoji) {
    const start = typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
    const end = typeof input.selectionEnd === "number" ? input.selectionEnd : input.value.length;
    input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
    const caret = start + emoji.length;
    input.setSelectionRange(caret, caret);
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

  function closeEmojiPicker() {
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

  function closeEmojiEditModal() {
    $("emoji-edit-modal").hidden = true;
    if (emojiNoticeTimer) {
      clearTimeout(emojiNoticeTimer);
      emojiNoticeTimer = null;
    }
    $("emoji-notice").hidden = true;
  }

  function renderEmojiEditPreview() {
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

  let prevStatusById = {};

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg) {
      return;
    }
    if (msg.type === "workPauseDiscardAnswer") {
      wp.confirming = false;
      if (wp.mode === "edit") {
        if (msg.discard) {
          leaveWorkPauseEdit();
        } else {
          wpInput.focus();
        }
      }
      return;
    }
    if (msg.type === "openWorkPauseEditor") {
      if (!wp.note.paused) {
        openWorkPauseEditor();
      }
      return;
    }
    // Locked: only state messages (which carry the note) are processed.
    if (wp.note.paused && msg.type !== "state") {
      return;
    }
    if (msg.type === "openAddNote") {
      openAdd(msg.link);
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
    if (pendingFlashId) {
      changedIds[pendingFlashId] = true;
      pendingFlashId = null;
    }

    const prevCategories = state.categories || [];
    const prevTypes = state.types || [];
    state.items = newItems;
    state.types = msg.types || [];
    state.categories = msg.categories || [];
    state.statusLabels = msg.statusLabels || {};
    state.includeArchived = !!msg.includeArchived;
    state.direction = msg.direction === "rtl" ? "rtl" : "ltr";
    state.emojiPalette = msg.emojiPalette || [];
    state.emojiRecents = msg.emojiRecents || [];
    // Keep the open emoji edit modal in sync after a server-side restore.
    if (!$("emoji-edit-modal").hidden) {
      $("f-emoji-list").value = state.emojiPalette.join("");
      renderEmojiEditPreview();
    }
    state.descriptionHeight = typeof msg.descriptionHeight === "number" ? msg.descriptionHeight : DEFAULT_DESCRIPTION_HEIGHT;
    state.copyIncludeNoteInfo = msg.copyIncludeNoteInfo !== false;
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

    prevStatusById = {};
    newItems.forEach((it) => {
      prevStatusById[it.id] = it.status;
    });
  });

  function populateCategoryFilter() {
    const current = state.categoryFilter;
    const totalCount = state.items.length;
    const options = [{ value: "all", label: "All Categories", badgeEnd: `(${totalCount})` }].concat(
      state.categories.map(function (c) {
        const count = state.items.filter(function (it) {
          return it.categoryId === c.id;
        }).length;
        return { value: c.id, label: c.label, badgeEnd: `(${count})` };
      })
    );
    if (state.categories.length && !state.categories.some((c) => c.id === current)) {
      state.categoryFilter = "all";
    }
    $("category-filter-container").innerHTML = renderCustomSelect(
      "category-filter-wrap",
      "category-filter-btn",
      "category-filter-menu",
      options,
      state.categoryFilter,
      "cs-btn-toolbar",
      false,
      ""
    );
    // Tooltip goes on the button itself, not the outer container: the
    // container also holds the dropdown menu, and a tooltip attribute on an
    // ancestor of .cs-item would be picked up by closest() while hovering
    // menu items, showing the wrong tooltip.
    $("category-filter-btn").dataset.tooltip = "Filter by category";
    bindCustomSelect("category-filter-wrap", "category-filter-btn", "category-filter-menu", function (value) {
      state.categoryFilter = value;
      persist();
      populateTypeFilter();
      renderList();
    });
  }

  function populateTypeFilter() {
    const current = state.typeFilter;
    const inCategory = itemsInCategory();
    const options = [{ value: "all", label: "All Types", badgeEnd: `(${inCategory.length})` }].concat(
      state.types.map(function (t) {
        const count = inCategory.filter(function (it) {
          return it.typeId === t.id;
        }).length;
        return {
          value: t.id,
          label: t.label,
          badgeStart: t.icon ? `<span class="${iconClass(t.icon)}"></span>` : "",
          badgeEnd: `(${count})`,
        };
      })
    );
    if (state.types.length && !state.types.some((t) => t.id === current)) {
      state.typeFilter = "all";
    }
    $("type-filter-container").innerHTML = renderCustomSelect("type-filter-wrap", "type-filter-btn", "type-filter-menu", options, state.typeFilter, "cs-btn-toolbar", false, "");
    // Tooltip on the button (not the container), matching the other filters.
    $("type-filter-btn").dataset.tooltip = "Filter by type";
    bindCustomSelect("type-filter-wrap", "type-filter-btn", "type-filter-menu", function (value) {
      state.typeFilter = value;
      persist();
      renderList();
    });
  }

  // --- Toolbar "View" menu (group / sort / priority filter) ---
  // DropdownMenu (media/dropdown-menu.js) is appended to <body>, so the
  // button's own data-tooltip never wraps the menu items (unlike .cs-wrap).
  const viewMenu = DropdownMenu.create({
    trigger: $("view-options-btn"),
    label: "View options",
    entries: [],
    onSelect(detail) {
      const next = ViewOptions.applySelection(state.view, detail);
      if (next) {
        setView(next);
      }
    },
  });
  // Lets closeAllDropdowns() dismiss it together with the custom selects.
  menuCloseHandlers["view-options-menu"] = () => viewMenu.close(false);

  function setView(next) {
    state.view = next;
    persist();
    renderViewOptions();
    renderList();
  }

  function renderViewOptions() {
    const filtered = ViewOptions.isFilterActive(state.view, state.priority);
    $("view-options-label").textContent = ViewOptions.triggerLabel(state.view, state.priority);
    $("view-options-icon").className = `codicon ${filtered ? "codicon-filter-filled view-options-filtered" : "codicon-list-filter"}`;
    $("view-options-btn").dataset.tooltip = filtered ? "View options (some priorities are hidden)" : "View options";
    viewMenu.setEntries(ViewOptions.menuEntries(state.view, state.priority));
  }

  $("btn-archive-toggle").addEventListener("click", () => {
    vscode.postMessage({ type: "toggleArchiveView" });
  });
  emptyEl.addEventListener("click", (e) => {
    if (e.target.closest(".empty-create-btn")) {
      openAdd();
    } else if (e.target.closest(".empty-show-all-btn")) {
      setView({ ...state.view, hiddenPriorities: [] });
    }
  });
  $("f-priority").addEventListener("click", (e) => {
    const option = e.target.closest(".pc-option");
    if (option) {
      selectPriority(option.dataset.value, false);
    }
  });
  $("f-priority").addEventListener("keydown", onPriorityKeyDown);
  $("modal-close").addEventListener("click", closeModal);
  $("modal-cancel").addEventListener("click", closeModal);
  $("modal-save").addEventListener("click", saveModal);
  $("view-close").addEventListener("click", closeView);
  $("view-close-btn").addEventListener("click", closeView);
  $("view-edit").addEventListener("click", () => {
    const item = viewingItem;
    closeView({ skipFlash: true });
    if (item) {
      openEdit(item);
    }
  });

  // Viewer options menu: render the action menu into the header wrapper, then
  // bind the icon-only trigger once (the header is static and never re-rendered).
  $("viewer-options-wrap").insertAdjacentHTML(
    "beforeend",
    renderActionMenu(
      "viewer-options-menu",
      [
        { action: "copy-id", label: "Copy ID", icon: "link" },
        { action: "copy-content", label: "Copy content", icon: "copy" },
      ],
      ""
    )
  );
  bindActionMenu("viewer-option-btn", "viewer-options-menu", handleViewerOption);

  $("categories-close").addEventListener("click", closeCategoriesModal);
  $("report-close").addEventListener("click", closeWeeklyReport);
  $("btn-add-category").addEventListener("click", addCategoryFromInput);
  $("f-category-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addCategoryFromInput();
    }
  });

  $("types-close").addEventListener("click", closeTypesModal);
  $("btn-add-type").addEventListener("click", addTypeFromInput);
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

  $("f-title").addEventListener("keydown", (e) => handleEmojiShortcut(e, $("f-title")));
  $("f-desc").addEventListener("keydown", (e) => handleEmojiShortcut(e, $("f-desc")));

  // Track the last focused title/description field so the hint button opens
  // the picker anchored to the right field, then inserts at its caret.
  let lastEmojiField = null;
  ["f-title", "f-desc"].forEach((id) => {
    $(id).addEventListener("focus", () => {
      lastEmojiField = $(id);
    });
  });
  $("emoji-hint").addEventListener("click", () => {
    const field = lastEmojiField && lastEmojiField.isConnected ? lastEmojiField : $("f-title");
    openEmojiPicker(field);
  });

  // macOS uses Cmd instead of Ctrl; the keydown handler accepts both
  // (metaKey or ctrlKey), so only the hint label differs per platform.
  if (/Mac/i.test(navigator.platform || "") || /Macintosh/i.test(navigator.userAgent || "")) {
    $("emoji-hint").textContent = "💡 ⌘⇧/ inserts an emoji";
  }

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
    if ($("emoji-picker").hidden) return;
    if ($("emoji-picker").contains(e.target)) return;
    closeEmojiPicker();
  });

  // Keep the open picker pinned to its input when the window is resized.
  window.addEventListener("resize", () => {
    if ($("emoji-picker").hidden) return;
    if (state.emojiTarget) positionEmojiPicker(state.emojiTarget);
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

  document.addEventListener("keydown", (e) => {
    // The Work Pause note covers the whole page: Esc only ever concerns its editor.
    if (!workPauseEl.hidden) {
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
})();
