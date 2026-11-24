/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

/**
 * Refusals raised by `NotesService`. The storage (`StorageError`) and archived
 * notes (`ArchivedNoteError`) carry their own codes; together they form the
 * stable list in `ERROR_CODES`, the same for the sidebar and automated callers.
 * Every message is complete and safe to show as is: the reason, that nothing
 * was changed, and how to resolve it.
 */

export type DomainErrorCode = "WORK_PAUSED" | "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT" | "DUPLICATE" | "LINK_INVALID";

/** Every code a refused MindStream write can carry. */
export const ERROR_CODES = ["WORK_PAUSED", "STORAGE_BLOCKED", "WRITE_FAILED", "NOT_FOUND", "INVALID_INPUT", "CONFLICT", "DUPLICATE", "LINK_INVALID", "NOTE_ARCHIVED"] as const;

export type MindStreamErrorCode = (typeof ERROR_CODES)[number];

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    /** `CONFLICT`: the stored value as it is now, so the caller can redo its change on it. `DUPLICATE`: the existing entry. */
    readonly current?: unknown
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/** The MindStream code of a refusal, or `undefined` for any other error. */
export function errorCodeOf(err: unknown): MindStreamErrorCode | undefined {
  const code = err instanceof Error ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" && (ERROR_CODES as readonly string[]).includes(code) ? (code as MindStreamErrorCode) : undefined;
}

/** Builds a refusal message: `Not saved: <reason>. Nothing was changed. <fix>` (`reason` has no final period). */
export function refusal(reason: string, fix: string): string {
  return `Not saved: ${reason}. Nothing was changed. ${fix}`;
}

/** The refusal for a note id that does not exist (any more). Shared by the service's lookup and the read layer. */
export function noteNotFound(id: unknown): DomainError {
  return new DomainError("NOT_FOUND", refusal(`the note no longer exists (id "${String(id)}")`, "It may have been deleted elsewhere. Refresh the list and use a current note."));
}

/** Refuses every write while work is paused; only the user can resume. */
export const WORK_PAUSED_MESSAGE = refusal(
  "work is paused in MindStream, and nothing can be changed while it is paused",
  `Only the user can resume work, in the MindStream sidebar: "Resume work" on the note, or "✓ Work paused - click to resume" in the More menu.`
);
