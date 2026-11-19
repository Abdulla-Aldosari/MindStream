/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

/**
 * Values of the two settings that decide what happens to unsaved text when the
 * note form or its description tab is closed. Pure (no `vscode`), so the
 * fallbacks are unit-tested; the readers live in `SidebarProvider` and
 * `extension.ts`.
 */

/** `mindstream.descriptionTab.onClose`: what closing the description tab does to edits that were not saved with Ctrl+S. */
export type TabCloseBehavior = "keep" | "ask";

/** `mindstream.noteForm.onCloseWithChanges`: what closing the note form does when a field was changed. */
export type FormCloseBehavior = "ask" | "discard";

export const DEFAULT_TAB_CLOSE_BEHAVIOR: TabCloseBehavior = "keep";
export const DEFAULT_FORM_CLOSE_BEHAVIOR: FormCloseBehavior = "ask";

/** Any value other than `"ask"` (missing, misspelled, wrong type) keeps the edits. */
export function normalizeTabCloseBehavior(value: unknown): TabCloseBehavior {
  return value === "ask" ? "ask" : DEFAULT_TAB_CLOSE_BEHAVIOR;
}

/** Any value other than `"discard"` asks first, so a bad setting never loses text silently. */
export function normalizeFormCloseBehavior(value: unknown): FormCloseBehavior {
  return value === "discard" ? "discard" : DEFAULT_FORM_CLOSE_BEHAVIOR;
}
