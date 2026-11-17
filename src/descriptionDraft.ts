/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

/**
 * Pure rules of the "edit the description in an editor tab" feature (no
 * `vscode`), so they can be unit-tested directly. At most one draft exists: the
 * description of the note form that is open in the sidebar.
 *
 * A draft keeps two texts on purpose:
 * - `saved` is what the virtual file holds. It only changes when the user saves
 *   the tab, so VS Code never sees the file change under a dirty editor (which
 *   would raise a "file modified since" conflict on the next save).
 * - `live` is what the note form uses. It follows every edit made in the tab.
 */

/** URI scheme of the virtual files that hold a description draft. */
export const DESCRIPTION_SCHEME = "mindstream-desc";

const MAX_FILE_STEM_LENGTH = 60;
const FALLBACK_FILE_STEM = "Note description";
const RESERVED_FILE_CHARS = '\\/:*?"<>|';

export interface DescriptionDraftInfo {
  id: number;
  /** Path of the virtual file: `/<id>/<file name>`. */
  path: string;
}

interface ActiveDraft extends DescriptionDraftInfo {
  saved: string;
  live: string;
  mtime: number;
}

/** Line breaks as the note form stores them: LF only (an editor may use CRLF). */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * The tab title for a note: its title made safe as a file name, with the
 * `.md` extension. Markdown is chosen because VS Code wraps long lines in
 * Markdown files by default, which is what a large description needs.
 */
export function draftFileName(title: string | undefined): string {
  const safe = Array.from(title ?? "")
    .map((ch) => (ch.charCodeAt(0) < 32 || RESERVED_FILE_CHARS.includes(ch) ? "-" : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const stem = Array.from(safe).slice(0, MAX_FILE_STEM_LENGTH).join("").trim();
  return `${stem || FALLBACK_FILE_STEM}.md`;
}

export class DescriptionDraft {
  private active: ActiveDraft | undefined;
  private nextId = 1;
  private clock = Date.now();

  /** Starts a draft with `text` (replacing any draft that is open). */
  open(title: string | undefined, text: string): DescriptionDraftInfo {
    const id = this.nextId++;
    const path = `/${id}/${draftFileName(title)}`;
    this.active = { id, path, saved: text, live: normalizeEol(text), mtime: ++this.clock };
    return { id, path };
  }

  info(): DescriptionDraftInfo | undefined {
    return this.active ? { id: this.active.id, path: this.active.path } : undefined;
  }

  isOpen(): boolean {
    return this.active !== undefined;
  }

  /** The text the note form should use, or `undefined` when no draft is open. */
  liveText(): string | undefined {
    return this.active?.live;
  }

  /** The content of the virtual file at `path`. */
  savedText(path: string): string | undefined {
    return this.active?.path === path ? this.active.saved : undefined;
  }

  stat(path: string): { size: number; mtime: number } | undefined {
    if (!this.active || this.active.path !== path) {
      return undefined;
    }
    return { size: Buffer.byteLength(this.active.saved, "utf8"), mtime: this.active.mtime };
  }

  /** Records an edit made in the tab. Returns true when the live text changed. */
  setLive(path: string, text: string): boolean {
    if (!this.active || this.active.path !== path) {
      return false;
    }
    const live = normalizeEol(text);
    if (live === this.active.live) {
      return false;
    }
    this.active.live = live;
    return true;
  }

  /** Records that the tab was saved. Returns false when `path` is not the open draft. */
  save(path: string, text: string): boolean {
    if (!this.active || this.active.path !== path) {
      return false;
    }
    this.active.saved = text;
    this.active.live = normalizeEol(text);
    this.active.mtime = ++this.clock;
    return true;
  }

  close(): void {
    this.active = undefined;
  }
}
