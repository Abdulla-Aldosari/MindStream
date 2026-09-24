import { randomUUID } from 'crypto';

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
  return isDevMode ? 'dev-mode' : '';
}
