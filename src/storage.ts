import * as fs from 'fs';
import * as path from 'path';
import {
  DATA_VERSION,
  GENERAL_CATEGORY_ID,
  MindStreamCategoryDef,
  MindStreamData,
  MindStreamTypeDef
} from './models';
import { newId, nowIso } from './util';

/** Standalone type that makes it easy to test the layer without depending on vscode. */
export interface StorageBackend {
  load(): string | null;
  save(text: string): void;
}

/** Generic interface for reading/writing MindStream data. */
export interface IStorage {
  getData(): MindStreamData;
  saveData(data: MindStreamData): void;
  /**
   * Re-reads the backend and, only if its content differs from what this
   * instance itself last wrote (i.e. the change came from outside this
   * instance), replaces the in-memory data with the freshly parsed/
   * normalized version. Returns whether a reload actually happened.
   */
  reloadIfExternal(): boolean;
}

export const DEFAULT_TYPES: Omit<MindStreamTypeDef, 'id' | 'createdAt'>[] = [
  { label: 'General', icon: 'note' },
  { label: 'Idea', icon: 'lightbulb' },
  { label: 'Task', icon: 'tasklist' },
  { label: 'Feature', icon: 'star' },
  { label: 'Fix', icon: 'wrench' },
  { label: 'Refactor', icon: 'sync' },
  { label: 'Test', icon: 'beaker' },
  { label: 'Docs', icon: 'book' },
  { label: 'Chore', icon: 'gear' },
  { label: 'Code', icon: 'code' },
  { label: 'Resource', icon: 'link' },
];

/** The built-in default category. */
export const DEFAULT_CATEGORIES: Omit<MindStreamCategoryDef, 'createdAt'>[] = [
  { id: GENERAL_CATEGORY_ID, label: 'General', isDefault: true, order: 0 }
];

/** Creates the empty default structure with the ready-made default types. */
export function createEmptyData(): MindStreamData {
  return {
    version: DATA_VERSION,
    types: DEFAULT_TYPES.map((t) => ({ ...t, id: newId(), createdAt: nowIso() })),
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, createdAt: nowIso() })),
    items: []
  };
}

/** Normalizes any legacy/incomplete structure and returns a valid one (foundation for future migrations). */
export function normalizeData(raw: unknown): MindStreamData {
  if (!raw || typeof raw !== 'object') {
    return createEmptyData();
  }
  const obj = raw as Partial<MindStreamData>;
  const types = Array.isArray(obj.types) ? obj.types : [];
  let categories = Array.isArray(obj.categories) ? obj.categories : [];
  const allItems = Array.isArray(obj.items) ? obj.items : [];

  // Ensure the built-in "General" category always exists.
  if (!categories.some((c) => c.id === GENERAL_CATEGORY_ID)) {
    categories = [
      { id: GENERAL_CATEGORY_ID, label: 'General', isDefault: true, order: 0, createdAt: nowIso() },
      ...categories
    ];
  }

  // Ignore any legacy item that has no categoryId (as agreed: no migration).
  const items = allItems.filter((it) => typeof it.categoryId === 'string');

  // Ensures the required history records exist on every item.
  for (const it of items) {
    if (!Array.isArray(it.statusHistory)) {
      it.statusHistory = [{ status: it.status ?? 'pending', at: it.createdAt ?? nowIso() }];
    }
    if (typeof it.archived !== 'boolean') {
      it.archived = false;
    }
  }
  return {
    version: typeof obj.version === 'number' ? obj.version : DATA_VERSION,
    types,
    categories,
    items
  };
}

/** Parses raw backend text into valid `MindStreamData`, falling back to a fresh default structure for `null`/corrupt input. */
function parseOrDefault(raw: string | null): MindStreamData {
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  return parsed ? normalizeData(parsed) : createEmptyData();
}

/**
 * JSON-file based storage inside the workspace: `.mindstream/data.json`.
 * Writes happen safely (temporary file then rename) to avoid data corruption.
 */
export class StorageService implements IStorage {
  private data: MindStreamData;
  /** Raw text of the backend content as of the last successful load/save, used to
   *  detect whether a later `reloadIfExternal()` call sees a genuinely external
   *  change or just an echo of this instance's own write. */
  private lastKnownText: string | null;

  private constructor(private readonly backend: StorageBackend) {
    const raw = backend.load();
    this.data = parseOrDefault(raw);
    this.lastKnownText = raw;
  }

  /** Creates a storage service bound to a given directory (writes `.mindstream/data.json` inside it). */
  static forDir(dirPath: string): StorageService {
    const dir = path.join(dirPath, '.mindstream');
    const file = path.join(dir, 'data.json');
    return new StorageService({
      load: () => {
        try {
          if (fs.existsSync(file)) {
            return fs.readFileSync(file, 'utf8');
          }
        } catch {
          // Corrupt/unreadable files are treated as non-existent.
        }
        return null;
      },
      save: (text: string) => {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, text, 'utf8');
        fs.renameSync(tmp, file);
      }
    });
  }

  /** Creates a storage service from a given text (used in tests). */
  static fromText(initial: string | null): StorageService {
    return new StorageService({
      load: () => initial,
      save: () => {
        /* no-op for tests */
      }
    });
  }

  getData(): MindStreamData {
    return this.data;
  }

  saveData(data: MindStreamData): void {
    this.data = data;
    const text = JSON.stringify(data, null, 2);
    this.lastKnownText = text;
    this.backend.save(text);
  }

  reloadIfExternal(): boolean {
    const raw = this.backend.load();
    if (raw === this.lastKnownText) {
      // Identical to what this instance last read/wrote: either nothing
      // changed, or this is just an echo of our own write (e.g. a
      // FileSystemWatcher event firing for a save we just performed).
      return false;
    }
    this.data = parseOrDefault(raw);
    this.lastKnownText = raw;
    return true;
  }
}
