import * as assert from "assert";
import { DEFAULT_DESCRIPTION_HEIGHT, MAX_DESCRIPTION_HEIGHT, MIN_DESCRIPTION_HEIGHT, UiPrefsMemento, UiPrefsRegistry, clampDescriptionHeight } from "../src/uiPrefs";

class FakeMemento implements UiPrefsMemento {
  private store = new Map<string, unknown>();
  get<T>(key: string, defaultValue: T): T {
    return (this.store.has(key) ? this.store.get(key) : defaultValue) as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }
}

describe("UiPrefsRegistry", () => {
  it("returns the default height when nothing is stored", () => {
    const registry = new UiPrefsRegistry(new FakeMemento());
    assert.strictEqual(registry.descriptionHeight(), DEFAULT_DESCRIPTION_HEIGHT);
  });

  it("setDescriptionHeight clamps below the minimum", async () => {
    const registry = new UiPrefsRegistry(new FakeMemento());
    await registry.setDescriptionHeight(10);
    assert.strictEqual(registry.descriptionHeight(), MIN_DESCRIPTION_HEIGHT);
  });

  it("setDescriptionHeight clamps above the maximum", async () => {
    const registry = new UiPrefsRegistry(new FakeMemento());
    await registry.setDescriptionHeight(10000);
    assert.strictEqual(registry.descriptionHeight(), MAX_DESCRIPTION_HEIGHT);
  });

  it("setDescriptionHeight rounds fractional values", async () => {
    const registry = new UiPrefsRegistry(new FakeMemento());
    await registry.setDescriptionHeight(201.6);
    assert.strictEqual(registry.descriptionHeight(), 202);
  });

  it("setDescriptionHeight falls back to the default on invalid input", async () => {
    const registry = new UiPrefsRegistry(new FakeMemento());
    await registry.setDescriptionHeight(undefined);
    assert.strictEqual(registry.descriptionHeight(), DEFAULT_DESCRIPTION_HEIGHT);
  });

  it("persists and reads back the stored height", async () => {
    const registry = new UiPrefsRegistry(new FakeMemento());
    await registry.setDescriptionHeight(300);
    assert.strictEqual(registry.descriptionHeight(), 300);
  });
});

describe("clampDescriptionHeight", () => {
  it("clamps to the valid range and falls back on invalid input", () => {
    assert.strictEqual(clampDescriptionHeight(300), 300);
    assert.strictEqual(clampDescriptionHeight(MIN_DESCRIPTION_HEIGHT - 1), MIN_DESCRIPTION_HEIGHT);
    assert.strictEqual(clampDescriptionHeight(MAX_DESCRIPTION_HEIGHT + 1), MAX_DESCRIPTION_HEIGHT);
    assert.strictEqual(clampDescriptionHeight("abc"), DEFAULT_DESCRIPTION_HEIGHT);
    assert.strictEqual(clampDescriptionHeight(NaN), DEFAULT_DESCRIPTION_HEIGHT);
  });
});
