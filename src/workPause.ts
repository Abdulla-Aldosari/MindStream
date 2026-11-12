import { MindStreamWorkPauseNote } from "./models";

/**
 * Pure rules of the Work Pause feature (no `vscode`, no storage), so they can be
 * unit-tested directly. The persisted shape is `MindStreamData.workPauseNote`.
 */

/** VS Code context key that is true while work is paused (drives `when` clauses). */
export const WORK_PAUSE_CONTEXT_KEY = "mindstream.workPaused";

/** Longest note text (characters) that is stored. */
export const MAX_WORK_PAUSE_TEXT = 10000;

/** Webview messages that still work while work is paused; everything else is ignored. */
const ALLOWED_WHILE_PAUSED: ReadonlySet<string> = new Set(["refresh", "saveWorkPauseNote", "confirmDiscardWorkPauseDraft"]);

export function isAllowedDuringWorkPause(messageType: string): boolean {
  return ALLOWED_WHILE_PAUSED.has(messageType);
}

/**
 * Wraps a command handler so it does nothing while work is paused. This is the
 * programmatic half of the lock: the `when`/`enablement` clauses in
 * package.json hide and disable the commands in the UI, but a command can
 * still be run by id (another extension, a user keybinding).
 */
export function guardWhenWorkPaused(isPaused: () => boolean) {
  return <A extends unknown[], R>(handler: (...args: A) => R) =>
    (...args: A): R | undefined =>
      isPaused() ? undefined : handler(...args);
}

/**
 * Coerces any raw value into a valid Work Pause note, or `undefined` when it is
 * not an object (the key is then dropped). Invalid parts fall back to empty
 * values, and work can only be paused while the note has text: a lock without
 * content would trap the user.
 */
export function normalizeWorkPauseNote(raw: unknown): MindStreamWorkPauseNote | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.slice(0, MAX_WORK_PAUSE_TEXT) : "";
  const updatedAt = typeof obj.updatedAt === "string" && !isNaN(Date.parse(obj.updatedAt)) ? obj.updatedAt : "";
  const paused = obj.paused === true && text.trim().length > 0;
  return { text, updatedAt, paused };
}
