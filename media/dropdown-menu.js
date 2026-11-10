/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// DropdownMenu - a dependency-free, accessible dropdown menu.
//
// Self-contained: this file plus dropdown-menu.css are the whole component.
// It reads no globals; it only uses the trigger's own document and window,
// so it works in any page, webview, or iframe and can be moved to a shared
// library unchanged. Pure helpers are exposed on `DropdownMenu.utils` for
// unit tests; the guarded `module.exports` at the bottom never runs in a
// browser.
//
// Usage:
//   const menu = DropdownMenu.create({
//     trigger: buttonElement,         // required: an existing <button>
//     entries: [...],                 // see "Entries" below
//     onSelect: (detail) => {},       // called when an enabled entry is activated
//     label: "View options",          // optional aria-label (else aria-labelledby the trigger id)
//     align: "start",                 // optional: "start" (default) or "end"
//     className: "extra-class",       // optional extra class on the menu element
//     hintAttribute: "data-tooltip",  // optional: attribute that receives `hint`; null disables hints
//     onOpenChange: (isOpen) => {},   // optional
//   });
//   menu.setEntries(nextEntries);     // re-render, keeping the highlighted entry
//   menu.open("first" | "last" | "none");
//   menu.close(restoreFocus);
//   menu.toggle();
//   menu.isOpen();
//   menu.destroy();
//   menu.element;                     // the role="menu" element (appended to <body>)
//
// Entries (every entry accepts `hidden: true` to omit it):
//   { type: "item", id, text, icon?, disabled?, hint?, closeOnSelect? = true }
//   { type: "checkbox", id, text, checked, markerClass?, disabled?, hint?, closeOnSelect? = false }
//   { type: "radio-group", id, label?, value, closeOnSelect? = false,
//     items: [{ value, text, markerClass?, disabled?, hint? }] }
//   { type: "group", label?, items: [item | checkbox entries] }
//   { type: "separator" }
// Leading, trailing, and repeated separators are dropped, and groups whose
// items are all hidden are omitted, so whole sections can be hidden without
// leaving stray lines. `icon` is a class string (e.g. "codicon codicon-eye");
// `markerClass` adds a small leading dot whose color the consumer sets via
// the `--dm-marker-color` custom property.
//
// onSelect detail:
//   { kind: "item", id }
//   { kind: "checkbox", id, checked }   // `checked` is the requested new state
//   { kind: "radio", group, value }
//
// The menu is controlled: it never changes `checked` or `value` by itself.
// Update your state in onSelect, then call setEntries() with new entries.
//
// Text is always written with textContent. `hint` is written to
// `hintAttribute` as-is; if that attribute is rendered as HTML by a tooltip
// system, pass only trusted strings.
//
// Keyboard (WAI-ARIA menu button pattern):
//   Trigger: Enter/Space open and focus the first item; ArrowDown/ArrowUp
//            open and focus the first/last item. A pointer click opens the
//            menu without highlighting any item.
//   Menu:    ArrowDown/ArrowUp move (wrapping), Home/End jump, Enter/Space
//            activate, printable characters jump by label (typeahead),
//            Escape/Tab close and return focus to the trigger.
// Disabled items stay focusable (aria-disabled) so keyboard and screen
// reader users can still reach their hint, but they cannot be activated.

const DropdownMenu = (() => {
  const TYPEAHEAD_RESET_MS = 500;
  const SVG_NS = "http://www.w3.org/2000/svg";
  let instanceCounter = 0;

  // ---------------------------------------------------------------------
  // Pure helpers (no DOM access)
  // ---------------------------------------------------------------------

  function isHidden(entry) {
    return !entry || entry.hidden === true;
  }

  /**
   * Removes hidden entries, empty groups, and redundant separators.
   * @param {Array<object>} entries
   * @returns {Array<object>} a new array; group entries are shallow-copied.
   */
  function normalizeEntries(entries) {
    const result = [];
    for (const entry of entries || []) {
      if (isHidden(entry)) {
        continue;
      }
      if (entry.type === "separator") {
        if (result.length > 0 && result[result.length - 1].type !== "separator") {
          result.push(entry);
        }
        continue;
      }
      if (entry.type === "group" || entry.type === "radio-group") {
        const items = (entry.items || []).filter((child) => !isHidden(child));
        if (items.length > 0) {
          result.push({ ...entry, items });
        }
        continue;
      }
      result.push(entry);
    }
    while (result.length > 0 && result[result.length - 1].type === "separator") {
      result.pop();
    }
    return result;
  }

  function describeLeaf(entry) {
    const base = {
      text: String(entry.text ?? ""),
      disabled: entry.disabled === true,
      source: entry,
    };
    if (entry.type === "item") {
      return { ...base, key: `item:${entry.id}`, kind: "item", id: entry.id, checked: false, closeOnSelect: entry.closeOnSelect !== false };
    }
    if (entry.type === "checkbox") {
      return { ...base, key: `checkbox:${entry.id}`, kind: "checkbox", id: entry.id, checked: entry.checked === true, closeOnSelect: entry.closeOnSelect === true };
    }
    throw new Error(`DropdownMenu: unsupported entry type "${entry.type}"`);
  }

  function describeRadio(group, option) {
    return {
      key: `radio:${group.id}:${option.value}`,
      kind: "radio",
      group: group.id,
      value: option.value,
      text: String(option.text ?? ""),
      disabled: option.disabled === true,
      checked: option.value === group.value,
      closeOnSelect: group.closeOnSelect === true,
      source: option,
    };
  }

  /**
   * Flattens normalized entries into focusable item descriptors, in the
   * same order the items appear in the DOM.
   * @param {Array<object>} normalized - output of normalizeEntries().
   * @returns {Array<object>}
   */
  function describeEntries(normalized) {
    const list = [];
    for (const entry of normalized) {
      if (entry.type === "separator") {
        continue;
      }
      if (entry.type === "radio-group") {
        for (const option of entry.items) {
          list.push(describeRadio(entry, option));
        }
      } else if (entry.type === "group") {
        for (const child of entry.items) {
          list.push(describeLeaf(child));
        }
      } else {
        list.push(describeLeaf(entry));
      }
    }
    return list;
  }

  /**
   * Resolves what activating a descriptor does.
   * @returns {{ detail: object, close: boolean } | null} null when disabled.
   */
  function activationFor(descriptor) {
    if (!descriptor || descriptor.disabled) {
      return null;
    }
    let detail;
    if (descriptor.kind === "item") {
      detail = { kind: "item", id: descriptor.id };
    } else if (descriptor.kind === "checkbox") {
      detail = { kind: "checkbox", id: descriptor.id, checked: !descriptor.checked };
    } else {
      detail = { kind: "radio", group: descriptor.group, value: descriptor.value };
    }
    return { detail, close: descriptor.closeOnSelect };
  }

  /**
   * Moves an index by `delta`, wrapping around. With no current index,
   * a forward move lands on the first item and a backward move on the last.
   * @returns {number} -1 when there are no items.
   */
  function moveIndex(count, current, delta) {
    if (count <= 0) {
      return -1;
    }
    if (current < 0 || current >= count) {
      return delta < 0 ? count - 1 : 0;
    }
    return (((current + delta) % count) + count) % count;
  }

  /**
   * Finds the item whose label starts with the typed query. A single
   * character (or the same character repeated) cycles through matches
   * starting after the current item; a longer query refines the current one.
   * @returns {number} the matching index, or -1.
   */
  function findTypeaheadMatch(descriptors, current, query) {
    const typed = String(query || "").toLowerCase();
    const count = descriptors.length;
    if (!typed || count === 0) {
      return -1;
    }
    const isRepeat = typed.length > 1 && [...typed].every((ch) => ch === typed[0]);
    const needle = isRepeat ? typed[0] : typed;
    const start = needle.length > 1 ? Math.max(current, 0) : current + 1;
    for (let step = 0; step < count; step++) {
      const index = (((start + step) % count) + count) % count;
      if (descriptors[index].text.toLowerCase().startsWith(needle)) {
        return index;
      }
    }
    return -1;
  }

  /**
   * Places the menu below the anchor (or above it when there is clearly
   * more room there), aligned to the anchor's start or end edge and clamped
   * horizontally inside the viewport.
   * @param {object} opts
   * @param {{left:number, top:number, right:number, bottom:number}} opts.anchor
   * @param {{width:number, height:number}} opts.menu - natural menu size.
   * @param {{width:number, height:number}} opts.viewport
   * @param {"start"|"end"} [opts.align]
   * @param {number} [opts.offset] - gap between anchor and menu.
   * @param {number} [opts.margin] - minimum distance from viewport edges.
   * @returns {{ left:number, top:number, maxHeight:number, placement:"bottom"|"top" }}
   */
  function computePosition(opts) {
    const offset = opts.offset ?? 4;
    const margin = opts.margin ?? 4;
    const { anchor, menu, viewport } = opts;

    const preferredLeft = opts.align === "end" ? anchor.right - menu.width : anchor.left;
    const left = Math.max(margin, Math.min(preferredLeft, viewport.width - margin - menu.width));

    const spaceBelow = Math.max(0, viewport.height - anchor.bottom - offset - margin);
    const spaceAbove = Math.max(0, anchor.top - offset - margin);
    const placement = menu.height > spaceBelow && spaceAbove > spaceBelow ? "top" : "bottom";
    const maxHeight = placement === "bottom" ? spaceBelow : spaceAbove;
    const height = Math.min(menu.height, maxHeight);
    const top = placement === "bottom" ? anchor.bottom + offset : anchor.top - offset - height;

    return { left: Math.round(left), top: Math.round(top), maxHeight: Math.floor(maxHeight), placement };
  }

  // ---------------------------------------------------------------------
  // DOM component
  // ---------------------------------------------------------------------

  function create(options) {
    const trigger = options && options.trigger;
    if (!trigger || !trigger.ownerDocument) {
      throw new Error("DropdownMenu: `trigger` element is required");
    }
    const doc = trigger.ownerDocument;
    const win = doc.defaultView;
    const menuId = `dm-menu-${++instanceCounter}`;
    const hintAttribute = options.hintAttribute === undefined ? "data-tooltip" : options.hintAttribute;
    const align = options.align === "end" ? "end" : "start";

    let entries = options.entries || [];
    let descriptors = [];
    let itemElements = [];
    let activeIndex = -1;
    let isOpen = false;
    let typeBuffer = "";
    let typeTimer = null;

    const menuEl = doc.createElement("div");
    menuEl.id = menuId;
    menuEl.className = options.className ? `dm-menu ${options.className}` : "dm-menu";
    menuEl.setAttribute("role", "menu");
    menuEl.tabIndex = -1;
    menuEl.hidden = true;
    if (options.label) {
      menuEl.setAttribute("aria-label", options.label);
    } else if (trigger.id) {
      menuEl.setAttribute("aria-labelledby", trigger.id);
    }
    doc.body.appendChild(menuEl);

    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", menuId);

    function createElement(tag, className) {
      const node = doc.createElement(tag);
      if (className) {
        node.className = className;
      }
      return node;
    }

    function buildCheckIcon() {
      const svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("class", "dm-check");
      const path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", "M3.5 8.5l3 3 6-7");
      svg.appendChild(path);
      return svg;
    }

    function buildIndicator(descriptor) {
      const indicator = createElement("span", "dm-indicator");
      indicator.setAttribute("aria-hidden", "true");
      if (descriptor.kind === "checkbox" && descriptor.checked) {
        indicator.appendChild(buildCheckIcon());
      } else if (descriptor.kind === "radio" && descriptor.checked) {
        indicator.appendChild(createElement("span", "dm-radio-dot"));
      } else if (descriptor.kind === "item" && descriptor.source.icon) {
        indicator.appendChild(createElement("span", descriptor.source.icon));
      }
      return indicator;
    }

    function buildItem(descriptor) {
      const source = descriptor.source;
      const node = createElement("div", `dm-item dm-item-${descriptor.kind}`);
      node.setAttribute("role", descriptor.kind === "item" ? "menuitem" : `menuitem${descriptor.kind}`);
      node.tabIndex = -1;
      node.dataset.key = descriptor.key;
      if (descriptor.kind !== "item") {
        node.setAttribute("aria-checked", String(descriptor.checked));
      }
      if (descriptor.disabled) {
        node.setAttribute("aria-disabled", "true");
      }
      if (hintAttribute && source.hint) {
        node.setAttribute(hintAttribute, source.hint);
      }
      node.appendChild(buildIndicator(descriptor));

      const content = createElement("span", "dm-content");
      if (source.markerClass) {
        const marker = createElement("span", `dm-marker ${source.markerClass}`);
        marker.setAttribute("aria-hidden", "true");
        content.appendChild(marker);
      }
      const text = createElement("span", "dm-text");
      text.textContent = descriptor.text;
      content.appendChild(text);
      node.appendChild(content);
      return node;
    }

    function render() {
      const previousKey = activeIndex >= 0 && descriptors[activeIndex] ? descriptors[activeIndex].key : null;
      const normalized = normalizeEntries(entries);
      descriptors = describeEntries(normalized);
      itemElements = [];
      activeIndex = -1;

      const fragment = doc.createDocumentFragment();
      let labelCounter = 0;
      const appendNextItem = (parent) => {
        const node = buildItem(descriptors[itemElements.length]);
        itemElements.push(node);
        parent.appendChild(node);
      };

      for (const entry of normalized) {
        if (entry.type === "separator") {
          const separator = createElement("div", "dm-separator");
          separator.setAttribute("role", "separator");
          fragment.appendChild(separator);
          continue;
        }
        if (entry.type === "group" || entry.type === "radio-group") {
          const group = createElement("div", "dm-group");
          group.setAttribute("role", "group");
          if (entry.label) {
            const label = createElement("div", "dm-label");
            label.id = `${menuId}-label-${++labelCounter}`;
            label.textContent = entry.label;
            group.setAttribute("aria-labelledby", label.id);
            group.appendChild(label);
          }
          for (let i = 0; i < entry.items.length; i++) {
            appendNextItem(group);
          }
          fragment.appendChild(group);
          continue;
        }
        appendNextItem(fragment);
      }

      menuEl.replaceChildren(fragment);

      // Re-rendering replaces the focused element, so restore the keyboard
      // position (and focus) by key while the menu is visible.
      if (isOpen && !menuEl.hidden) {
        const restored = previousKey ? descriptors.findIndex((d) => d.key === previousKey) : -1;
        if (restored >= 0) {
          setActive(restored);
        } else {
          menuEl.focus();
        }
      }
    }

    function setActive(index) {
      if (activeIndex >= 0 && itemElements[activeIndex]) {
        itemElements[activeIndex].removeAttribute("data-highlighted");
      }
      activeIndex = index;
      const node = itemElements[index];
      if (!node) {
        activeIndex = -1;
        if (isOpen) {
          menuEl.focus();
        }
        return;
      }
      node.setAttribute("data-highlighted", "");
      if (isOpen) {
        node.focus();
      }
    }

    // Position values are computed at runtime, so they are passed as CSS
    // custom properties (setProperty), never as inline style declarations.
    function position() {
      if (!isOpen) {
        return;
      }
      if (!trigger.isConnected) {
        close(false);
        return;
      }
      const anchor = trigger.getBoundingClientRect();
      menuEl.style.setProperty("--dm-trigger-width", `${Math.round(anchor.width)}px`);
      menuEl.style.setProperty("--dm-max-height", "none");
      const result = computePosition({
        anchor,
        menu: { width: menuEl.offsetWidth, height: menuEl.offsetHeight },
        viewport: { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight },
        align,
      });
      menuEl.style.setProperty("--dm-left", `${result.left}px`);
      menuEl.style.setProperty("--dm-top", `${result.top}px`);
      menuEl.style.setProperty("--dm-max-height", `${result.maxHeight}px`);
      menuEl.dataset.placement = result.placement;
    }

    function resetTypeahead() {
      typeBuffer = "";
      if (typeTimer) {
        win.clearTimeout(typeTimer);
        typeTimer = null;
      }
    }

    function typeahead(char) {
      typeBuffer += char;
      if (typeTimer) {
        win.clearTimeout(typeTimer);
      }
      typeTimer = win.setTimeout(resetTypeahead, TYPEAHEAD_RESET_MS);
      const match = findTypeaheadMatch(descriptors, activeIndex, typeBuffer);
      if (match !== -1) {
        setActive(match);
      }
    }

    function activate(index) {
      const action = activationFor(descriptors[index]);
      if (!action) {
        return;
      }
      if (action.close) {
        close(true);
      }
      if (typeof options.onSelect === "function") {
        options.onSelect(action.detail);
      }
    }

    function open(focusMode) {
      if (isOpen) {
        return;
      }
      isOpen = true;
      activeIndex = -1;
      render();
      menuEl.hidden = false;
      position();
      trigger.setAttribute("aria-expanded", "true");
      doc.addEventListener("pointerdown", onDocumentPointerDown, true);
      doc.addEventListener("scroll", onDocumentScroll, true);
      win.addEventListener("resize", position);
      win.addEventListener("blur", onWindowBlur);

      if (focusMode === "first") {
        setActive(moveIndex(descriptors.length, -1, 1));
      } else if (focusMode === "last") {
        setActive(moveIndex(descriptors.length, -1, -1));
      } else {
        menuEl.focus();
      }
      if (typeof options.onOpenChange === "function") {
        options.onOpenChange(true);
      }
    }

    function close(restoreFocus) {
      if (!isOpen) {
        return;
      }
      isOpen = false;
      if (activeIndex >= 0 && itemElements[activeIndex]) {
        itemElements[activeIndex].removeAttribute("data-highlighted");
      }
      activeIndex = -1;
      resetTypeahead();
      menuEl.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      doc.removeEventListener("pointerdown", onDocumentPointerDown, true);
      doc.removeEventListener("scroll", onDocumentScroll, true);
      win.removeEventListener("resize", position);
      win.removeEventListener("blur", onWindowBlur);
      if (restoreFocus && trigger.isConnected) {
        trigger.focus();
      }
      if (typeof options.onOpenChange === "function") {
        options.onOpenChange(false);
      }
    }

    function itemIndexFromEvent(event) {
      const node = event.target && event.target.closest ? event.target.closest(".dm-item") : null;
      return node ? itemElements.indexOf(node) : -1;
    }

    function onTriggerClick(event) {
      if (isOpen) {
        close(true);
        return;
      }
      // detail === 0 means the click came from the keyboard (Enter/Space).
      open(event.detail === 0 ? "first" : "none");
    }

    function onTriggerKeyDown(event) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      event.preventDefault();
      if (!isOpen) {
        open(event.key === "ArrowDown" ? "first" : "last");
      }
    }

    function onMenuPointerMove(event) {
      const index = itemIndexFromEvent(event);
      if (index !== -1 && index !== activeIndex) {
        setActive(index);
      }
    }

    function onMenuPointerLeave() {
      if (activeIndex !== -1) {
        setActive(-1);
      }
    }

    function onMenuClick(event) {
      const index = itemIndexFromEvent(event);
      if (index !== -1) {
        activate(index);
      }
    }

    function onMenuKeyDown(event) {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const count = descriptors.length;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setActive(moveIndex(count, activeIndex, 1));
          return;
        case "ArrowUp":
          event.preventDefault();
          setActive(moveIndex(count, activeIndex, -1));
          return;
        case "Home":
        case "PageUp":
          event.preventDefault();
          setActive(moveIndex(count, -1, 1));
          return;
        case "End":
        case "PageDown":
          event.preventDefault();
          setActive(moveIndex(count, -1, -1));
          return;
        case "Enter":
          event.preventDefault();
          if (activeIndex !== -1) {
            activate(activeIndex);
          }
          return;
        case " ":
          if (typeBuffer) {
            break; // A space inside a typeahead query is part of the label.
          }
          event.preventDefault();
          if (activeIndex !== -1) {
            activate(activeIndex);
          }
          return;
        case "Escape":
          event.preventDefault();
          event.stopPropagation(); // Do not also close an enclosing modal.
          close(true);
          return;
        case "Tab":
          event.preventDefault();
          close(true);
          return;
        default:
          break;
      }
      if (event.key.length === 1) {
        event.preventDefault();
        typeahead(event.key);
      }
    }

    function onDocumentPointerDown(event) {
      if (menuEl.contains(event.target) || trigger.contains(event.target)) {
        return;
      }
      close(false);
    }

    function onDocumentScroll(event) {
      if (event.target !== menuEl) {
        position();
      }
    }

    function onWindowBlur() {
      close(false);
    }

    trigger.addEventListener("click", onTriggerClick);
    trigger.addEventListener("keydown", onTriggerKeyDown);
    menuEl.addEventListener("pointermove", onMenuPointerMove);
    menuEl.addEventListener("pointerleave", onMenuPointerLeave);
    menuEl.addEventListener("click", onMenuClick);
    menuEl.addEventListener("keydown", onMenuKeyDown);
    render();

    return {
      element: menuEl,
      open,
      close,
      toggle() {
        if (isOpen) {
          close(true);
        } else {
          open("first");
        }
      },
      isOpen: () => isOpen,
      setEntries(nextEntries) {
        entries = nextEntries || [];
        render();
        position();
      },
      destroy() {
        close(false);
        trigger.removeEventListener("click", onTriggerClick);
        trigger.removeEventListener("keydown", onTriggerKeyDown);
        trigger.removeAttribute("aria-haspopup");
        trigger.removeAttribute("aria-expanded");
        trigger.removeAttribute("aria-controls");
        menuEl.remove();
      },
    };
  }

  return {
    create,
    utils: { normalizeEntries, describeEntries, activationFor, moveIndex, findTypeaheadMatch, computePosition },
  };
})();

// Exposes the component to Node-based unit tests. This branch never runs in
// a browser, where `module` is undefined.
if (typeof module !== "undefined" && module.exports) {
  module.exports = DropdownMenu;
}
