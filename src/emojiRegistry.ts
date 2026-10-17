/**
 * Global (per-user, shared across every workspace) emoji palette and recent
 * usage tracking for the note editor. Backed by a tiny `EmojiMemento`
 * abstraction so the registry can be unit-tested without importing `vscode`;
 * the real adapter is wired up in `extension.ts` against
 * `context.globalState`.
 */

export interface EmojiMemento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Promise<void>;
}

/** Storage key under VS Code `globalState` for the shared emoji state. */
export const EMOJI_STATE_KEY = "mindstream.emoji";

/** Maximum number of recently-used emojis shown in the picker's first row. */
export const MAX_EMOJI_RECENTS = 12;

export interface MindStreamEmojiState {
  palette: string[];
  recents: string[];
}

/**
 * Curated, developer-focused default palette. Face expressions are limited to
 * a small handful; decorative/food/vehicle/flags/hearts emoji are excluded.
 */
export const DEFAULT_EMOJI_PALETTE: string[] = [
  // Books & documents
  "📖",
  "📚",
  "📝",
  "📄",
  "📑",
  "📕",
  "📗",
  "📘",
  "📙",
  // Action / status
  "✅",
  "❌",
  "⚠️",
  "❗",
  "❓",
  "✔️",
  "✖️",
  "➕",
  "➖",
  "🔄",
  "⏳",
  "🎯",
  "📌",
  "📍",
  "🔖",
  "🏷️",
  // Alerts / errors
  "🐛",
  "🔥",
  "💥",
  "🚨",
  "⚡",
  // Development
  "💡",
  "🔧",
  "🔨",
  "🛠️",
  "⚙️",
  "🧪",
  "🔬",
  "💻",
  "🖥️",
  "⌨️",
  "🖱️",
  "🗄️",
  "🧩",
  "🧱",
  "📦",
  "🗂️",
  "🔒",
  "🔑",
  "🚀",
  "⭐",
  "🌟",
  // Communication
  "💬",
  "💭",
  "✉️",
  "📧",
  "📬",
  // Time / scheduling
  "⏰",
  "📅",
  "📆",
  "🗓️",
  "⏱️",
  "⌛",
  // Flow / arrows
  "➡️",
  "⬅️",
  "⬆️",
  "⬇️",
  "🔀",
  "🔁",
  "📊",
  "📈",
  "📉",
  "🔍",
  // A small, deliberate set of face expressions
  "🤔",
  "😀",
  "😅",
  "😬",
];

/**
 * Normalizes a palette: keeps only non-empty strings, trims them, and removes
 * duplicates while preserving order.
 */
export function normalizePalette(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const emoji = String(raw).trim();
    if (!emoji || seen.has(emoji)) {
      continue;
    }
    seen.add(emoji);
    out.push(emoji);
  }
  return out;
}

export class EmojiRegistry {
  constructor(private readonly memento: EmojiMemento) {}

  state(): MindStreamEmojiState {
    const stored = this.memento.get<Partial<MindStreamEmojiState>>(EMOJI_STATE_KEY, {});
    return {
      palette: normalizePalette(stored.palette ?? DEFAULT_EMOJI_PALETTE),
      recents: normalizePalette(stored.recents ?? []),
    };
  }

  palette(): string[] {
    return this.state().palette;
  }

  recents(): string[] {
    return this.state().recents;
  }

  async recordUse(emoji: string): Promise<void> {
    const trimmed = String(emoji).trim();
    if (!trimmed) {
      return;
    }
    const current = this.state();
    const recents = [trimmed, ...current.recents.filter((e) => e !== trimmed)].slice(0, MAX_EMOJI_RECENTS);
    await this.memento.update(EMOJI_STATE_KEY, { palette: current.palette, recents });
  }

  async setPalette(list: string[]): Promise<void> {
    const palette = normalizePalette(list);
    const current = this.state();
    await this.memento.update(EMOJI_STATE_KEY, { palette, recents: current.recents });
  }
}
