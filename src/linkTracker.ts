import { ItemsStore } from "./itemsStore";
import { MindStreamLink } from "./models";
import { LineEdit, markLinkMissingForPath, normalizeLines, renameLinkPath, resolveLink, ResolvedLink, shiftLinkForEdits } from "./linkResolver";

/** Reads a workspace file as lines (`null` when it does not exist). Injected so the tracker stays free of `vscode`. */
export interface LinkFiles {
  readLines(relPath: string): Promise<string[] | null>;
}

function sameLink(a: MindStreamLink, b: MindStreamLink): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Keeps note links pointing at the right code while files are edited, renamed,
 * moved, or deleted. Event-driven methods (`applyEdits`, `applyRename`,
 * `applyDelete`) are synchronous and cheap; `resolveItem`/`refreshAll` re-read
 * files and re-find the code from its anchor, which also covers changes made
 * outside the editor (git, terminal, other tools).
 */
export class LinkTracker {
  constructor(
    private readonly items: ItemsStore,
    private readonly files: LinkFiles
  ) {}

  /** True when in-memory link shifts have not been written to disk yet (see `flush`). */
  private dirty = false;

  /**
   * Moves links in `relPath` when lines were added/removed above them. Returns
   * whether anything changed. This runs on every keystroke, so it is cheap:
   * edits that keep the line count return immediately, and shifts are applied
   * in memory only. Call `flush()` (usually through a `SaveScheduler`) to write
   * them. A lost shift is harmless: `resolveItem`/`refreshAll` re-find the code.
   */
  applyEdits(relPath: string, edits: LineEdit[]): boolean {
    if (edits.every((e) => e.addedLines === e.endLine - e.startLine)) {
      return false;
    }
    const changed = this.items.mapLinks((link) => (link.filePath === relPath ? shiftLinkForEdits(link, edits) : link), false) > 0;
    this.dirty = this.dirty || changed;
    return changed;
  }

  /** Writes pending in-memory shifts. Returns whether a write happened. */
  flush(): boolean {
    if (!this.dirty) {
      return false;
    }
    this.dirty = false;
    this.items.save();
    return true;
  }

  /** Follows a file/folder rename or move. */
  applyRename(oldPath: string, newPath: string): boolean {
    return this.items.mapLinks((link) => renameLinkPath(link, oldPath, newPath)) > 0;
  }

  /** Marks links under a deleted file/folder as missing (the note itself is never touched). */
  applyDelete(removedPath: string): boolean {
    return this.items.mapLinks((link) => markLinkMissingForPath(link, removedPath)) > 0;
  }

  /** Re-resolves one note's link against the current file content and stores the result. */
  async resolveItem(id: string): Promise<ResolvedLink | undefined> {
    const link = this.items.get(id)?.link;
    if (!link) {
      return undefined;
    }
    const lines = await this.files.readLines(link.filePath);
    // The note may have been edited or deleted while the file was being read.
    const current = this.items.get(id)?.link;
    if (!current || current.filePath !== link.filePath) {
      return undefined;
    }
    const resolved = resolveLink(current, lines);
    if (!sameLink(resolved.link, current)) {
      this.items.setLink(id, resolved.link);
    }
    return resolved;
  }

  /** Re-resolves every linked note (each file is read once). Returns whether any link changed. */
  async refreshAll(): Promise<boolean> {
    const linked = this.items.list(true).filter((it) => it.link);
    // Each file is read and normalized once, however many links point into it.
    const cache = new Map<string, { lines: string[]; norm: string[] } | null>();
    let changed = false;
    for (const item of linked) {
      const path = item.link!.filePath;
      if (!cache.has(path)) {
        const lines = await this.files.readLines(path);
        cache.set(path, lines ? { lines, norm: normalizeLines(lines) } : null);
      }
      const current = this.items.get(item.id)?.link;
      if (!current || current.filePath !== path) {
        continue;
      }
      const file = cache.get(path) ?? null;
      const resolved = resolveLink(current, file ? file.lines : null, file ? file.norm : undefined);
      if (!sameLink(resolved.link, current)) {
        this.items.setLink(item.id, resolved.link);
        changed = true;
      }
    }
    return changed;
  }
}
