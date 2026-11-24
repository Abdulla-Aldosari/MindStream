/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

/**
 * Core data models for the MindStream extension.
 */

/** Every note status, in display order. "done" and "canceled" are final outcomes. */
export const MINDSTREAM_STATUSES = ["pending", "in-progress", "done", "canceled"] as const;

export type MindStreamStatus = (typeof MINDSTREAM_STATUSES)[number];

/** Guards values from untrusted callers (the webview, an imported or hand-edited file). */
export function isStatus(value: unknown): value is MindStreamStatus {
  return typeof value === "string" && (MINDSTREAM_STATUSES as readonly string[]).includes(value);
}

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

/** One step of a task group note. Its order is its index in `MindStreamItem.tasks`. */
export interface MindStreamTask {
  title: string;
  completed: boolean;
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
  /** Time of the last transition to "done". Absent while the status is not "done". */
  completedAt?: string;
  /**
   * Time of the last transition to "canceled" (the work was dropped and will
   * not be done; the note is kept for reference). Absent while the status is
   * not "canceled".
   */
  canceledAt?: string;
  /** Archiving is fully independent of status — it never changes `status`. */
  archived: boolean;
  archivedAt?: string;
  tags?: string[];
  link?: MindStreamLink;
  /**
   * Ordered checklist (order = index). A note with at least one task is a
   * "task group". The key is absent when there are no tasks, never `[]`.
   */
  tasks?: MindStreamTask[];
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

/**
 * The single "Work Pause" note: the user's own note, written before stepping
 * away from the project for a long time. While `paused` is true the whole UI
 * is locked and shows only this note. Only the user writes it, never an agent.
 * It lives beside the notes, never inside `items`.
 */
export interface MindStreamWorkPauseNote {
  text: string;
  /** ISO time of the last text change ("" until the first save). */
  updatedAt: string;
  paused: boolean;
}

/** The full structure of the persisted file. */
export interface MindStreamData {
  version: number;
  types: MindStreamTypeDef[];
  categories: MindStreamCategoryDef[];
  items: MindStreamItem[];
  /** Absent until the Work Pause note is first saved. */
  workPauseNote?: MindStreamWorkPauseNote;
}

export const DATA_VERSION = 1;

/** Fixed id of the built-in "General" category. */
export const GENERAL_CATEGORY_ID = "general";
