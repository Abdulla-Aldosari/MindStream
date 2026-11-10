import { GENERAL_CATEGORY_ID, MindStreamItem, MindStreamLink, MindStreamPriority, MindStreamStatus } from "./models";
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
}

/**
 * Item management (CRUD) with:
 * - An append-only history of status transitions.
 * - Archiving fully independent of status.
 * - Permanent deletion separate from archiving.
 */
export class ItemsStore {
  constructor(private readonly storage: IStorage) {}

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
      statusHistory: [{ status, at: now }],
      archived: false,
      tags: input.tags,
      createdAt: now,
      updatedAt: now,
    };
    if (input.priority !== undefined) {
      item.priority = input.priority;
    }
    if (input.link !== undefined) {
      item.link = input.link;
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
    item.updatedAt = nowIso();
    this.storage.saveData(data);
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

  /** Changes status and appends the new entry to statusHistory (never removes anything). */
  changeStatus(id: string, status: MindStreamStatus): void {
    const data = this.storage.getData();
    const item = data.items.find((it) => it.id === id);
    if (!item || item.status === status) {
      return;
    }
    item.status = status;
    item.statusHistory.push({ status, at: nowIso() });
    item.updatedAt = nowIso();
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

  /** Time of the last transition to "done" (used to show the completion sequence). */
  completedAt(item: MindStreamItem): string | undefined {
    const done = item.statusHistory.filter((h) => h.status === "done");
    return done.length ? done[done.length - 1].at : undefined;
  }
}
