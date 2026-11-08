/**
 * Global (per-user, shared across every workspace) UI preferences for the
 * webview. Backed by a tiny `UiPrefsMemento` abstraction so the registry can
 * be unit-tested without importing `vscode`; the real adapter is wired up in
 * `extension.ts` against `context.globalState`.
 */

export interface UiPrefsMemento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Promise<void>;
}

/** Storage key under VS Code `globalState` for shared UI preferences. */
export const UI_PREFS_KEY = "mindstream.ui";

/** Default height (px) of the description textarea in the note editor. */
export const DEFAULT_DESCRIPTION_HEIGHT = 128;

/** Smallest height (px) the description textarea can be resized to. */
export const MIN_DESCRIPTION_HEIGHT = 55;

/** Largest height (px) we persist for the description textarea. */
export const MAX_DESCRIPTION_HEIGHT = 600;

export interface MindStreamUiPrefs {
  descriptionHeight: number;
}

/**
 * Coerces any raw value into a valid description height: an integer within the
 * allowed range. Invalid input falls back to the default height.
 */
export function clampDescriptionHeight(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) {
    return DEFAULT_DESCRIPTION_HEIGHT;
  }
  return Math.min(MAX_DESCRIPTION_HEIGHT, Math.max(MIN_DESCRIPTION_HEIGHT, n));
}

export class UiPrefsRegistry {
  constructor(private readonly memento: UiPrefsMemento) {}

  state(): MindStreamUiPrefs {
    const stored = this.memento.get<Partial<MindStreamUiPrefs>>(UI_PREFS_KEY, {});
    return { descriptionHeight: clampDescriptionHeight(stored.descriptionHeight) };
  }

  descriptionHeight(): number {
    return this.state().descriptionHeight;
  }

  async setDescriptionHeight(value: unknown): Promise<void> {
    const descriptionHeight = clampDescriptionHeight(value);
    await this.memento.update(UI_PREFS_KEY, { descriptionHeight });
  }
}
