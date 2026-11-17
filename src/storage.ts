import * as fs from "fs";
import * as path from "path";
import { DATA_VERSION, GENERAL_CATEGORY_ID, MindStreamCategoryDef, MindStreamData, MindStreamTypeDef } from "./models";
import { isPriority } from "./priority";
import { sanitizeLink } from "./linkResolver";
import { sanitizeTasks } from "./tasks";
import { newId, nowIso } from "./util";
import { normalizeWorkPauseNote } from "./workPause";

/** Standalone type that makes it easy to test the layer without depending on vscode. */
export interface StorageBackend {
  /** The file text, or `null` when no file exists. Throws when a file exists but cannot be read. */
  load(): string | null;
  save(text: string): void;
}

/** Shown to the user in every storage message. */
export const DATA_FILE_LABEL = ".vscode/mindstream.data.json";

/**
 * Why the data file cannot be used. While a problem is set, every save is
 * refused, so a file that could not be read or understood is never replaced.
 */
export interface StorageProblem {
  kind: "unreadable" | "invalid";
  /** What is wrong, as a full sentence. */
  message: string;
  /** How the user resolves it, as a full sentence. */
  howToFix: string;
}

export type StorageErrorCode = "STORAGE_BLOCKED" | "WRITE_FAILED";

/**
 * Thrown by `saveData()` when nothing could be saved. Its message is complete
 * and safe to show as is, to the user or to an automated caller: it states the
 * reason, that nothing was changed, and how to resolve it.
 */
export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/** Errors a rename gets while another process briefly holds the target (antivirus, indexer, file watcher on Windows). */
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Blocks the thread for `ms` milliseconds (saving is synchronous). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Renames `from` over `to`, retrying a few times with a growing pause when the
 * failure is one that another process causes for a moment. Any other error, and
 * the last transient one, is thrown so the caller leaves nothing behind.
 */
export function renameWithRetry(from: string, to: string, rename: (from: string, to: string) => void = fs.renameSync, sleep: (ms: number) => void = sleepSync, attempts = 5): void {
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= attempts || !code || !TRANSIENT_RENAME_CODES.has(code)) {
        throw err;
      }
      sleep(attempt * 20);
    }
  }
}

/** Generic interface for reading/writing MindStream data. */
export interface IStorage {
  getData(): MindStreamData;
  /**
   * Persists `data`. Throws a `StorageError` when it cannot: the file is then
   * untouched and the in-memory data is restored to the last saved state, so a
   * caller that mutated `getData()` in place changes nothing either.
   */
  saveData(data: MindStreamData): void;
  /**
   * Re-reads the backend and, only if its content differs from what this
   * instance itself last wrote (i.e. the change came from outside this
   * instance), replaces the in-memory data with the freshly parsed/
   * normalized version. Returns whether the data or the problem state changed.
   */
  reloadIfExternal(): boolean;
  /** The current reason saving is refused, or `undefined` when saving works. */
  getProblem(): StorageProblem | undefined;
}

export const DEFAULT_TYPES: Omit<MindStreamTypeDef, "id" | "createdAt">[] = [
  { label: "General", icon: "note" },
  { label: "Idea", icon: "lightbulb" },
  { label: "Task", icon: "tasklist" },
  { label: "Feature", icon: "star" },
  { label: "Fix", icon: "wrench" },
  { label: "Refactor", icon: "sync" },
  { label: "Test", icon: "beaker" },
  { label: "Docs", icon: "book" },
  { label: "Chore", icon: "gear" },
  { label: "Code", icon: "code" },
  { label: "Resource", icon: "link" },
];

/** The built-in default category. */
export const DEFAULT_CATEGORIES: Omit<MindStreamCategoryDef, "createdAt">[] = [{ id: GENERAL_CATEGORY_ID, label: "General", isDefault: true, order: 0 }];

function createDefaultTypes(): MindStreamTypeDef[] {
  return DEFAULT_TYPES.map((t) => ({ ...t, id: newId(), createdAt: nowIso() }));
}

/** Creates the empty default structure with the ready-made default types. */
export function createEmptyData(): MindStreamData {
  return {
    version: DATA_VERSION,
    types: createDefaultTypes(),
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, createdAt: nowIso() })),
    items: [],
  };
}

/** Normalizes an incomplete or hand-edited structure into a valid one. */
export function normalizeData(raw: unknown): MindStreamData {
  if (!raw || typeof raw !== "object") {
    return createEmptyData();
  }
  const obj = raw as Partial<MindStreamData>;
  // A project always has at least one type (the note editor cannot save without one).
  const types = Array.isArray(obj.types) && obj.types.length > 0 ? obj.types : createDefaultTypes();
  let categories = Array.isArray(obj.categories) ? obj.categories : [];
  const allItems = Array.isArray(obj.items) ? obj.items : [];

  // Ensure the built-in "General" category always exists.
  if (!categories.some((c) => c.id === GENERAL_CATEGORY_ID)) {
    categories = [{ id: GENERAL_CATEGORY_ID, label: "General", isDefault: true, order: 0, createdAt: nowIso() }, ...categories];
  }

  // Drop any item missing its required category id.
  const items = allItems.filter((it) => typeof it.categoryId === "string");

  for (const it of items) {
    if (typeof it.archived !== "boolean") {
      it.archived = false;
    }
    // An unknown priority (hand-edited file, newer format) is dropped rather
    // than guessed, so the note reads as unassigned. A missing key is never added.
    if ("priority" in it && !isPriority(it.priority)) {
      delete it.priority;
    }
    // An invalid or out-of-workspace link is dropped; a valid one is rebuilt clean.
    if ("link" in it) {
      const link = sanitizeLink(it.link);
      if (link) {
        it.link = link;
      } else {
        delete it.link;
      }
    }
    // Tasks are cleaned entry by entry; an empty or invalid list removes the key.
    if ("tasks" in it) {
      const tasks = sanitizeTasks(it.tasks);
      if (tasks) {
        it.tasks = tasks;
      } else {
        delete it.tasks;
      }
    }
  }
  const workPauseNote = normalizeWorkPauseNote(obj.workPauseNote);
  return {
    version: typeof obj.version === "number" ? obj.version : DATA_VERSION,
    types,
    categories,
    items,
    // Last key of the file; never added when absent.
    ...(workPauseNote ? { workPauseNote } : {}),
  };
}

function errorDetail(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\.+$/, "");
}

export function unreadableProblem(err: unknown): StorageProblem {
  return {
    kind: "unreadable",
    message: `MindStream cannot read its data file (${DATA_FILE_LABEL}): ${errorDetail(err)}.`,
    howToFix: `Close any program that may be locking the file, then return to VS Code or run "MindStream: Refresh".`,
  };
}

function invalidProblem(detail: string): StorageProblem {
  return {
    kind: "invalid",
    message: `MindStream's data file (${DATA_FILE_LABEL}) is not valid: ${detail}.`,
    howToFix: "Fix or restore the file (for example from Git). MindStream reloads it as soon as it changes.",
  };
}

/** The message of a save refused because of `problem`. */
export function blockedSaveMessage(problem: StorageProblem): string {
  return `Not saved: ${problem.message} Nothing was changed. ${problem.howToFix}`;
}

/** The message of a save that failed while writing. */
export function writeFailedMessage(err: unknown): string {
  return `Not saved: MindStream could not write its data file (${DATA_FILE_LABEL}): ${errorDetail(err)}. Nothing was changed. Check that the folder is writable and the disk has free space, then try again.`;
}

/**
 * Parses raw backend text. No file and an empty file both mean a new project
 * (fresh default data). Anything that is not a JSON object is a problem, never
 * a reason to start over: replacing it would destroy the user's notes.
 */
export function parseDataText(raw: string | null): { data: MindStreamData } | { problem: StorageProblem } {
  // A byte order mark (added by some editors) is not part of the JSON.
  const text = raw === null ? "" : raw.replace(/^\uFEFF/, "");
  if (text.trim() === "") {
    return { data: createEmptyData() };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { problem: invalidProblem(`it is not valid JSON (${errorDetail(err)})`) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { problem: invalidProblem("it does not contain a MindStream data object") };
  }
  return { data: normalizeData(parsed) };
}

/**
 * The notification to show when the storage problem state changes, or
 * `undefined` when nothing needs to be said.
 */
export function describeStorageTransition(before: StorageProblem | undefined, after: StorageProblem | undefined): { level: "warning" | "info"; message: string } | undefined {
  // Compared by kind: a file being hand-edited fails with a new detail on every
  // save, which must not raise a new warning each time.
  if (after && after.kind !== before?.kind) {
    return {
      level: "warning",
      message: `MindStream: ${after.message} Saving is turned off until this is fixed, so the file is never overwritten. ${after.howToFix}`,
    };
  }
  if (before && !after) {
    return { level: "info", message: "MindStream: The data file can be read again. Saving is back on." };
  }
  return undefined;
}

/** Reads a file, returning `null` only when it does not exist. Any other failure is thrown. */
function readIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * JSON-file based storage inside the workspace: `.vscode/mindstream.data.json`.
 * Writes happen safely (temporary file then rename) to avoid data corruption.
 *
 * A file that exists but cannot be read, or does not hold valid data, sets a
 * `StorageProblem`: the last good data stays in memory and every save is
 * refused until the file is fixed, so the user's notes are never replaced.
 */
export class StorageService implements IStorage {
  private data: MindStreamData;
  /** Raw text of the backend content as of the last successful load/save, used to
   *  detect whether a later `reloadIfExternal()` call sees a genuinely external
   *  change or just an echo of this instance's own write. */
  private lastKnownText: string | null = null;
  /** Serialized form of the data that matches the file; restored when a save fails. */
  private committedText: string;
  private problem: StorageProblem | undefined;

  private constructor(private readonly backend: StorageBackend) {
    this.data = createEmptyData();
    this.committedText = JSON.stringify(this.data);
    this.reloadIfExternal();
  }

  /** Creates a storage service bound to a given directory.
   *  Reads `.vscode/mindstream.data.json` inside it. */
  static forDir(dirPath: string): StorageService {
    const file = path.join(dirPath, ".vscode", "mindstream.data.json");
    return new StorageService({
      load: () => readIfExists(file),
      save: (text: string) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        try {
          fs.writeFileSync(tmp, text, "utf8");
          renameWithRetry(tmp, file);
        } catch (err) {
          // Leave nothing behind: the original file is untouched.
          fs.rmSync(tmp, { force: true });
          throw err;
        }
      },
    });
  }

  /** Creates a storage service from a given text (used in tests). */
  static fromText(initial: string | null): StorageService {
    return new StorageService({
      load: () => initial,
      save: () => {
        /* no-op for tests */
      },
    });
  }

  getData(): MindStreamData {
    return this.data;
  }

  getProblem(): StorageProblem | undefined {
    return this.problem;
  }

  saveData(data: MindStreamData): void {
    if (this.problem) {
      this.restore();
      throw new StorageError("STORAGE_BLOCKED", blockedSaveMessage(this.problem));
    }
    const text = JSON.stringify(data, null, 2);
    try {
      this.backend.save(text);
    } catch (err) {
      this.restore();
      throw new StorageError("WRITE_FAILED", writeFailedMessage(err));
    }
    this.data = data;
    this.lastKnownText = text;
    this.committedText = text;
  }

  reloadIfExternal(): boolean {
    let raw: string | null;
    try {
      raw = this.backend.load();
    } catch (err) {
      return this.setProblem(unreadableProblem(err));
    }
    if (raw === null) {
      // No file (not created yet, or deleted): the data in memory is kept and
      // written by the next save, so deleting the file never wipes the notes.
      // When the deleted file was the broken one, saving works again.
      const hadProblem = this.problem !== undefined;
      this.problem = undefined;
      this.lastKnownText = null;
      return hadProblem;
    }
    if (raw === this.lastKnownText) {
      // Identical to what this instance last read/wrote: either nothing
      // changed, or this is just an echo of our own write (e.g. a
      // FileSystemWatcher event firing for a save we just performed). The data
      // in memory matches it, so a problem left over (a file that was briefly
      // locked) is over.
      if (this.problem) {
        this.problem = undefined;
        return true;
      }
      return false;
    }
    const parsed = parseDataText(raw);
    if ("problem" in parsed) {
      // The last good data stays in memory; nothing is saved until this is fixed.
      return this.setProblem(parsed.problem);
    }
    this.data = parsed.data;
    this.lastKnownText = raw;
    this.committedText = JSON.stringify(parsed.data);
    this.problem = undefined;
    return true;
  }

  /** Returns whether the problem differs from the current one. */
  private setProblem(problem: StorageProblem): boolean {
    const changed = problem.message !== this.problem?.message;
    this.problem = problem;
    return changed;
  }

  /** Puts the in-memory data back to the last saved (or loaded) state. */
  private restore(): void {
    this.data = JSON.parse(this.committedText) as MindStreamData;
  }
}
