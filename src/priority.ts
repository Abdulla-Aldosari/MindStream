/**
 * Note priority: levels, the default for new notes, and the user setting that
 * selects how (and whether) priority is shown. Pure module (no `vscode`), so
 * it is unit-tested directly; `sidebarProvider.ts` reads the setting and
 * forwards `priorityFeatures()` to the webview.
 */

import { MindStreamPriority } from "./models";

/** Every priority level, highest first. Also the sort order. */
export const PRIORITIES: readonly MindStreamPriority[] = ["critical", "high", "medium", "low"];

/** Priority pre-selected in the editor for new notes while the system is enabled. */
export const DEFAULT_PRIORITY: MindStreamPriority = "low";

/** Display labels for each level. */
export const PRIORITY_LABEL: Record<MindStreamPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function isPriority(value: unknown): value is MindStreamPriority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);
}

/** Values of the `mindstream.priority.style` setting; "off" disables the whole system. */
export type PriorityStyle = "dot" | "stripe" | "chip" | "typeStripe" | "off";

export const PRIORITY_STYLES: readonly PriorityStyle[] = ["dot", "stripe", "chip", "typeStripe", "off"];

export const DEFAULT_PRIORITY_STYLE: PriorityStyle = "chip";

/** Coerces any raw setting value into a valid style, falling back to the default. */
export function normalizePriorityStyle(value: unknown): PriorityStyle {
  return typeof value === "string" && (PRIORITY_STYLES as readonly string[]).includes(value) ? (value as PriorityStyle) : DEFAULT_PRIORITY_STYLE;
}

/** Card indicator styles; every style except "off". */
export type PriorityCardIndicator = Exclude<PriorityStyle, "off">;

/**
 * Feature switches derived from the style. The webview checks these flags
 * (never the style string) so each part of the system can be turned off on
 * its own without touching the others.
 */
export interface PriorityFeatures {
  enabled: boolean;
  /** Show the priority control in the note editor. */
  editor: boolean;
  /** Offer "Group by priority" in the View menu. */
  group: boolean;
  /** Offer "Sort by priority" in the View menu (and in the status sort chain). */
  sort: boolean;
  /** Offer the per-level show/hide filter in the View menu. */
  filter: boolean;
  /** How a note's priority is drawn on its card; null draws nothing. */
  cardIndicator: PriorityCardIndicator | null;
}

export function priorityFeatures(style: PriorityStyle): PriorityFeatures {
  const enabled = style !== "off";
  return {
    enabled,
    editor: enabled,
    group: enabled,
    sort: enabled,
    filter: enabled,
    cardIndicator: style === "off" ? null : style,
  };
}
