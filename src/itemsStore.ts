import { MindStreamItem, MindStreamStatus } from './models';
import { IStorage } from './storage';
import { newId, nowIso } from './util';

export interface NewItemInput {
  typeId: string;
  title: string;
  description?: string;
  tags?: string[];
  status?: MindStreamStatus;
}

export interface UpdateItemInput {
  title?: string;
  description?: string;
  typeId?: string;
  tags?: string[];
}

const STATUS_ORDER: Record<MindStreamStatus, number> = {
  pending: 0,
  'in-progress': 1,
  done: 2
};

/**
 * Item management (CRUD) with:
 * - An append-only history of status transitions.
 * - Archiving fully independent of status.
 * - Permanent deletion separate from archiving.
 */
export class ItemsStore {
  constructor(private readonly storage: IStorage) {}

  list(includeArchived = false): MindStreamItem[] {
    const items = this.storage.getData().items;
    const filtered = includeArchived ? items : items.filter((it) => !it.archived);
    return filtered.sort(this.compare);
  }

  /** Default ordering: by status, then by last-updated time (descending). */
  private compare(a: MindStreamItem, b: MindStreamItem): number {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) {
      return s;
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  }

  get(id: string): MindStreamItem | undefined {
    return this.storage.getData().items.find((it) => it.id === id);
  }

  create(input: NewItemInput): MindStreamItem {
    const data = this.storage.getData();
    const now = nowIso();
    const status = input.status ?? 'pending';
    const item: MindStreamItem = {
      id: newId(),
      typeId: input.typeId,
      title: input.title,
      description: input.description,
      status,
      statusHistory: [{ status, at: now }],
      archived: false,
      tags: input.tags,
      createdAt: now,
      updatedAt: now
    };
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
    if (patch.tags !== undefined) {
      item.tags = patch.tags;
    }
    item.updatedAt = nowIso();
    this.storage.saveData(data);
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

  /** Time of the last transition to "done" (used to show the completion sequence). */
  completedAt(item: MindStreamItem): string | undefined {
    const done = item.statusHistory.filter((h) => h.status === 'done');
    return done.length ? done[done.length - 1].at : undefined;
  }
}
