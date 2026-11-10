/**
 * Core data models for the MindStream extension.
 */

export type MindStreamStatus = "pending" | "in-progress" | "done";

/** Note priority levels, highest first. Constants and helpers live in `priority.ts`. */
export type MindStreamPriority = "critical" | "high" | "medium" | "low";

/**
 * Snapshot of the linked code, used to re-find it after the file changes.
 * Every string is trimmed and length-capped (see `normalizeLine` in `linkResolver.ts`).
 */
export interface MindStreamLinkAnchor {
  /** The first lines of the linked range (at most `MAX_ANCHOR_LINES`). */
  text: string[];
  /**
   * The last lines of the range, stored only when it is longer than
   * `MAX_ANCHOR_LINES`. It lets the end of the range be re-found too.
   */
  endText?: string[];
  /** The line right before the range ("" at the start of the file). */
  before: string;
  /** The line right after the range ("" at the end of the file). */
  after: string;
}

/**
 * - `ok`: the location was found where it was recorded (or relocated).
 * - `changed`: the file exists but the recorded code could not be found.
 * - `missing`: the file no longer exists at `filePath`.
 */
export type MindStreamLinkState = "ok" | "changed" | "missing";

/**
 * Link from a note to a code location. Created only by the editor context
 * menu command; it is never editable from the note editor.
 */
export interface MindStreamLink {
  /** Path relative to the workspace folder, always with `/` separators. */
  filePath: string;
  /** 1-based first line of the linked range. */
  lineStart: number;
  /** 1-based last line of the range; absent for a single line. */
  lineEnd?: number;
  anchor?: MindStreamLinkAnchor;
  state: MindStreamLinkState;
}

/** A single entry in the notes roadmap. */
export interface MindStreamItem {
  id: string;
  /** References an id in types[] rather than the display label (so renaming stays safe). */
  typeId: string;
  /** References an id in categories[] (a fixed "general" category is always available). */
  categoryId: string;
  title: string;
  description?: string;
  status: MindStreamStatus;
  /**
   * Absent on notes created while the priority system was disabled (or before
   * it existed). The key is only written once a priority is chosen, so an
   * absent key always means "unassigned", never an implicit default.
   */
  priority?: MindStreamPriority;
  /** Append-only history of all status changes; preserves the completion sequence. */
  statusHistory: { status: MindStreamStatus; at: string }[];
  /** Archiving is fully independent of status — it never changes `status`. */
  archived: boolean;
  archivedAt?: string;
  tags?: string[];
  link?: MindStreamLink;
  createdAt: string;
  updatedAt: string;
}

/** A fully user-customizable type definition. */
export interface MindStreamTypeDef {
  id: string;
  label: string;
  icon?: string;
  color?: string;
  order?: number;
  createdAt: string;
}

/** A user-defined category (e.g. "Before Release"). */
export interface MindStreamCategoryDef {
  id: string;
  label: string;
  /** true only for the built-in "General" category. */
  isDefault?: boolean;
  /**
   * Optional id of the type pre-selected when adding a note to this category.
   * When absent (or pointing at a deleted type), the form falls back to the
   * first registered type ("General" by convention).
   */
  defaultTypeId?: string;
  order?: number;
  createdAt: string;
}

/** The full structure of the persisted file. */
export interface MindStreamData {
  version: number;
  types: MindStreamTypeDef[];
  categories: MindStreamCategoryDef[];
  items: MindStreamItem[];
}

export const DATA_VERSION = 1;

/** Fixed id of the built-in "General" category. */
export const GENERAL_CATEGORY_ID = "general";
