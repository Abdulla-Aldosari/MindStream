/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { GENERAL_CATEGORY_ID, MindStreamItem, MindStreamLink, MindStreamPriority, MindStreamStatus, MindStreamTask } from "./models";
import { IStorage } from "./storage";
import { newId, nowIso } from "./util";

export interface NewItemInput {
  typeId: string;
  title: string;
  description?: string;
  categoryId?: string;
  tags?: string[];
  status?: MindStreamStatus;
  /** Omitted when the priority system is disabled: the key is then not written at all. */
  priority?: MindStreamPriority;
  /** Code location, set only when the note is created from the editor context menu. */
  link?: MindStreamLink;
  /** Already sanitized; omitted or empty creates a regular note (no `tasks` key). */
  tasks?: MindStreamTask[];
}

/** The link is deliberately absent: it can never be edited, only tracked by the host (see `mapLinks`/`setLink`). */
export interface UpdateItemInput {
  title?: string;
  description?: string;
  typeId?: string;
  categoryId?: string;
  tags?: string[];
  /** Omitted leaves the stored priority untouched (including an absent one). */
  priority?: MindStreamPriority;
  /** Replaces the whole list (already sanitized). `[]` removes the key; omitted leaves the tasks untouched. */
  tasks?: MindStreamTask[];
}

/**
 * Thrown when a write targets an archived note. Its message is complete and
 * safe to show as is, to the user or to an automated caller: it states the
 * reason, that nothing was changed, and how to resolve it.
 */
export class ArchivedNoteError extends Error {
  readonly code = "NOTE_ARCHIVED";

  constructor(title: string) {
    super(`Not saved: the note "${title}" is archived, and archived notes are read-only. Nothing was changed. Unarchive it first, then try again.`);
    this.name = "ArchivedNoteError";
  }
}

/**
 * Item management (CRUD) with:
 * - An append-only history of status transitions.
 * - Archiving fully independent of status.
 * - Permanent deletion separate from archiving.
 * - Archived notes are read-only: `update`, `changeStatus`, and
 *   `setTaskCompleted` throw `ArchivedNoteError` before changing anything.
 *   Still allowed: `setArchived` (the way back), `delete`/`deleteByCategory`,
 *   and host-side link tracking (`setLink`/`mapLinks`).
 */
export class ItemsStore {
  constructor(private readonly storage: IStorage) {}

  private assertNotArchived(item: MindStreamItem): void {
    if (item.archived) {
      throw new ArchivedNoteError(item.title);
    }
  }

  /**
   * Returns items in a stable creation order (ascending `createdAt`).
   * The view layer applies any status-based sorting/grouping for display.
   */
  list(includeArchived = false): MindStreamItem[] {
    const items = this.storage.getData().items;
    const filtered = includeArchived ? items : items.filter((it) => !it.archived);
    return [...filtered].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  get(id: string): MindStreamItem | undefined {
    return this.storage.getData().items.find((it) => it.id === id);
  }

  create(input: NewItemInput): MindStreamItem {
    const data = this.storage.getData();
    const now = nowIso();
    const status = input.status ?? "pending";
    const item: MindStreamItem = {
      id: newId(),
      typeId: input.typeId,
      categoryId: input.categoryId ?? GENERAL_CATEGORY_ID,
      title: input.title,
      description: input.description,
      status,
      archived: false,
      tags: input.tags,
      createdAt: now,
      updatedAt: now,
    };
    if (status === "done") {
      item.completedAt = now;
    }
    if (input.priority !== undefined) {
      item.priority = input.priority;
    }
    if (input.link !== undefined) {
      item.link = input.link;
    }
    if (input.tasks?.length) {
      item.tasks = input.tasks;
    }
    data.items.push(item);
    this.storage.saveData(data);
    return item;
  }

  update(id: string, patch: UpdateItemInput): void {
    const data = this.storage.getData();
    const item = data.items.find((it) => it.id === id);
    if (!item) {
      return;
    }
    this.assertNotArchived(item);
    if (patch.title !== undefined) {
      item.title = patch.title;
    }
    if (patch.description !== undefined) {
      item.description = patch.description;
    }
    if (patch.typeId !== undefined) {
      item.typeId = patch.typeId;
    }
    if (patch.categoryId !== undefined) {
      item.categoryId = patch.categoryId;
    }
    if (patch.tags !== undefined) {
      item.tags = patch.tags;
    }
    if (patch.priority !== undefined) {
      item.priority = patch.priority;
    }
    if (patch.tasks !== undefined) {
      if (patch.tasks.length) {
        item.tasks = patch.tasks;
      } else {
        delete item.tasks;
      }
    }
    item.updatedAt = nowIso();
    this.storage.saveData(data);
  }

  /**
   * Checks or unchecks one task (from the viewer). `title` must match the task
   * at `index`, so a list changed meanwhile (an external file edit) is never
   * updated at the wrong position. Never touches `status`. Returns whether
   * anything was saved.
   */
  setTaskCompleted(id: string, index: number, title: string, completed: boolean): boolean {
    const data = this.storage.getData();
    const item = data.items.find((it) => it.id === id);
    if (item) {
      this.assertNotArchived(item);
    }
    const task = item?.tasks?.[index];
    if (!item || !task || task.title !== title || task.completed === completed) {
      return false;
    }
    task.completed = completed;
    item.updatedAt = nowIso();
    this.storage.saveData(data);
    return true;
  }

  /** Replaces a note's code link (host-side tracking). Does not touch `updatedAt`: it is not a user edit. */
  setLink(id: string, link: MindStreamLink): void {
    const data = this.storage.getData();
    const item = data.items.find((it) => it.id === id);
    if (!item || !item.link) {
      return;
    }
    item.link = link;
    this.storage.saveData(data);
  }

  /**
   * Applies `fn` to every linked note and saves once if any link changed
   * (compared by identity: return the same object for "no change").
   * Returns the number of changed links. With `persist: false` only the
   * in-memory data changes; the caller must call `save()` later.
   */
  mapLinks(fn: (link: MindStreamLink) => MindStreamLink, persist = true): number {
    const data = this.storage.getData();
    let changed = 0;
    for (const item of data.items) {
      if (!item.link) {
        continue;
      }
      const next = fn(item.link);
      if (next !== item.link) {
        item.link = next;
        changed += 1;
      }
    }
    if (changed > 0 && persist) {
      this.storage.saveData(data);
    }
    return changed;
  }

  /** Writes the current in-memory data (used to flush `persist: false` changes). */
  save(): void {
    this.storage.saveData(this.storage.getData());
  }

  /** Changes status; `completedAt` is set on "done" and removed on any other status. Throws `ArchivedNoteError` for an archived note. */
  changeStatus(id: string, status: MindStreamStatus): void {
    const data = this.storage.getData();
    const item = data.items.find((it) => it.id === id);
    if (!item) {
      return;
    }
    this.assertNotArchived(item);
    if (item.status === status) {
      return;
    }
    const now = nowIso();
    item.status = status;
    if (status === "done") {
      item.completedAt = now;
    } else {
      delete item.completedAt;
    }
    item.updatedAt = now;
    this.storage.saveData(data);
  }

  /** Archives/unarchives without touching the status at all. */
  setArchived(id: string, archived: boolean): void {
    const data = this.storage.getData();
    const item = data.items.find((it) => it.id === id);
    if (!item || item.archived === archived) {
      return;
    }
    item.archived = archived;
    item.archivedAt = archived ? nowIso() : undefined;
    item.updatedAt = nowIso();
    this.storage.saveData(data);
  }

  /** Permanent deletion (distinct from archiving). */
  delete(id: string): void {
    const data = this.storage.getData();
    data.items = data.items.filter((it) => it.id !== id);
    this.storage.saveData(data);
  }

  /** Deletes every item belonging to a given category. */
  deleteByCategory(categoryId: string): void {
    const data = this.storage.getData();
    data.items = data.items.filter((it) => it.categoryId !== categoryId);
    this.storage.saveData(data);
  }
}
