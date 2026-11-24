/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { MINDSTREAM_STATUSES, MindStreamItem, MindStreamStatus, MindStreamTask, isStatus } from "./models";
import { isPriority } from "./priority";
import { MAX_TASK_TITLE, sanitizeTasks } from "./tasks";
import { DomainError, refusal } from "./domainError";

/**
 * Pure checks for input that reaches `NotesService` from any caller (the
 * webview, a command, an automated caller). Every value is `unknown` until a
 * check accepts it; a refused value throws `INVALID_INPUT` and is never cut or
 * guessed, so a caller never mistakes a changed value for what it sent.
 */

/** Longest note title, in characters (a title is one line). */
export const MAX_NOTE_TITLE = 300;
/** Longest note description, in characters. */
export const MAX_NOTE_DESCRIPTION = 50000;
/** Longest type or category name, in characters. */
export const MAX_LABEL = 80;
/** Most tasks one note can hold. */
export const MAX_TASKS = 200;
const MAX_ICON = 60;

/** The note fields a caller can edit. The code link is never one of them. */
export const NOTE_FIELDS = ["title", "description", "typeId", "categoryId", "priority", "tasks"] as const;
export type NoteField = (typeof NOTE_FIELDS)[number];

/** How a field is named in a message to the user. */
export const FIELD_LABEL: Record<NoteField, string> = {
  title: "title",
  description: "description",
  typeId: "type",
  categoryId: "category",
  priority: "priority",
  tasks: "tasks",
};

export function invalid(reason: string, fix: string): DomainError {
  return new DomainError("INVALID_INPUT", refusal(reason, fix));
}

function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

export function cleanTitle(raw: unknown): string {
  if (typeof raw !== "string") {
    throw invalid("the title must be text", "Send the title as a string.");
  }
  const title = oneLine(raw);
  if (!title) {
    throw invalid("the title is empty", "Give the note a title.");
  }
  if (title.length > MAX_NOTE_TITLE) {
    throw invalid(`the title is longer than ${MAX_NOTE_TITLE} characters`, "Shorten the title and put the details in the description.");
  }
  return title;
}

export function cleanDescription(raw: unknown): string {
  if (typeof raw !== "string") {
    throw invalid("the description must be text", "Send the description as a string.");
  }
  if (raw.length > MAX_NOTE_DESCRIPTION) {
    throw invalid(`the description is longer than ${MAX_NOTE_DESCRIPTION} characters`, "Shorten the description.");
  }
  return raw;
}

/** Drops blank and malformed entries (as `sanitizeTasks` does), but refuses a list or a title that is too long instead of cutting it. */
export function cleanTasks(raw: unknown): MindStreamTask[] {
  if (!Array.isArray(raw)) {
    throw invalid("the tasks must be a list", 'Send the tasks as a list of { "title": text, "completed": true or false }.');
  }
  if (raw.length > MAX_TASKS) {
    throw invalid(`a note can hold at most ${MAX_TASKS} tasks`, "Split the work into several notes.");
  }
  for (const entry of raw) {
    const title = entry && typeof entry === "object" ? (entry as { title?: unknown }).title : undefined;
    if (typeof title === "string" && oneLine(title).length > MAX_TASK_TITLE) {
      throw invalid(`a task title is longer than ${MAX_TASK_TITLE} characters`, "Shorten the task title.");
    }
  }
  return sanitizeTasks(raw) ?? [];
}

export function cleanStatus(raw: unknown): MindStreamStatus {
  if (!isStatus(raw)) {
    throw invalid(`"${String(raw)}" is not a note status`, `Use one of: ${MINDSTREAM_STATUSES.join(", ")}.`);
  }
  return raw;
}

/** A type or category name: one line, inner spaces folded. */
export function cleanLabel(raw: unknown, what: "category" | "type"): string {
  if (typeof raw !== "string") {
    throw invalid(`the ${what} name must be text`, `Send the ${what} name as a string.`);
  }
  const label = raw.replace(/\s+/g, " ").trim();
  if (!label) {
    throw invalid(`the ${what} name is empty`, `Give the ${what} a name.`);
  }
  if (label.length > MAX_LABEL) {
    throw invalid(`the ${what} name is longer than ${MAX_LABEL} characters`, `Use a shorter ${what} name.`);
  }
  return label;
}

/** A codicon name, the same rule the webview applies when it draws one (`iconClass`). */
export function cleanIcon(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > MAX_ICON || !/^[a-zA-Z0-9-]+$/.test(raw)) {
    throw invalid(`"${String(raw)}" is not an icon name`, 'Use a codicon name made of letters, digits and dashes, such as "bug" or "lightbulb".');
  }
  return raw;
}

/** A field's stored value, with an absent value read as empty. */
export function storedValue(note: MindStreamItem, field: NoteField): unknown {
  switch (field) {
    case "description":
      return note.description ?? "";
    case "priority":
      return note.priority ?? null;
    case "tasks":
      return note.tasks ?? [];
    default:
      return note[field];
  }
}

/** A field as it compares: line endings, the title's outer spaces, blank tasks, and an absent value are not differences. */
function comparable(field: NoteField, value: unknown): unknown {
  switch (field) {
    case "title":
      return typeof value === "string" ? value.trim() : "";
    case "description":
      return typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
    case "priority":
      return isPriority(value) ? value : null;
    case "tasks":
      return Array.isArray(value)
        ? value
            .filter((t) => t && typeof t === "object" && typeof t.title === "string" && t.title.trim() !== "")
            .map((t: { title: string; completed?: unknown }) => ({ title: t.title.trim(), completed: t.completed === true }))
        : [];
    default:
      return typeof value === "string" ? value : null;
  }
}

/** True when two values of a field are the same for the user. */
export function sameFieldValue(field: NoteField, a: unknown, b: unknown): boolean {
  return JSON.stringify(comparable(field, a)) === JSON.stringify(comparable(field, b));
}

/** The fields listed in `base` whose stored value differs from it now. */
export function changedSince(note: MindStreamItem, base: Partial<Record<NoteField, unknown>>): NoteField[] {
  return NOTE_FIELDS.filter((field) => field in base && !sameFieldValue(field, base[field], storedValue(note, field)));
}
