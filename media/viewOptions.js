/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Group / sort / priority-filter rules for the note list, plus the entries of
// the toolbar "View" menu. Side-effect-free (no DOM, no acquireVsCodeApi), so
// it is loaded as a global before sidebar.js and required directly by Mocha
// tests.
//
// `view` is the user's saved choice: { groupBy, sortBy, hiddenPriorities }.
// `features` is the priority feature set posted by the host
// (src/priority.ts priorityFeatures() + levels/labels/defaultValue).
// Saved choices are never rewritten when they cannot apply (e.g. the priority
// system is disabled, or the sort key equals the group key); the effective*
// helpers return what is actually applied instead, so the saved choice comes
// back as soon as it is valid again.

const ViewOptions = (() => {
  const GROUP_BY = ["none", "status", "priority"];
  const SORT_BY = ["date", "fixed", "status", "priority"];
  const STATUS_ORDER = ["pending", "in-progress", "done"];
  const GROUP_LABEL = { none: "None", status: "Status", priority: "Priority" };
  const SORT_LABEL = { date: "Date modified", fixed: "Fixed order", status: "Status", priority: "Priority" };
  const UNASSIGNED_LABEL = "Unassigned";

  /** View used when nothing valid is saved. */
  const DEFAULT_VIEW = Object.freeze({ groupBy: "status", sortBy: "priority", hiddenPriorities: Object.freeze([]) });

  /** Older single "view mode" values, mapped to the equivalent group + sort. */
  const LEGACY_VIEW_MODES = {
    auto: { groupBy: "none", sortBy: "status" },
    fixed: { groupBy: "none", sortBy: "fixed" },
    grouped: { groupBy: "status", sortBy: "date" },
  };

  // Each sort is a chain of keys; the grouped key and (while disabled) the
  // priority key are removed from the chain at sort time.
  const SORT_CHAINS = {
    date: ["date"],
    fixed: [],
    status: ["status", "priority", "date"],
    priority: ["priority", "status", "date"],
  };

  /** Feature set meaning "priority system disabled"; used until the host says otherwise. */
  const NO_PRIORITY = Object.freeze({
    enabled: false,
    editor: false,
    group: false,
    sort: false,
    filter: false,
    cardIndicator: null,
    levels: Object.freeze([]),
    labels: Object.freeze({}),
    defaultValue: null,
  });

  /** Coerces the host payload into a complete feature set (missing => disabled). */
  function normalizeFeatures(raw) {
    if (!raw || typeof raw !== "object" || raw.enabled !== true) {
      return NO_PRIORITY;
    }
    const levels = Array.isArray(raw.levels) ? raw.levels.filter((l) => typeof l === "string") : [];
    return {
      enabled: true,
      editor: raw.editor === true,
      group: raw.group === true,
      sort: raw.sort === true,
      filter: raw.filter === true,
      cardIndicator: typeof raw.cardIndicator === "string" ? raw.cardIndicator : null,
      levels,
      labels: raw.labels && typeof raw.labels === "object" ? raw.labels : {},
      defaultValue: levels.includes(raw.defaultValue) ? raw.defaultValue : null,
    };
  }

  /** Restores the saved view from webview state, migrating the older `viewMode`. */
  function restoreView(saved) {
    const source = saved && typeof saved === "object" ? saved : {};
    const legacy = LEGACY_VIEW_MODES[source.viewMode];
    const groupBy = GROUP_BY.includes(source.groupBy) ? source.groupBy : legacy ? legacy.groupBy : DEFAULT_VIEW.groupBy;
    const sortBy = SORT_BY.includes(source.sortBy) ? source.sortBy : legacy ? legacy.sortBy : DEFAULT_VIEW.sortBy;
    const hidden = Array.isArray(source.hiddenPriorities) ? source.hiddenPriorities.filter((l) => typeof l === "string") : [];
    return { groupBy, sortBy, hiddenPriorities: [...new Set(hidden)] };
  }

  /** Collapsed-group keys are scoped ("status:done"); older bare status keys are migrated. */
  function restoreCollapsed(saved) {
    const result = {};
    if (!saved || typeof saved !== "object") {
      return result;
    }
    for (const key of Object.keys(saved)) {
      if (saved[key]) {
        result[STATUS_ORDER.includes(key) ? `status:${key}` : key] = true;
      }
    }
    return result;
  }

  function effectiveGroupBy(view, features) {
    return view.groupBy === "priority" && !features.group ? "none" : view.groupBy;
  }

  /** Why a sort option cannot apply right now, or null when it can. */
  function sortDisabledReason(sortKey, view, features) {
    if (sortKey === "priority" && !features.sort) {
      return "Priority system is disabled";
    }
    const groupBy = effectiveGroupBy(view, features);
    if (sortKey === groupBy) {
      return `Already grouped by ${GROUP_LABEL[groupBy].toLowerCase()}`;
    }
    return null;
  }

  function effectiveSortBy(view, features) {
    return sortDisabledReason(view.sortBy, view, features) ? "date" : view.sortBy;
  }

  function hiddenSet(view, features) {
    return new Set(features.filter ? view.hiddenPriorities.filter((l) => features.levels.includes(l)) : []);
  }

  function isFilterActive(view, features) {
    return hiddenSet(view, features).size > 0;
  }

  /** Applies the priority filter. Notes without a priority are never hidden by it. */
  function visibleItems(items, view, features) {
    const hidden = hiddenSet(view, features);
    if (hidden.size === 0) {
      return items;
    }
    return items.filter((it) => !it.priority || !hidden.has(it.priority));
  }

  function statusRank(item) {
    const index = STATUS_ORDER.indexOf(item.status);
    return index === -1 ? 0 : index;
  }

  /** Unassigned (or unknown) priorities rank after the lowest level. */
  function priorityRank(item, levels) {
    const index = item.priority ? levels.indexOf(item.priority) : -1;
    return index === -1 ? levels.length : index;
  }

  function timeOf(value) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }

  /** The comparator keys actually applied for the current view. */
  function sortChain(view, features) {
    const groupBy = effectiveGroupBy(view, features);
    return SORT_CHAINS[effectiveSortBy(view, features)].filter((key) => key !== groupBy && (key !== "priority" || features.sort));
  }

  /** Returns a new array; ties keep the incoming (file) order, so renders are stable. */
  function sortItems(items, view, features) {
    const chain = sortChain(view, features);
    const comparators = {
      date: (a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt),
      status: (a, b) => statusRank(a) - statusRank(b),
      priority: (a, b) => priorityRank(a, features.levels) - priorityRank(b, features.levels),
    };
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        for (const key of chain) {
          const result = comparators[key](a.item, b.item);
          if (result !== 0) {
            return result;
          }
        }
        return a.index - b.index;
      })
      .map((entry) => entry.item);
  }

  /**
   * Splits already-sorted items into groups, or returns null when not grouping.
   * Status groups and visible priority levels are always listed (even empty);
   * "Unassigned" only when it has notes, and hidden levels get no group.
   */
  function buildGroups(sortedItems, view, features, statusLabels) {
    const groupBy = effectiveGroupBy(view, features);
    if (groupBy === "status") {
      return STATUS_ORDER.map((status) => ({
        key: `status:${status}`,
        label: (statusLabels && statusLabels[status]) || status,
        level: null,
        items: sortedItems.filter((it) => STATUS_ORDER[statusRank(it)] === status),
      }));
    }
    if (groupBy === "priority") {
      const hidden = hiddenSet(view, features);
      const groups = features.levels
        .filter((level) => !hidden.has(level))
        .map((level) => ({
          key: `priority:${level}`,
          label: features.labels[level] || level,
          level,
          items: sortedItems.filter((it) => it.priority === level),
        }));
      const unassigned = sortedItems.filter((it) => priorityRank(it, features.levels) === features.levels.length);
      if (unassigned.length > 0) {
        groups.push({ key: "priority:none", label: UNASSIGNED_LABEL, level: null, items: unassigned });
      }
      return groups;
    }
    return null;
  }

  /** Text for the toolbar View button, e.g. "Status · Priority". */
  function triggerLabel(view, features) {
    const groupBy = effectiveGroupBy(view, features);
    const sortText = SORT_LABEL[effectiveSortBy(view, features)];
    return groupBy === "none" ? sortText : `${GROUP_LABEL[groupBy]} · ${sortText}`;
  }

  /** DropdownMenu entries for the View menu (see media/dropdown-menu.js). */
  function menuEntries(view, features) {
    const hidden = hiddenSet(view, features);
    return [
      {
        type: "radio-group",
        id: "groupBy",
        label: "Group by",
        value: effectiveGroupBy(view, features),
        items: GROUP_BY.map((key) => ({ value: key, text: GROUP_LABEL[key], hidden: key === "priority" && !features.group })),
      },
      { type: "separator" },
      {
        type: "radio-group",
        id: "sortBy",
        label: "Sort by",
        value: effectiveSortBy(view, features),
        items: SORT_BY.map((key) => {
          const reason = sortDisabledReason(key, view, features);
          return { value: key, text: SORT_LABEL[key], hidden: key === "priority" && !features.sort, disabled: reason !== null, hint: reason || undefined };
        }),
      },
      { type: "separator" },
      {
        type: "group",
        label: "Show priorities",
        hidden: !features.filter,
        items: features.levels.map((level) => ({
          type: "checkbox",
          id: `show:${level}`,
          text: features.labels[level] || level,
          checked: !hidden.has(level),
          markerClass: `prio-${level}`,
        })),
      },
      {
        type: "item",
        id: "show-all",
        text: "Show all priorities",
        icon: "codicon codicon-eye",
        hidden: !features.filter || hidden.size === 0,
      },
    ];
  }

  /**
   * Returns the next saved view for a DropdownMenu onSelect detail, or null
   * when the detail is not a View-menu action. Never mutates `view`.
   */
  function applySelection(view, detail) {
    if (!detail) {
      return null;
    }
    if (detail.kind === "radio" && detail.group === "groupBy" && GROUP_BY.includes(detail.value)) {
      return { ...view, groupBy: detail.value };
    }
    if (detail.kind === "radio" && detail.group === "sortBy" && SORT_BY.includes(detail.value)) {
      return { ...view, sortBy: detail.value };
    }
    if (detail.kind === "checkbox" && typeof detail.id === "string" && detail.id.startsWith("show:")) {
      const level = detail.id.slice("show:".length);
      const rest = view.hiddenPriorities.filter((l) => l !== level);
      return { ...view, hiddenPriorities: detail.checked ? rest : [...rest, level] };
    }
    if (detail.kind === "item" && detail.id === "show-all") {
      return { ...view, hiddenPriorities: [] };
    }
    return null;
  }

  return {
    DEFAULT_VIEW,
    NO_PRIORITY,
    UNASSIGNED_LABEL,
    normalizeFeatures,
    restoreView,
    restoreCollapsed,
    effectiveGroupBy,
    effectiveSortBy,
    sortDisabledReason,
    isFilterActive,
    visibleItems,
    sortChain,
    sortItems,
    buildGroups,
    triggerLabel,
    menuEntries,
    applySelection,
  };
})();

// Exposes the helpers to Node-based unit tests. This branch never runs in the
// real webview, where `module` is undefined.
if (typeof module !== "undefined" && module.exports) {
  module.exports = ViewOptions;
}
