/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import {
  GENERAL_CATEGORY_ID,
  MindStreamCategoryDef,
  MindStreamItem,
  MindStreamLink,
  MindStreamPriority,
  MindStreamStatus,
  MindStreamTypeDef,
  MindStreamWorkPauseNote,
} from "./models";
import { IStorage, StorageError, blockedSaveMessage } from "./storage";
import { ArchivedNoteError, ItemsStore, UpdateItemInput } from "./itemsStore";
import { TypesRegistry } from "./typesRegistry";
import { CategoriesRegistry } from "./categoriesRegistry";
import { WorkPauseStore } from "./workPauseStore";
import { LinkFiles, LinkTracker } from "./linkTracker";
import { DEFAULT_PRIORITY, PRIORITIES, isPriority } from "./priority";
import { MAX_WORK_PAUSE_TEXT } from "./workPause";
import { buildLinkAt, isSafeRelativePath, sanitizeLink } from "./linkResolver";
import { DomainError, WORK_PAUSED_MESSAGE, noteNotFound, refusal } from "./domainError";
import { FIELD_LABEL, NOTE_FIELDS, NoteField, changedSince, cleanDescription, cleanIcon, cleanLabel, cleanStatus, cleanTasks, cleanTitle, invalid, storedValue } from "./noteInput";

/** Raw input from any caller: every value is checked by the service. */
export interface NewNoteInput {
  title: unknown;
  description?: unknown;
  /** Omitted: the category's default type, else the first type. */
  typeId?: unknown;
  /** Omitted: the built-in "General" category. */
  categoryId?: unknown;
  /** Omitted: the default level while priority is on; never written while it is off. */
  priority?: unknown;
  /** Omitted: "pending". */
  status?: unknown;
  tasks?: unknown;
}

/** An omitted field is left untouched. */
export interface NotePatch {
  title?: unknown;
  /** Replaces the whole description (needs a base, see `UpdateGuard`). */
  description?: unknown;
  /** Adds a paragraph at the end of the description. Needs no base: it cannot overwrite anything. */
  appendDescription?: unknown;
  typeId?: unknown;
  categoryId?: unknown;
  priority?: unknown;
  /** Replaces the whole task list (`[]` clears it; needs a base, see `UpdateGuard`). */
  tasks?: unknown;
}

/**
 * What an update is based on. A caller that replaces content it read earlier
 * says which version it read; a change made elsewhere in the meantime then
 * refuses the update with `CONFLICT` instead of being overwritten.
 */
export interface UpdateGuard {
  /** The fields as the caller saw them (a note form opened earlier). Only a listed field that changed since refuses. */
  base?: Partial<Record<NoteField, unknown>>;
  /** The note's `updatedAt` as the caller read it. Any change since refuses. */
  expectedUpdatedAt?: unknown;
}

export interface FieldChange {
  field: NoteField;
  before: unknown;
  after: unknown;
}

export interface NoteUpdateResult {
  note: MindStreamItem;
  /** Empty when the note already had these values (nothing was written). */
  changes: FieldChange[];
}

export interface CodeLocation {
  /** Relative to the workspace folder, with `/` separators. */
  filePath: unknown;
  /** 1-based. */
  lineStart: unknown;
  /** 1-based; omitted for a single line. */
  lineEnd?: unknown;
}

/**
 * The Work Pause note is the user's own note for a long absence: only the
 * sidebar's note panel writes it. No automated caller (MCP tool) writes it.
 */
export interface WorkPauseSaveOptions {
  /** Also pause work once saved. Pausing is the user's decision. */
  pause?: boolean;
  /** The text as the user saw it when they started editing. */
  base?: unknown;
  /** Lets the user edit the note while work is paused (the sidebar's note panel is all that is open then). */
  userEditWhilePaused?: boolean;
}

export interface NotesServiceDeps {
  storage: IStorage;
  items: ItemsStore;
  types: TypesRegistry;
  categories: CategoriesRegistry;
  workPause: WorkPauseStore;
  /** Re-finds a note's code when it is unarchived. */
  links: LinkTracker;
  /** Reads workspace files to build a code link from a location. */
  files: LinkFiles;
  /** True unless the `mindstream.priority.style` setting is "off". */
  priorityEnabled: () => boolean;
}

/**
 * The single entry point for every change to notes, types, categories, and
 * the Work Pause note, whoever asks for it: the sidebar, a command, or an
 * automated caller (the Work Pause note only from the user's sidebar panel).
 * No `vscode` import, so the same rules run in unit tests.
 *
 * Every write, in this order:
 * 1. picks up a change made outside this instance (`reloadIfExternal`);
 * 2. refuses while work is paused (`WORK_PAUSED`) or saving is off (`STORAGE_BLOCKED`);
 * 3. checks ids (`NOT_FOUND`), archived notes (`NOTE_ARCHIVED`), and input
 *    (`INVALID_INPUT`, `DUPLICATE`, `LINK_INVALID`);
 * 4. refuses content that changed since the caller read it (`CONFLICT`);
 * 5. writes once, then tells the `onDidChange` listeners.
 *
 * A refused write changes nothing, and a write that would change nothing
 * writes nothing. Nothing here opens a dialog: confirmations belong to the caller.
 */
export class NotesService {
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: NotesServiceDeps) {}

  /** Called after every change stored through this service, and when a write picked up an outside change. */
  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A listener (a view refresh) never turns a stored change into a failure.
      }
    }
  }

  private beginWrite(allowWhilePaused = false): void {
    const { storage, workPause } = this.deps;
    if (storage.reloadIfExternal()) {
      this.emit();
    }
    if (!allowWhilePaused && workPause.isPaused()) {
      throw new DomainError("WORK_PAUSED", WORK_PAUSED_MESSAGE);
    }
    const problem = storage.getProblem();
    if (problem) {
      throw new StorageError("STORAGE_BLOCKED", blockedSaveMessage(problem));
    }
  }

  /**
   * Refuses, with the reason, when no write could succeed now (work paused,
   * or saving off). Callers run it before asking the user anything, so a
   * question is never answered for nothing.
   */
  checkWritable(): void {
    this.beginWrite();
  }

  // --- Lookups ---

  /** The note with this id; refuses an unknown id with `NOT_FOUND`. */
  getNote(id: unknown): MindStreamItem {
    const note = typeof id === "string" ? this.deps.items.get(id) : undefined;
    if (!note) {
      throw noteNotFound(id);
    }
    return note;
  }

  /** The type with this id; refuses an unknown id with `NOT_FOUND`. */
  getType(id: unknown): MindStreamTypeDef {
    return this.requireType(id);
  }

  /** The category with this id; refuses an unknown id with `NOT_FOUND`. */
  getCategory(id: unknown): MindStreamCategoryDef {
    return this.requireCategory(id);
  }

  private requireType(id: unknown): MindStreamTypeDef {
    const type = typeof id === "string" ? this.deps.types.get(id) : undefined;
    if (!type) {
      throw new DomainError("NOT_FOUND", refusal(`the note's type no longer exists (id "${String(id)}")`, "Pick an existing type, or add one from Manage Types."));
    }
    return type;
  }

  private requireCategory(id: unknown): MindStreamCategoryDef {
    const category = typeof id === "string" ? this.deps.categories.get(id) : undefined;
    if (!category) {
      throw new DomainError("NOT_FOUND", refusal(`the category no longer exists (id "${String(id)}")`, "Pick an existing category."));
    }
    return category;
  }

  private assertNotArchived(note: MindStreamItem): void {
    if (note.archived) {
      throw new ArchivedNoteError(note.title);
    }
  }

  private cleanPriority(raw: unknown): MindStreamPriority | undefined {
    if (raw === undefined) {
      return undefined;
    }
    if (!this.deps.priorityEnabled()) {
      throw invalid('priority is turned off in this project (the setting mindstream.priority.style is "off")', "Leave the priority out, or turn priority on in the settings.");
    }
    if (!isPriority(raw)) {
      throw invalid(`"${String(raw)}" is not a priority`, `Use one of: ${PRIORITIES.join(", ")}.`);
    }
    return raw;
  }

  /** The category's default type when it still exists, otherwise the first type. */
  private defaultTypeId(category: MindStreamCategoryDef | undefined): string {
    const { types } = this.deps;
    if (category?.defaultTypeId && types.get(category.defaultTypeId)) {
      return category.defaultTypeId;
    }
    return types.list()[0].id;
  }

  // --- Notes ---

  /**
   * Builds a code link for a location given by a caller, from the file's
   * current content (an open editor's unsaved text included), as "Add note to
   * this line" does. Refuses with `LINK_INVALID` a path outside the
   * workspace, a missing file, or lines the file does not have.
   */
  async linkFor(location: CodeLocation): Promise<MindStreamLink> {
    const linkInvalid = (reason: string, fix: string) => new DomainError("LINK_INVALID", refusal(reason, fix));
    if (typeof location !== "object" || location === null || Array.isArray(location)) {
      throw linkInvalid("the code location is not an object", "Send the location as { filePath, lineStart, lineEnd }.");
    }
    const { filePath, lineStart } = location;
    const lineEnd = location.lineEnd ?? lineStart;
    if (!isSafeRelativePath(filePath)) {
      throw linkInvalid(`"${String(filePath)}" is not a path inside the project`, "Use a path relative to the project folder with / separators, such as src/app.ts.");
    }
    if (!Number.isInteger(lineStart) || (lineStart as number) < 1 || !Number.isInteger(lineEnd) || (lineEnd as number) < (lineStart as number)) {
      throw linkInvalid("the line range is not valid", "Use 1-based line numbers, with the last line not before the first.");
    }
    const lines = await this.deps.files.readLines(filePath);
    if (!lines) {
      throw linkInvalid(`"${filePath}" does not exist`, "Check the path, relative to the project folder.");
    }
    if ((lineEnd as number) > lines.length) {
      throw linkInvalid(`"${filePath}" has ${lines.length} lines, so line ${String(lineEnd)} does not exist`, "Use lines that exist in the file.");
    }
    return buildLinkAt(filePath, lines, lineStart as number, lineEnd as number) as MindStreamLink;
  }

  /** Creates a note. `link` is one built by the host (the editor command, or `linkFor`), never by a caller. */
  addNote(input: NewNoteInput, link?: MindStreamLink): MindStreamItem {
    this.beginWrite();
    const { items, categories } = this.deps;
    const title = cleanTitle(input.title);
    const description = input.description === undefined ? undefined : cleanDescription(input.description);
    const category = input.categoryId === undefined ? categories.get(GENERAL_CATEGORY_ID) : this.requireCategory(input.categoryId);
    const typeId = input.typeId === undefined ? this.defaultTypeId(category) : this.requireType(input.typeId).id;
    const status = input.status === undefined ? "pending" : cleanStatus(input.status);
    const priority = this.cleanPriority(input.priority) ?? (this.deps.priorityEnabled() ? DEFAULT_PRIORITY : undefined);
    const tasks = input.tasks === undefined ? undefined : cleanTasks(input.tasks);
    let cleanLink: MindStreamLink | undefined;
    if (link !== undefined) {
      cleanLink = sanitizeLink(link);
      if (!cleanLink) {
        throw new DomainError("LINK_INVALID", refusal("the code link is not valid", "Create the link again from the file."));
      }
    }
    const note = items.create({ title, description, typeId, categoryId: category?.id ?? GENERAL_CATEGORY_ID, status, priority, tasks, link: cleanLink });
    this.emit();
    return note;
  }

  /**
   * Edits a note's fields. Replacing the description or the task list needs a
   * `guard` (the version it is based on), so text written elsewhere in the
   * meantime is never overwritten; `appendDescription` needs none.
   */
  updateNote(id: unknown, patch: NotePatch, guard: UpdateGuard = {}): NoteUpdateResult {
    this.beginWrite();
    const note = this.getNote(id);
    this.assertNotArchived(note);
    const next = this.cleanPatch(note, patch);
    const replacesContent = patch.description !== undefined || patch.tasks !== undefined;
    if (replacesContent && guard.base === undefined && guard.expectedUpdatedAt === undefined) {
      throw invalid(
        "replacing the description or the task list needs the version it is based on",
        "Pass expectedUpdatedAt (the note's updatedAt when you read it), or use appendDescription to add text."
      );
    }
    this.checkBase(note, guard);

    const changes: FieldChange[] = [];
    const write: Record<string, unknown> = {};
    for (const field of NOTE_FIELDS) {
      const after = next[field];
      const before = storedValue(note, field);
      if (after !== undefined && JSON.stringify(before) !== JSON.stringify(after)) {
        changes.push({ field, before, after });
        write[field] = after;
      }
    }
    if (changes.length) {
      this.deps.items.update(note.id, write as UpdateItemInput);
      this.emit();
    }
    return { note, changes };
  }

  private cleanPatch(note: MindStreamItem, patch: NotePatch): UpdateItemInput {
    const next: UpdateItemInput = {};
    if (patch.title !== undefined) {
      next.title = cleanTitle(patch.title);
    }
    if (patch.description !== undefined && patch.appendDescription !== undefined) {
      throw invalid("the description cannot be replaced and appended to at once", "Send either the description or the text to append.");
    }
    if (patch.description !== undefined) {
      next.description = cleanDescription(patch.description);
    }
    if (patch.appendDescription !== undefined) {
      const added = cleanDescription(patch.appendDescription).trim();
      if (!added) {
        throw invalid("the text to append is empty", "Send the text to add to the description.");
      }
      const current = (note.description ?? "").replace(/\s+$/, "");
      next.description = cleanDescription(current ? `${current}\n\n${added}` : added);
    }
    if (patch.typeId !== undefined) {
      next.typeId = this.requireType(patch.typeId).id;
    }
    if (patch.categoryId !== undefined) {
      next.categoryId = this.requireCategory(patch.categoryId).id;
    }
    if (patch.priority !== undefined) {
      next.priority = this.cleanPriority(patch.priority);
    }
    if (patch.tasks !== undefined) {
      next.tasks = cleanTasks(patch.tasks);
    }
    return next;
  }

  /** Refuses with `CONFLICT` (carrying the note as it is now) when the note changed after the caller's version. */
  private checkBase(note: MindStreamItem, guard: UpdateGuard): void {
    if (guard.expectedUpdatedAt !== undefined && guard.expectedUpdatedAt !== note.updatedAt) {
      throw new DomainError(
        "CONFLICT",
        refusal(`the note "${note.title}" changed after it was read (it was updated at ${note.updatedAt})`, "Read the note again and redo the change on its current content."),
        note
      );
    }
    const changed = guard.base ? changedSince(note, guard.base) : [];
    if (changed.length) {
      throw new DomainError(
        "CONFLICT",
        refusal(
          `this note was changed elsewhere after you opened it (${changed.map((f) => FIELD_LABEL[f]).join(", ")})`,
          "Your text is still in the form: copy what you need, then cancel and open the note again."
        ),
        note
      );
    }
  }

  /** Sets the status. A command, not a rewrite: it needs no base. `previous` shows what it replaced. */
  changeStatus(id: unknown, status: unknown): { note: MindStreamItem; previous: MindStreamStatus } {
    this.beginWrite();
    const note = this.getNote(id);
    this.assertNotArchived(note);
    const next = cleanStatus(status);
    const previous = note.status;
    if (previous !== next) {
      this.deps.items.changeStatus(note.id, next);
      this.emit();
    }
    return { note, previous };
  }

  /** Archives or unarchives (status untouched). Unarchiving re-finds the note's code, which is not re-checked while archived. */
  async setArchived(id: unknown, archived: unknown): Promise<{ note: MindStreamItem; previous: boolean }> {
    this.beginWrite();
    const note = this.getNote(id);
    if (typeof archived !== "boolean") {
      throw invalid("archived must be true or false", "Send true to archive the note or false to unarchive it.");
    }
    const previous = note.archived;
    if (previous === archived) {
      return { note, previous };
    }
    this.deps.items.setArchived(note.id, archived);
    try {
      if (previous) {
        // A refused write of the re-found link is dropped silently by the tracker.
        await this.deps.links.resolveItem(note.id);
      }
    } finally {
      this.emit();
    }
    return { note: this.deps.items.get(note.id) ?? note, previous };
  }

  /**
   * Checks or unchecks one task. `title` must match the task at `index`
   * (0-based): a list changed meanwhile refuses with `CONFLICT`.
   */
  setTaskCompleted(id: unknown, index: unknown, title: unknown, completed: unknown): { note: MindStreamItem; previous: boolean } {
    this.beginWrite();
    const note = this.getNote(id);
    this.assertNotArchived(note);
    if (!Number.isInteger(index) || (index as number) < 0 || typeof title !== "string" || typeof completed !== "boolean") {
      throw invalid("the task request is not complete", "Send the task's 0-based index, its current title, and completed as true or false.");
    }
    const position = index as number;
    const task = note.tasks?.[position];
    if (!task || task.title !== title) {
      throw new DomainError(
        "CONFLICT",
        refusal(`the task list of "${note.title}" changed: task ${position + 1} is not "${title}" any more`, "Read the note again and use its current task list."),
        note
      );
    }
    const previous = task.completed;
    if (previous !== completed) {
      this.deps.items.setTaskCompleted(note.id, position, title, completed);
      this.emit();
    }
    return { note, previous };
  }

  /** Permanent deletion. The caller asks the user first; automated callers are never offered it. */
  deleteNote(id: unknown): void {
    this.beginWrite();
    const note = this.getNote(id);
    this.deps.items.delete(note.id);
    this.emit();
  }

  // --- Categories and types ---

  private assertUniqueLabel(entries: { id: string; label: string }[], label: string, what: "category" | "type", exceptId?: string): void {
    const key = label.toLocaleLowerCase();
    const existing = entries.find((e) => e.id !== exceptId && e.label.trim().toLocaleLowerCase() === key);
    if (existing) {
      throw new DomainError("DUPLICATE", refusal(`a ${what} named "${existing.label}" already exists`, `Use the existing ${what}, or pick another name.`), existing);
    }
  }

  addCategory(label: unknown): MindStreamCategoryDef {
    this.beginWrite();
    const clean = cleanLabel(label, "category");
    this.assertUniqueLabel(this.deps.categories.list(), clean, "category");
    const def = this.deps.categories.add(clean);
    this.emit();
    return def;
  }

  renameCategory(id: unknown, label: unknown): MindStreamCategoryDef {
    this.beginWrite();
    const category = this.requireCategory(id);
    const clean = cleanLabel(label, "category");
    if (clean !== category.label) {
      this.assertUniqueLabel(this.deps.categories.list(), clean, "category", category.id);
      this.deps.categories.rename(category.id, clean);
      this.emit();
    }
    return category;
  }

  /** Sets the type pre-selected for new notes in a category (also used when a caller gives no type). */
  setCategoryDefaultType(id: unknown, typeId: unknown): MindStreamCategoryDef {
    this.beginWrite();
    const category = this.requireCategory(id);
    const type = this.requireType(typeId);
    if (category.defaultTypeId !== type.id) {
      this.deps.categories.setDefaultType(category.id, type.id);
      this.emit();
    }
    return category;
  }

  /** Deletes a category and every note in it, in one save. Returns the number of notes deleted. The caller asks the user first. */
  deleteCategory(id: unknown): number {
    this.beginWrite();
    const category = this.requireCategory(id);
    if (category.id === GENERAL_CATEGORY_ID) {
      throw invalid(`the built-in category "${category.label}" cannot be deleted`, "Rename it instead, or delete another category.");
    }
    const removed = this.deps.categories.removeWithNotes(category.id);
    this.emit();
    return removed;
  }

  addType(label: unknown, icon?: unknown): MindStreamTypeDef {
    this.beginWrite();
    const clean = cleanLabel(label, "type");
    const cleanedIcon = icon === undefined ? undefined : cleanIcon(icon);
    this.assertUniqueLabel(this.deps.types.list(), clean, "type");
    const def = this.deps.types.add(clean, cleanedIcon);
    this.emit();
    return def;
  }

  renameType(id: unknown, label: unknown): MindStreamTypeDef {
    this.beginWrite();
    const type = this.requireType(id);
    const clean = cleanLabel(label, "type");
    if (clean !== type.label) {
      this.assertUniqueLabel(this.deps.types.list(), clean, "type", type.id);
      this.deps.types.rename(type.id, clean);
      this.emit();
    }
    return type;
  }

  setTypeIcon(id: unknown, icon: unknown): MindStreamTypeDef {
    this.beginWrite();
    const type = this.requireType(id);
    const clean = cleanIcon(icon);
    if (clean !== type.icon) {
      this.deps.types.setIcon(type.id, clean);
      this.emit();
    }
    return type;
  }

  /** Why a type cannot be deleted (a full sentence), or `undefined` when it can. Checked before the user is asked. */
  typeDeletionProblem(id: string): string | undefined {
    const { types } = this.deps;
    const type = types.get(id);
    if (!type) {
      return undefined;
    }
    if (types.list().length <= 1) {
      return `Type "${type.label}" is the last type. Add another type before deleting it: notes need at least one type.`;
    }
    const used = types.countItems(id);
    return used > 0 ? `Type "${type.label}" is used by ${used} note(s). Change those notes to a different type before deleting it.` : undefined;
  }

  /** Deletes an unused type. The caller asks the user first. */
  deleteType(id: unknown): void {
    this.beginWrite();
    const type = this.requireType(id);
    const problem = this.typeDeletionProblem(type.id);
    if (problem) {
      throw new DomainError("INVALID_INPUT", `Not deleted: ${problem} Nothing was changed.`);
    }
    this.deps.types.remove(type.id);
    this.emit();
  }

  /**
   * Adds back every default type that is missing (matched by label, ignoring
   * case), after the existing types. Existing types are never changed. Returns
   * the added types; empty when none was missing (nothing is written).
   */
  restoreDefaultTypes(): MindStreamTypeDef[] {
    this.beginWrite();
    const added = this.deps.types.restoreDefaults();
    if (added.length > 0) {
      this.emit();
    }
    return added;
  }

  // --- Work Pause note ---

  /**
   * Saves the Work Pause note's text (trimmed), for the user's own note panel.
   * The text is replaced as a whole, so once a note exists the caller passes
   * the text it edited (`base`); a newer text refuses with `CONFLICT`.
   */
  saveWorkPauseNote(text: unknown, options: WorkPauseSaveOptions = {}): { note: MindStreamWorkPauseNote; changed: boolean } {
    this.beginWrite(options.userEditWhilePaused === true);
    if (typeof text !== "string" || !text.trim()) {
      throw invalid("the note text is empty", "Write where work stopped and what comes next.");
    }
    const clean = text.trim();
    if (clean.length > MAX_WORK_PAUSE_TEXT) {
      throw invalid(`the note is longer than ${MAX_WORK_PAUSE_TEXT} characters`, "Shorten the note.");
    }
    const current = this.deps.workPause.get();
    if (current.text && options.base === undefined) {
      throw invalid("replacing the Work Pause note needs the text it is based on", "Close the note editor, then edit the note again.");
    }
    const lf = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "");
    if (options.base !== undefined && lf(options.base) !== lf(current.text)) {
      throw new DomainError(
        "CONFLICT",
        refusal(
          "the Work Pause note was changed elsewhere after you started editing it",
          "Your text is still in the editor: copy what you need, then cancel and edit the note again."
        ),
        current
      );
    }
    const pause = options.pause === true;
    if (clean === current.text && (!pause || current.paused)) {
      return { note: current, changed: false };
    }
    this.deps.workPause.save(clean, pause);
    this.emit();
    return { note: this.deps.workPause.get(), changed: true };
  }

  /**
   * Refuses, with the reason, when the Work Pause note cannot be deleted now:
   * saving is off, or the note the user is looking at (`base`) is no longer
   * the stored one. Allowed while work is paused (deleting also resumes).
   * The caller runs it before asking the user to confirm.
   */
  checkWorkPauseNoteDeletable(base: unknown): void {
    this.beginWrite(true);
    const current = this.deps.workPause.get();
    const lf = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "");
    if (!current.text) {
      throw invalid("there is no Work Pause note to delete", "Refresh the panel.");
    }
    if (lf(base) !== lf(current.text)) {
      throw new DomainError(
        "CONFLICT",
        refusal("the Work Pause note was changed elsewhere after it was shown", "Read the note as it is now, then delete it again if you still want to."),
        current
      );
    }
  }

  /**
   * Deletes the Work Pause note and so resumes work: the user's own decision,
   * from the note card, after confirming. `base` is the text the user saw.
   * No automated caller is offered this.
   */
  deleteWorkPauseNote(base: unknown): void {
    this.checkWorkPauseNoteDeletable(base);
    this.deps.workPause.clear();
    this.emit();
  }
}
