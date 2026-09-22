import { MindStreamItem, MindStreamTypeDef } from './models';
import { IStorage } from './storage';
import { newId, nowIso } from './util';

/**
 * Types registry management.
 * Allows adding/renaming/removing types while keeping linked records intact,
 * because items reference the stable typeId rather than the label.
 */
export class TypesRegistry {
  constructor(private readonly storage: IStorage) {}

  list(): MindStreamTypeDef[] {
    return [...this.storage.getData().types].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  get(id: string): MindStreamTypeDef | undefined {
    return this.storage.getData().types.find((t) => t.id === id);
  }

  label(id: string): string {
    const t = this.get(id);
    return t ? t.label : '(Deleted type)';
  }

  add(label: string, icon?: string): MindStreamTypeDef {
    const data = this.storage.getData();
    const def: MindStreamTypeDef = {
      id: newId(),
      label,
      icon,
      order: (data.types.length + 1) * 10,
      createdAt: nowIso()
    };
    data.types.push(def);
    this.storage.saveData(data);
    return def;
  }

  rename(id: string, label: string): void {
    const data = this.storage.getData();
    const def = data.types.find((t) => t.id === id);
    if (!def) {
      return;
    }
    def.label = label;
    this.storage.saveData(data);
  }

  /** Removes a type and returns how many items referenced it (they stay intact as "Deleted type"). */
  remove(id: string): number {
    const data = this.storage.getData();
    const affected = data.items.filter((it) => it.typeId === id).length;
    data.types = data.types.filter((t) => t.id !== id);
    this.storage.saveData(data);
    return affected;
  }

  /** Reassigns all items from a deleted type to another type. */
  reassign(fromTypeId: string, toTypeId: string): number {
    const data = this.storage.getData();
    let count = 0;
    for (const it of data.items) {
      if (it.typeId === fromTypeId) {
        it.typeId = toTypeId;
        it.updatedAt = nowIso();
        count++;
      }
    }
    this.storage.saveData(data);
    return count;
  }
}
