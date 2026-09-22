import * as fs from 'fs';
import * as path from 'path';
import { DATA_VERSION, MindStreamData, MindStreamTypeDef } from './models';
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
}

export const DEFAULT_TYPES: Omit<MindStreamTypeDef, 'id' | 'createdAt'>[] = [
  { label: 'Fix', icon: 'wrench' },
  { label: 'Change', icon: 'edit' },
  { label: 'New Feature', icon: 'star' },
  { label: 'Refactor', icon: 'sync' },
  { label: 'Code Note', icon: 'code' },
  { label: 'Test', icon: 'beaker' },
  { label: 'General Note', icon: 'note' },
  { label: 'Resource', icon: 'link' }
];

/** Creates the empty default structure with the ready-made default types. */
export function createEmptyData(): MindStreamData {
  return {
    version: DATA_VERSION,
    types: DEFAULT_TYPES.map((t) => ({ ...t, id: newId(), createdAt: nowIso() })),
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
  const items = Array.isArray(obj.items) ? obj.items : [];
  // Ensures the required history records exist on every item.
  for (const it of items) {
    if (!Array.isArray((it as any).statusHistory)) {
      (it as any).statusHistory = [{ status: (it as any).status ?? 'pending', at: (it as any).createdAt ?? nowIso() }];
    }
    if (typeof (it as any).archived !== 'boolean') {
      (it as any).archived = false;
    }
  }
  return {
    version: typeof obj.version === 'number' ? obj.version : DATA_VERSION,
    types,
    items
  };
}

/**
 * JSON-file based storage inside the workspace: `.mindstream/data.json`.
 * Writes happen safely (temporary file then rename) to avoid data corruption.
 */
export class StorageService implements IStorage {
  private data: MindStreamData;

  private constructor(private readonly backend: StorageBackend) {
    const raw = backend.load();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    this.data = parsed ? normalizeData(parsed) : createEmptyData();
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
    this.backend.save(JSON.stringify(data, null, 2));
  }

}
