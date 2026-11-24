/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { MindStreamItem, MindStreamLink, MindStreamLinkState, MindStreamPriority, MindStreamStatus } from "../models";

/**
 * Pure shaping of notes for an agent: ids and labels side by side (the agent
 * addresses by id and reads the labels), plain data only. The anchor text of a
 * link is internal and never leaves this module.
 */

/** Anything that turns a type or category id into its label (`TypesRegistry`, `CategoriesRegistry`). */
export interface LabelLookup {
  label(id: string): string;
}

export interface EntryRef {
  id: string;
  label: string;
}

/** What a summary and a detail share. */
export interface NoteBase {
  id: string;
  title: string;
  status: MindStreamStatus;
  /** `null` when the note has no priority (unassigned). */
  priority: MindStreamPriority | null;
  type: EntryRef;
  category: EntryRef;
  archived: boolean;
  /** The stored state of the note's code link; `null` when it has no link. */
  linkState: MindStreamLinkState | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  canceledAt?: string;
}

export interface NoteSummary extends NoteBase {
  /** Present only when the note has tasks. */
  tasks?: { done: number; total: number };
}

export interface NoteTaskView {
  /** 0-based position, the value `set_task_completed` takes. */
  index: number;
  title: string;
  completed: boolean;
}

export interface NoteLinkView {
  filePath: string;
  lineStart: number;
  /** Equal to `lineStart` for a single line. */
  lineEnd: number;
  state: MindStreamLinkState;
}

export interface NoteDetail extends NoteBase {
  description: string;
  tasks: NoteTaskView[];
  link: NoteLinkView | null;
}

export interface ExcerptLine {
  /** 1-based line number in the file. */
  line: number;
  text: string;
}

export interface CodeExcerpt {
  lines: ExcerptLine[];
  /** True when more lines than `MAX_EXCERPT_LINES` were requested and the rest was left out. */
  truncated: boolean;
}

/** Most lines one excerpt carries. */
export const MAX_EXCERPT_LINES = 200;
/** Longest line of an excerpt, in characters. */
export const MAX_EXCERPT_LINE_CHARS = 2000;

function ref(id: string, lookup: LabelLookup): EntryRef {
  return { id, label: lookup.label(id) };
}

function toNoteBase(item: MindStreamItem, types: LabelLookup, categories: LabelLookup): NoteBase {
  const base: NoteBase = {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority ?? null,
    type: ref(item.typeId, types),
    category: ref(item.categoryId, categories),
    archived: item.archived === true,
    linkState: item.link?.state ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
  if (item.completedAt) {
    base.completedAt = item.completedAt;
  }
  if (item.canceledAt) {
    base.canceledAt = item.canceledAt;
  }
  return base;
}

export function toNoteSummary(item: MindStreamItem, types: LabelLookup, categories: LabelLookup): NoteSummary {
  const summary: NoteSummary = toNoteBase(item, types, categories);
  if (item.tasks?.length) {
    summary.tasks = { done: item.tasks.filter((t) => t.completed).length, total: item.tasks.length };
  }
  return summary;
}

function toLinkView(link: MindStreamLink): NoteLinkView {
  return { filePath: link.filePath, lineStart: link.lineStart, lineEnd: link.lineEnd ?? link.lineStart, state: link.state };
}

/** `link` is the note's link as resolved just now; it defaults to the stored one. */
export function toNoteDetail(item: MindStreamItem, types: LabelLookup, categories: LabelLookup, link: MindStreamLink | undefined = item.link): NoteDetail {
  return {
    ...toNoteBase(item, types, categories),
    linkState: link?.state ?? null,
    description: item.description ?? "",
    tasks: (item.tasks ?? []).map((t, index) => ({ index, title: t.title, completed: t.completed })),
    link: link ? toLinkView(link) : null,
  };
}

/**
 * The linked lines plus `context` lines on each side, with 1-based numbers.
 * Returns `null` when the link points past the end of the file. At most
 * `MAX_EXCERPT_LINES` lines are returned, each cut to `MAX_EXCERPT_LINE_CHARS`.
 */
export function toCodeExcerpt(fileLines: readonly string[], link: MindStreamLink, context: number): CodeExcerpt | null {
  const start = Math.max(1, link.lineStart - context);
  const wantedEnd = Math.min(fileLines.length, (link.lineEnd ?? link.lineStart) + context);
  if (start > wantedEnd) {
    return null;
  }
  const truncated = wantedEnd - start + 1 > MAX_EXCERPT_LINES;
  const end = truncated ? start + MAX_EXCERPT_LINES - 1 : wantedEnd;
  const lines: ExcerptLine[] = [];
  for (let line = start; line <= end; line++) {
    lines.push({ line, text: fileLines[line - 1].slice(0, MAX_EXCERPT_LINE_CHARS) });
  }
  return { lines, truncated };
}
