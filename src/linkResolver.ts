import * as path from "path";
import { MindStreamLink, MindStreamLinkAnchor, MindStreamLinkState } from "./models";

/** Maximum number of range lines stored in an anchor. */
export const MAX_ANCHOR_LINES = 5;
const MAX_LINE_CHARS = 200;
const LINK_STATES: readonly MindStreamLinkState[] = ["ok", "changed", "missing"];

export type LinkOutcome = "ok" | "moved" | "changed" | "missing";

export interface ResolvedLink {
  link: MindStreamLink;
  outcome: LinkOutcome;
}

/** One text change in pre-change, 0-based line coordinates. */
export interface LineEdit {
  startLine: number;
  endLine: number;
  /** Number of line breaks in the inserted text. */
  addedLines: number;
}

/** Trims and caps a line so anchors stay small and indentation-insensitive. */
export function normalizeLine(text: string): string {
  return text.trim().slice(0, MAX_LINE_CHARS);
}

/** Returns the workspace-relative posix path, or undefined when the file is outside the workspace. */
export function toRelativePath(root: string, fsPath: string): string | undefined {
  const rel = path.relative(root, fsPath);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return undefined;
  }
  return rel.split(path.sep).join("/");
}

/** Normalizes every line of a file once, so several links in the same file share the work. */
export function normalizeLines(lines: string[]): string[] {
  return lines.map(normalizeLine);
}

function lineAt(norm: string[], index: number): string {
  return index >= 0 && index < norm.length ? norm[index] : "";
}

function createAnchor(norm: string[], lineStart: number, lineEnd: number): MindStreamLinkAnchor {
  const startIndex = lineStart - 1;
  const length = lineEnd - lineStart + 1;
  const text: string[] = [];
  for (let i = 0; i < Math.min(length, MAX_ANCHOR_LINES); i++) {
    text.push(lineAt(norm, startIndex + i));
  }
  const anchor: MindStreamLinkAnchor = { text, before: lineAt(norm, startIndex - 1), after: lineAt(norm, lineEnd) };
  // The head lines cannot tell where a long range stops, so its tail is stored too.
  if (length > MAX_ANCHOR_LINES) {
    anchor.endText = [];
    for (let i = MAX_ANCHOR_LINES; i > 0; i--) {
      anchor.endText.push(lineAt(norm, lineEnd - i));
    }
  }
  return anchor;
}

/**
 * Builds a link for a 1-based line range of a file. Returns undefined when the
 * file is outside the workspace or the range is invalid.
 */
export function buildLink(root: string, fsPath: string, lines: string[], lineStart: number, lineEnd: number): MindStreamLink | undefined {
  const filePath = toRelativePath(root, fsPath);
  if (!filePath || !Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 1 || lineEnd < lineStart) {
    return undefined;
  }
  const end = Math.min(lineEnd, Math.max(lines.length, lineStart));
  const link: MindStreamLink = { filePath, lineStart, anchor: createAnchor(normalizeLines(lines), lineStart, end), state: "ok" };
  if (end > lineStart) {
    link.lineEnd = end;
  }
  return link;
}

function rangeLength(link: MindStreamLink): number {
  return (link.lineEnd ?? link.lineStart) - link.lineStart + 1;
}

function matchesText(norm: string[], index: number, expected: string[]): boolean {
  if (index < 0 || index + expected.length > norm.length) {
    return false;
  }
  return expected.every((text, i) => norm[index + i] === text);
}

/**
 * A range of `length` lines starting at `index` fits the anchor when its head
 * matches and, for long ranges, its tail matches too. Returns the number of
 * matching context lines (0-2), or -1 when it does not fit.
 */
function fitScore(norm: string[], index: number, length: number, anchor: MindStreamLinkAnchor, blank: boolean): number {
  if (!matchesText(norm, index, anchor.text)) {
    return -1;
  }
  if (anchor.endText && !matchesText(norm, index + length - anchor.endText.length, anchor.endText)) {
    return -1;
  }
  const score = (lineAt(norm, index - 1) === anchor.before ? 1 : 0) + (lineAt(norm, index + length) === anchor.after ? 1 : 0);
  // A blank-only anchor says nothing by itself, so it also needs matching context.
  return blank && score < 1 ? -1 : score;
}

interface Candidate {
  index: number;
  length: number;
  score: number;
  distance: number;
}

function isBetter(a: Candidate, b: Candidate | undefined): boolean {
  return !b || a.score > b.score || (a.score === b.score && a.distance < b.distance);
}

/**
 * Range lengths worth testing at `index` (the head already matches there).
 * Short ranges (no stored tail) keep their length. Long ranges try every length
 * whose tail matches, found by one scan for the tail text.
 */
function candidateLengths(norm: string[], index: number, length: number, anchor: MindStreamLinkAnchor): number[] {
  const tail = anchor.endText;
  if (!tail) {
    return [length];
  }
  const lengths: number[] = [];
  for (let end = index + Math.max(anchor.text.length, tail.length); end <= norm.length; end++) {
    if (matchesText(norm, end - tail.length, tail)) {
      lengths.push(end - index);
    }
  }
  return lengths;
}

/**
 * Re-finds a link inside the current file content (`null` = file not found).
 * 1. The recorded range still fits: nothing changes.
 * 2. The same code exists elsewhere, or the range grew/shrank (its tail moved):
 *    the link follows it (best context, then nearest), updating `lineEnd` too.
 * 3. Otherwise the link keeps its position and is flagged `changed`.
 * `normalized` lets callers that resolve several links of one file normalize it once.
 */
export function resolveLink(link: MindStreamLink, lines: string[] | null, normalized?: string[]): ResolvedLink {
  if (lines === null) {
    return { link: { ...link, state: "missing" }, outcome: "missing" };
  }
  const anchor = link.anchor;
  if (!anchor || anchor.text.length === 0) {
    return { link: { ...link, state: "ok" }, outcome: "ok" };
  }
  const norm = normalized ?? normalizeLines(lines);
  const blank = anchor.text.every((t) => t === "") && (anchor.endText ?? []).every((t) => t === "");
  const originalIndex = link.lineStart - 1;
  const length = rangeLength(link);

  if (fitScore(norm, originalIndex, length, anchor, blank) >= 0) {
    return { link: { ...link, state: "ok" }, outcome: "ok" };
  }

  let best: Candidate | undefined;
  for (let index = 0; index + anchor.text.length <= norm.length; index++) {
    if (!matchesText(norm, index, anchor.text)) {
      continue;
    }
    for (const len of candidateLengths(norm, index, length, anchor)) {
      const score = fitScore(norm, index, len, anchor, blank);
      if (score < 0 || (index === originalIndex && len === length)) {
        continue;
      }
      const candidate = { index, length: len, score, distance: Math.abs(index - originalIndex) + Math.abs(len - length) };
      if (isBetter(candidate, best)) {
        best = candidate;
      }
    }
  }
  if (best) {
    const lineStart = best.index + 1;
    const lineEnd = lineStart + best.length - 1;
    const moved: MindStreamLink = { filePath: link.filePath, lineStart, anchor: createAnchor(norm, lineStart, lineEnd), state: "ok" };
    if (best.length > 1) {
      moved.lineEnd = lineEnd;
    }
    return { link: moved, outcome: "moved" };
  }
  return { link: { ...link, state: "changed" }, outcome: "changed" };
}

/**
 * Live tracking while a document is edited (all lines 0-based, pre-change):
 * - an edit entirely above the range moves the whole range;
 * - an edit entirely inside the range (after its first line) only moves its end;
 * - an edit touching the first line, crossing the range end, or covering it
 *   is left to `resolveLink`, which re-finds the code from its anchor.
 * Edits below the range never matter.
 */
export function shiftLinkForEdits(link: MindStreamLink, edits: LineEdit[]): MindStreamLink {
  const first = link.lineStart - 1;
  const last = (link.lineEnd ?? link.lineStart) - 1;
  let startDelta = 0;
  let endDelta = 0;
  for (const edit of edits) {
    const delta = edit.addedLines - (edit.endLine - edit.startLine);
    if (edit.endLine < first) {
      startDelta += delta;
      endDelta += delta;
    } else if (edit.startLine > first && edit.endLine <= last) {
      endDelta += delta;
    }
  }
  if (startDelta === 0 && endDelta === 0) {
    return link;
  }
  const lineStart = Math.max(1, link.lineStart + startDelta);
  const shifted: MindStreamLink = { ...link, lineStart };
  const lineEnd = Math.max(lineStart, (link.lineEnd ?? link.lineStart) + endDelta);
  if (lineEnd > lineStart) {
    shifted.lineEnd = lineEnd;
  } else {
    delete shifted.lineEnd;
  }
  return shifted;
}

function isUnder(filePath: string, target: string): boolean {
  return filePath === target || filePath.startsWith(`${target}/`);
}

/** Follows a file or folder rename/move. Returns the same object when unaffected. */
export function renameLinkPath(link: MindStreamLink, oldPath: string, newPath: string): MindStreamLink {
  if (!isUnder(link.filePath, oldPath)) {
    return link;
  }
  return { ...link, filePath: `${newPath}${link.filePath.slice(oldPath.length)}` };
}

/** Flags links under a deleted file or folder as missing. Returns the same object when unaffected. */
export function markLinkMissingForPath(link: MindStreamLink, removedPath: string): MindStreamLink {
  if (!isUnder(link.filePath, removedPath) || link.state === "missing") {
    return link;
  }
  return { ...link, state: "missing" };
}

function sanitizeAnchor(raw: unknown): MindStreamLinkAnchor | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const a = raw as Partial<MindStreamLinkAnchor>;
  if (!Array.isArray(a.text) || a.text.length === 0 || a.text.length > MAX_ANCHOR_LINES || !a.text.every((t) => typeof t === "string")) {
    return undefined;
  }
  const anchor: MindStreamLinkAnchor = {
    text: a.text.map(normalizeLine),
    before: typeof a.before === "string" ? normalizeLine(a.before) : "",
    after: typeof a.after === "string" ? normalizeLine(a.after) : "",
  };
  const tail = a.endText;
  if (Array.isArray(tail) && tail.length > 0 && tail.length <= MAX_ANCHOR_LINES && tail.every((t) => typeof t === "string")) {
    anchor.endText = tail.map(normalizeLine);
  }
  return anchor;
}

/**
 * Validates a link read from disk (hand-edited or imported data). The path must
 * stay inside the workspace, so a crafted file can never open anything else.
 */
export function sanitizeLink(raw: unknown): MindStreamLink | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const l = raw as Partial<MindStreamLink>;
  if (typeof l.filePath !== "string" || !l.filePath || l.filePath.includes("\\") || l.filePath.startsWith("/") || /^[a-zA-Z]:/.test(l.filePath)) {
    return undefined;
  }
  if (l.filePath.split("/").some((segment) => segment === ".." || segment === "")) {
    return undefined;
  }
  if (!Number.isInteger(l.lineStart) || (l.lineStart as number) < 1) {
    return undefined;
  }
  const link: MindStreamLink = {
    filePath: l.filePath,
    lineStart: l.lineStart as number,
    state: LINK_STATES.includes(l.state as MindStreamLinkState) ? (l.state as MindStreamLinkState) : "ok",
  };
  if (Number.isInteger(l.lineEnd) && (l.lineEnd as number) > link.lineStart) {
    link.lineEnd = l.lineEnd;
  }
  const anchor = sanitizeAnchor(l.anchor);
  if (anchor) {
    link.anchor = anchor;
  }
  return link;
}
