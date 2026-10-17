import * as assert from "assert";
import { DEFAULT_EMOJI_PALETTE, EmojiMemento, EmojiRegistry, MAX_EMOJI_RECENTS, normalizePalette } from "../src/emojiRegistry";

class FakeMemento implements EmojiMemento {
  private store = new Map<string, unknown>();
  get<T>(key: string, defaultValue: T): T {
    return (this.store.has(key) ? this.store.get(key) : defaultValue) as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }
}

describe("EmojiRegistry", () => {
  it("returns the default palette and empty recents when nothing is stored", () => {
    const registry = new EmojiRegistry(new FakeMemento());
    assert.deepStrictEqual(registry.palette(), DEFAULT_EMOJI_PALETTE);
    assert.deepStrictEqual(registry.recents(), []);
  });

  it("recordUse puts the emoji first and dedupes", async () => {
    const registry = new EmojiRegistry(new FakeMemento());
    await registry.recordUse("📌");
    await registry.recordUse("✅");
    await registry.recordUse("📌");
    assert.deepStrictEqual(registry.recents(), ["📌", "✅"]);
  });

  it("recordUse caps the recents list", async () => {
    const registry = new EmojiRegistry(new FakeMemento());
    for (let i = 0; i < MAX_EMOJI_RECENTS + 5; i++) {
      await registry.recordUse(`e${i}`);
    }
    assert.strictEqual(registry.recents().length, MAX_EMOJI_RECENTS);
    assert.strictEqual(registry.recents()[0], `e${MAX_EMOJI_RECENTS + 4}`);
  });

  it("recordUse ignores blank emoji", async () => {
    const registry = new EmojiRegistry(new FakeMemento());
    await registry.recordUse("   ");
    assert.deepStrictEqual(registry.recents(), []);
  });

  it("setPalette normalizes, trims, and dedupes", async () => {
    const registry = new EmojiRegistry(new FakeMemento());
    await registry.setPalette(["📌", "  ", "✅", "📌", "📖"]);
    assert.deepStrictEqual(registry.palette(), ["📌", "✅", "📖"]);
  });

  it("setPalette keeps existing recents", async () => {
    const registry = new EmojiRegistry(new FakeMemento());
    await registry.recordUse("📌");
    await registry.setPalette(["✅"]);
    assert.deepStrictEqual(registry.recents(), ["📌"]);
  });
});

describe("normalizePalette", () => {
  it("removes duplicates preserving order", () => {
    assert.deepStrictEqual(normalizePalette(["a", "b", "a", "c"]), ["a", "b", "c"]);
  });

  it("drops empty and whitespace-only entries", () => {
    assert.deepStrictEqual(normalizePalette(["", "  ", "a"]), ["a"]);
  });
});
