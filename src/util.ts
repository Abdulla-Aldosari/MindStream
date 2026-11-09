import { randomUUID } from "crypto";

/** Generates a unique id for every item/type. */
export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Body class applied to the sidebar webview so a visual marker (see
 * media/sidebar.css) can distinguish the extension running from the source
 * tree (Extension Development Host) from a VSIX-installed build.
 */
export function getBodyClass(isDevMode: boolean): string {
  return isDevMode ? "dev-mode" : "";
}

/**
 * True when the extension host was launched by `demo/scripts/make-demo.mjs`
 * (which sets `MINDSTREAM_DEMO=1`) to capture screenshots/GIFs. Such runs
 * must not render the `dev-mode` visual marker, so callers treat them as
 * non-dev even though they still run through the Extension Development Host.
 */
export function isDemoCapture(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MINDSTREAM_DEMO === "1";
}

/**
 * Returns a debounced wrapper around `fn`: repeated calls made within
 * `delayMs` of each other collapse into a single trailing call with the
 * arguments of the last invocation. Used to coalesce bursts of filesystem
 * events (e.g. a temp-file-then-rename write producing multiple watcher
 * events for one logical save) into one handler run.
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, delayMs: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delayMs);
  };
}
