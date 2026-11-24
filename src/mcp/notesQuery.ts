/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { MINDSTREAM_STATUSES, MindStreamItem, MindStreamLink, MindStreamLinkState, MindStreamPriority, MindStreamStatus, MindStreamWorkPauseNote } from "../models";
import { IStorage } from "../storage";
import { ItemsStore } from "../itemsStore";
import { TypesRegistry } from "../typesRegistry";
import { CategoriesRegistry } from "../categoriesRegistry";
import { WorkPauseStore } from "../workPauseStore";
import { LinkFiles, LinkTracker } from "../linkTracker";
import { PRIORITIES } from "../priority";
import { ERROR_CODES, noteNotFound } from "../domainError";
import { invalid } from "../noteInput";
import { CodeExcerpt, NoteDetail, NoteSummary, toCodeExcerpt, toNoteDetail, toNoteSummary } from "./noteView";

/** Notes returned when a caller gives no `limit`. */
export const DEFAULT_LIST_LIMIT = 50;
/** Most notes one call returns. */
export const MAX_LIST_LIMIT = 200;
/** Lines of context on each side of the linked code when a caller gives no `excerptLines`. */
export const DEFAULT_EXCERPT_CONTEXT = 3;
/** Most lines of context on each side that a caller can ask for. */
export const MAX_EXCERPT_CONTEXT = 20;

const LINK_STATES: readonly MindStreamLinkState[] = ["ok", "changed", "missing"];
const ARCHIVED_MODES = ["exclude", "include", "only"] as const;
const FILTER_FIELDS = ["status", "typeId", "categoryId", "priority", "archived", "hasLink", "linkState", "text", "limit", "offset"] as const;

export type ArchivedMode = (typeof ARCHIVED_MODES)[number];
export type PriorityFilter = MindStreamPriority | "none";

/** Raw input from any caller: every field is checked by `listNotes`. */
export interface ListNotesFilter {
  status?: unknown;
  typeId?: unknown;
  categoryId?: unknown;
  priority?: unknown;
  archived?: unknown;
  hasLink?: unknown;
  linkState?: unknown;
  text?: unknown;
  limit?: unknown;
  offset?: unknown;
}

export interface NoteListResult {
  notes: NoteSummary[];
  /** How many notes match, before `offset` and `limit`. */
  total: number;
  offset: number;
  limit: number;
}

export interface NoteWithExcerpt {
  note: NoteDetail;
  /** The linked lines with context; `null` when the note has no link, its file is missing, or the lines are gone. */
  excerpt: CodeExcerpt | null;
}

export interface TypeOverview {
  id: string;
  label: string;
  icon: string | null;
  /** Notes of this type, archived ones included. */
  noteCount: number;
}

export interface CategoryOverview {
  id: string;
  label: string;
  isDefault: boolean;
  defaultTypeId: string | null;
  /** Notes in this category, archived ones included. */
  noteCount: number;
}

export interface WorkPauseView {
  text: string;
  updatedAt: string;
  paused: boolean;
}

export interface ProjectSummary {
  /** Notes that are not archived, by status. */
  statusCounts: Record<MindStreamStatus, number>;
  /** Notes that are not archived, by priority; `none` counts the unassigned ones. */
  priorityCounts: Record<PriorityFilter, number>;
  archivedCount: number;
  /** Notes that are not archived and have a code link, by the link's stored state. */
  linkStateCounts: Record<MindStreamLinkState, number>;
  priorityEnabled: boolean;
  workPaused: boolean;
  /** Why saving is off (the reason and how to fix it), or `null` while the data file is usable. */
  storageProblem: string | null;
  /** Every code a refused write can carry. */
  errorCodes: string[];
}

export interface NotesQueryDeps {
  storage: IStorage;
  items: ItemsStore;
  types: TypesRegistry;
  categories: CategoriesRegistry;
  workPause: WorkPauseStore;
  /** Re-finds a note's code when its details are read. */
  links: LinkTracker;
  /** Reads workspace files for the code excerpt. */
  files: LinkFiles;
  /** True unless the `mindstream.priority.style` setting is "off". */
  priorityEnabled: () => boolean;
}

interface CleanFilter {
  status?: MindStreamStatus[];
  typeId?: string;
  categoryId?: string;
  priority?: PriorityFilter[];
  archived: ArchivedMode;
  hasLink?: boolean;
  linkState?: MindStreamLinkState[];
  text?: string;
  limit: number;
  offset: number;
}

/** A non-empty list of values taken from `allowed`, without repeats. */
function cleanChoices<T extends string>(raw: unknown, field: string, allowed: readonly T[]): T[] {
  const fix = `Use a list with some of: ${allowed.join(", ")}.`;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw invalid(`${field} must be a non-empty list`, fix);
  }
  const values: T[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !(allowed as readonly string[]).includes(entry)) {
      throw invalid(`"${String(entry)}" is not a valid value of ${field}`, fix);
    }
    if (!values.includes(entry as T)) {
      values.push(entry as T);
    }
  }
  return values;
}

function cleanId(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !raw) {
    throw invalid(`${field} must be an id`, `Send ${field} as an id from list_types_and_categories.`);
  }
  return raw;
}

function cleanInteger(raw: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(raw) || (raw as number) < min || (raw as number) > max) {
    throw invalid(`${field} must be a whole number from ${min} to ${max}`, `Send ${field} between ${min} and ${max}.`);
  }
  return raw as number;
}

function cleanArchived(raw: unknown): ArchivedMode {
  if (typeof raw !== "string" || !(ARCHIVED_MODES as readonly string[]).includes(raw)) {
    throw invalid(`"${String(raw)}" is not a valid value of archived`, `Use one of: ${ARCHIVED_MODES.join(", ")}.`);
  }
  return raw as ArchivedMode;
}

function cleanFilter(raw: unknown): CleanFilter {
  if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
    throw invalid("the filter must be an object", "Send the filter fields as an object, or nothing to list every note.");
  }
  const input = (raw ?? {}) as Record<string, unknown>;
  const unknownFields = Object.keys(input).filter((key) => !(FILTER_FIELDS as readonly string[]).includes(key));
  if (unknownFields.length) {
    throw invalid(`the filter has unknown fields: ${unknownFields.join(", ")}`, `Use only: ${FILTER_FIELDS.join(", ")}.`);
  }
  const clean: CleanFilter = { archived: "exclude", limit: DEFAULT_LIST_LIMIT, offset: 0 };
  if (input.status !== undefined) {
    clean.status = cleanChoices(input.status, "status", MINDSTREAM_STATUSES);
  }
  if (input.typeId !== undefined) {
    clean.typeId = cleanId(input.typeId, "typeId");
  }
  if (input.categoryId !== undefined) {
    clean.categoryId = cleanId(input.categoryId, "categoryId");
  }
  if (input.priority !== undefined) {
    clean.priority = cleanChoices<PriorityFilter>(input.priority, "priority", [...PRIORITIES, "none"]);
  }
  if (input.archived !== undefined) {
    clean.archived = cleanArchived(input.archived);
  }
  if (input.hasLink !== undefined) {
    if (typeof input.hasLink !== "boolean") {
      throw invalid("hasLink must be true or false", "Send true for notes with a code link, false for notes without one.");
    }
    clean.hasLink = input.hasLink;
  }
  if (input.linkState !== undefined) {
    clean.linkState = cleanChoices(input.linkState, "linkState", LINK_STATES);
  }
  if (input.text !== undefined) {
    if (typeof input.text !== "string" || !input.text.trim()) {
      throw invalid("text must be a non-empty string", "Send the words to look for, or leave text out.");
    }
    clean.text = input.text.trim().toLocaleLowerCase();
  }
  if (input.limit !== undefined) {
    clean.limit = cleanInteger(input.limit, "limit", 1, MAX_LIST_LIMIT);
  }
  if (input.offset !== undefined) {
    clean.offset = cleanInteger(input.offset, "offset", 0, Number.MAX_SAFE_INTEGER);
  }
  return clean;
}

/** Position of a priority in the sort order: critical first, unassigned last. */
function priorityRank(priority: MindStreamPriority | undefined): number {
  return priority ? PRIORITIES.indexOf(priority) : PRIORITIES.length;
}

/**
 * Everything an agent reads, as plain functions: no `vscode`, no MCP SDK. Reads
 * never refuse because work is paused or saving is off: they only look at the
 * data (after picking up a change made outside this instance).
 */
export class NotesQuery {
  constructor(private readonly deps: NotesQueryDeps) {}

  private refresh(): void {
    this.deps.storage.reloadIfExternal();
  }

  /** A stored note as an agent sees it. Does not re-find the link or read the file (`getNote` does). */
  noteDetailOf(note: MindStreamItem): NoteDetail {
    return toNoteDetail(note, this.deps.types, this.deps.categories);
  }

  /** Notes matching the filter, most important first (priority, then the latest change). */
  listNotes(filter?: ListNotesFilter): NoteListResult {
    const f = cleanFilter(filter);
    this.refresh();
    const { items, types, categories } = this.deps;
    const matching = items
      .list(true)
      .filter((note) => {
        if (f.archived === "exclude" && note.archived) {
          return false;
        }
        if (f.archived === "only" && !note.archived) {
          return false;
        }
        if (f.status && !f.status.includes(note.status)) {
          return false;
        }
        if (f.typeId !== undefined && note.typeId !== f.typeId) {
          return false;
        }
        if (f.categoryId !== undefined && note.categoryId !== f.categoryId) {
          return false;
        }
        if (f.priority && !f.priority.includes(note.priority ?? "none")) {
          return false;
        }
        if (f.hasLink !== undefined && Boolean(note.link) !== f.hasLink) {
          return false;
        }
        if (f.linkState && (!note.link || !f.linkState.includes(note.link.state))) {
          return false;
        }
        if (f.text !== undefined) {
          const haystack = [note.title, note.description ?? "", ...(note.tasks ?? []).map((t) => t.title)].join("\n").toLocaleLowerCase();
          if (!haystack.includes(f.text)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.updatedAt.localeCompare(a.updatedAt));
    return {
      notes: matching.slice(f.offset, f.offset + f.limit).map((note) => toNoteSummary(note, types, categories)),
      total: matching.length,
      offset: f.offset,
      limit: f.limit,
    };
  }

  /**
   * One note in full, with its code link re-found first (a moved link is
   * stored silently, as when the user opens it) and an excerpt of the linked
   * code. An unknown id is refused with `NOT_FOUND`.
   */
  async getNote(id: unknown, options: { excerptLines?: unknown } = {}): Promise<NoteWithExcerpt> {
    const context = options.excerptLines === undefined ? DEFAULT_EXCERPT_CONTEXT : cleanInteger(options.excerptLines, "excerptLines", 0, MAX_EXCERPT_CONTEXT);
    this.refresh();
    const { items, types, categories, links, files } = this.deps;
    const found = typeof id === "string" ? items.get(id) : undefined;
    if (!found) {
      throw noteNotFound(id);
    }
    if (found.link) {
      await links.resolveItem(found.id);
    }
    const note = items.get(found.id) ?? found;
    const link: MindStreamLink | undefined = note.link;
    let excerpt: CodeExcerpt | null = null;
    if (link && link.state !== "missing") {
      const lines = await files.readLines(link.filePath);
      excerpt = lines ? toCodeExcerpt(lines, link, context) : null;
    }
    return { note: toNoteDetail(note, types, categories, link), excerpt };
  }

  listTypesAndCategories(): { types: TypeOverview[]; categories: CategoryOverview[] } {
    this.refresh();
    const { types, categories } = this.deps;
    return {
      types: types.list().map((t) => ({ id: t.id, label: t.label, icon: t.icon ?? null, noteCount: types.countItems(t.id) })),
      categories: categories.list().map((c) => ({
        id: c.id,
        label: c.label,
        isDefault: c.isDefault === true,
        defaultTypeId: c.defaultTypeId ?? null,
        noteCount: categories.countItems(c.id),
      })),
    };
  }

  /** The user's own Work Pause note; readable while work is paused. A never-saved note reads as empty. */
  getWorkPauseNote(): WorkPauseView {
    this.refresh();
    const note: MindStreamWorkPauseNote = this.deps.workPause.get();
    return { text: note.text, updatedAt: note.updatedAt, paused: note.paused };
  }

  projectSummary(): ProjectSummary {
    this.refresh();
    const { items, storage, workPause, priorityEnabled } = this.deps;
    const statusCounts = Object.fromEntries(MINDSTREAM_STATUSES.map((s) => [s, 0])) as Record<MindStreamStatus, number>;
    const priorityCounts = Object.fromEntries([...PRIORITIES, "none"].map((p) => [p, 0])) as Record<PriorityFilter, number>;
    const linkStateCounts = Object.fromEntries(LINK_STATES.map((s) => [s, 0])) as Record<MindStreamLinkState, number>;
    let archivedCount = 0;
    for (const note of items.list(true)) {
      if (note.archived) {
        archivedCount += 1;
        continue;
      }
      statusCounts[note.status] += 1;
      priorityCounts[note.priority ?? "none"] += 1;
      if (note.link) {
        linkStateCounts[note.link.state] += 1;
      }
    }
    const problem = storage.getProblem();
    return {
      statusCounts,
      priorityCounts,
      archivedCount,
      linkStateCounts,
      priorityEnabled: priorityEnabled(),
      workPaused: workPause.isPaused(),
      storageProblem: problem ? `${problem.message} ${problem.howToFix}` : null,
      errorCodes: [...ERROR_CODES],
    };
  }
}
