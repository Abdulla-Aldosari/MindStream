/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { DomainError, errorCodeOf } from "../domainError";
import { MindStreamItem } from "../models";
import { NotesQuery } from "./notesQuery";
import { ToolFailure } from "./mcpTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The stored value a refusal carries, shaped for an agent. Only the two known
 * shapes are passed on, never a raw object: a note (`CONFLICT`) and an existing
 * type or category (`DUPLICATE`). No tool writes the Work Pause note, so its
 * value is never passed on.
 */
function shapeCurrent(current: unknown, query: NotesQuery): unknown {
  if (!isRecord(current)) {
    return undefined;
  }
  if (typeof current.id === "string" && typeof current.typeId === "string") {
    return query.noteDetailOf(current as unknown as MindStreamItem);
  }
  if (typeof current.id === "string" && typeof current.label === "string") {
    return { id: current.id, label: current.label };
  }
  return undefined;
}

/**
 * Turns a refusal into the result an agent receives: the stable code, the
 * complete message, and the current value when the refusal carries one. Any
 * other error is rethrown, so a bug is never reported as a refusal.
 */
export function toToolError(err: unknown, query: NotesQuery): ToolFailure {
  const code = errorCodeOf(err);
  if (!code) {
    throw err;
  }
  const failure: ToolFailure = { ok: false, code, message: (err as Error).message };
  const current = err instanceof DomainError ? shapeCurrent(err.current, query) : undefined;
  if (current !== undefined) {
    failure.current = current;
  }
  return failure;
}
