/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { MindStreamTypeDef } from "./models";
import { DEFAULT_TYPES, IStorage } from "./storage";
import { newId, nowIso } from "./util";

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
    return t ? t.label : "(Deleted type)";
  }

  add(label: string, icon?: string): MindStreamTypeDef {
    const data = this.storage.getData();
    const def: MindStreamTypeDef = {
      id: newId(),
      label,
      icon,
      order: (data.types.length + 1) * 10,
      createdAt: nowIso(),
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

  setIcon(id: string, icon: string): void {
    const data = this.storage.getData();
    const def = data.types.find((t) => t.id === id);
    if (!def) {
      return;
    }
    def.icon = icon;
    this.storage.saveData(data);
  }

  /**
   * The default types whose label is not among the current types (compared
   * ignoring case and surrounding spaces). A renamed default type counts as missing.
   */
  missingDefaults(): typeof DEFAULT_TYPES {
    const present = new Set(this.storage.getData().types.map((t) => t.label.trim().toLocaleLowerCase()));
    return DEFAULT_TYPES.filter((d) => !present.has(d.label.trim().toLocaleLowerCase()));
  }

  /**
   * Adds every missing default type after the existing ones, in one save, and
   * returns the added types. Existing types are never changed or reordered,
   * and nothing is written when no default type is missing.
   */
  restoreDefaults(): MindStreamTypeDef[] {
    const missing = this.missingDefaults();
    if (missing.length === 0) {
      return [];
    }
    const data = this.storage.getData();
    let order = data.types.reduce((max, t) => Math.max(max, t.order ?? 0), 0);
    const added = missing.map((d) => {
      order += 10;
      return { ...d, id: newId(), order, createdAt: nowIso() };
    });
    data.types.push(...added);
    this.storage.saveData(data);
    return added;
  }

  /**
   * Removes a type and returns how many items referenced it (they stay intact as "Deleted type").
   * The last remaining type cannot be removed: without one no note can be created.
   */
  remove(id: string): number {
    const data = this.storage.getData();
    if (data.types.length <= 1 && data.types.some((t) => t.id === id)) {
      throw new Error("The last type cannot be deleted: notes need at least one type. Add another type first. Nothing was changed.");
    }
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

  /** Number of items (including archived) that reference a type. */
  countItems(typeId: string): number {
    return this.storage.getData().items.filter((it) => it.typeId === typeId).length;
  }
}
