/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import { Platform, normalizeFolder } from "./workspaceMatch";

/** Version of the file shape and of the inner `/call` contract. Windows of different versions refuse each other. */
export const PROTOCOL_VERSION = 1;

/** One window's entry. It never holds the token. */
export interface RegistryEntry {
  protocol: number;
  /** Absolute path of the window's workspace folder. */
  folder: string;
  /** The window's inner server, on 127.0.0.1. */
  port: number;
  pid: number;
  /** Milliseconds since the epoch; the newest live entry of a folder wins. */
  startedAt: number;
}

export interface RouterRegistryOptions {
  /** The directory shared by every window of this extension on this machine. */
  dir: string;
  platform: Platform;
  /** Whether a process still runs. Injected so a test can say a pid is dead. */
  isAlive: (pid: number) => boolean;
  /** This window's process id and clock; injectable. */
  pid?: number;
  now?: () => number;
}

/** True when a process with this id exists (signal 0 only checks; `EPERM` means it exists but is not ours). */
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isEntry(value: unknown): value is RegistryEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    Number.isInteger(v.protocol) &&
    typeof v.folder === "string" &&
    v.folder !== "" &&
    Number.isInteger(v.port) &&
    (v.port as number) > 0 &&
    (v.port as number) < 65536 &&
    Number.isInteger(v.pid) &&
    typeof v.startedAt === "number"
  );
}

/**
 * The registry directory of the workspace router: one small JSON file per
 * window. It is not the notes data file, so `IStorage` and its save guard do
 * not apply; this class uses `fs` directly and never throws on a bad file.
 */
export class RouterRegistry {
  private readonly ownFile: string;
  private readonly pid: number;
  private readonly now: () => number;
  private cache: RegistryEntry[] | undefined;
  private watcher: fs.FSWatcher | undefined;

  constructor(private readonly options: RouterRegistryOptions) {
    this.pid = options.pid ?? process.pid;
    this.now = options.now ?? Date.now;
    this.ownFile = path.join(options.dir, `window-${this.pid}.json`);
  }

  /** Writes this window's entry atomically (a temporary file, then a rename) and refreshes the cache. */
  register(folder: string, port: number): RegistryEntry {
    const entry: RegistryEntry = { protocol: PROTOCOL_VERSION, folder, port, pid: this.pid, startedAt: this.now() };
    fs.mkdirSync(this.options.dir, { recursive: true });
    const temporary = `${this.ownFile}.${this.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(entry), "utf8");
    try {
      fs.renameSync(temporary, this.ownFile);
    } catch (err) {
      fs.rmSync(temporary, { force: true });
      throw err;
    }
    this.cache = undefined;
    return entry;
  }

  /** Removes this window's entry. Safe to call when it was never written. */
  unregister(): void {
    this.stopWatching();
    fs.rmSync(this.ownFile, { force: true });
    this.cache = undefined;
  }

  /**
   * The live entries, the newest per folder. An entry whose process is gone, or
   * that cannot be read, is ignored; a dead one's file is deleted.
   */
  liveEntries(forceRead = false): RegistryEntry[] {
    if (this.cache && !forceRead) {
      return this.cache;
    }
    const newest = new Map<string, RegistryEntry>();
    for (const { entry, file } of this.readAll()) {
      if (!this.options.isAlive(entry.pid)) {
        fs.rmSync(file, { force: true });
        continue;
      }
      const key = normalizeFolder(entry.folder, this.options.platform);
      const known = newest.get(key);
      if (!known || entry.startedAt > known.startedAt) {
        newest.set(key, entry);
      }
    }
    this.cache = [...newest.values()];
    return this.cache;
  }

  /** Forgets an entry whose inner server did not answer: its file is deleted (when it is another window's) and the cache dropped. */
  drop(entry: RegistryEntry): void {
    fs.rmSync(path.join(this.options.dir, `window-${entry.pid}.json`), { force: true });
    this.cache = undefined;
  }

  /** Drops the cache whenever the directory changes, so the next read sees the new entries. Never throws. */
  watch(): void {
    if (this.watcher) {
      return;
    }
    try {
      fs.mkdirSync(this.options.dir, { recursive: true });
      this.watcher = fs.watch(this.options.dir, () => {
        this.cache = undefined;
      });
      this.watcher.on("error", () => this.stopWatching());
    } catch {
      this.watcher = undefined;
    }
  }

  stopWatching(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  private readAll(): { entry: RegistryEntry; file: string }[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.options.dir);
    } catch {
      return [];
    }
    const found: { entry: RegistryEntry; file: string }[] = [];
    for (const name of names) {
      if (!/^window-\d+\.json$/.test(name)) {
        continue;
      }
      const file = path.join(this.options.dir, name);
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (isEntry(parsed)) {
          found.push({ entry: parsed, file });
        }
      } catch {
        // A file being replaced, or not valid JSON: ignored, never fatal.
      }
    }
    return found;
  }
}
