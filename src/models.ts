/**
 * Core data models for the MindStream extension.
 */

export type MindStreamStatus = 'pending' | 'in-progress' | 'done';

/** Optional link to a specific code/file location — future design, not used in the UI yet. */
export interface MindStreamLink {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  gitCommit?: string;
}

/** A single entry in the notes roadmap. */
export interface MindStreamItem {
  id: string;
  /** References an id in types[] rather than the display label (so renaming stays safe). */
  typeId: string;
  title: string;
  description?: string;
  status: MindStreamStatus;
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

/** The full structure of the persisted file. */
export interface MindStreamData {
  version: number;
  types: MindStreamTypeDef[];
  items: MindStreamItem[];
}

export const DATA_VERSION = 1;
