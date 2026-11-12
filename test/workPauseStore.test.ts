import * as assert from "assert";
import { createEmptyData } from "../src/storage";
import { WorkPauseStore } from "../src/workPauseStore";
import { MAX_WORK_PAUSE_TEXT } from "../src/workPause";
import { InMemoryStorage } from "./helpers";

function setup() {
  const storage = new InMemoryStorage(createEmptyData());
  let clock = 0;
  const store = new WorkPauseStore(storage, () => `2026-11-11T10:00:0${clock++}.000Z`);
  return { storage, store };
}

describe("WorkPauseStore", () => {
  it("reads as empty and not paused before the first save, without touching the file", () => {
    const { storage, store } = setup();
    assert.deepStrictEqual(store.get(), { text: "", updatedAt: "", paused: false });
    assert.strictEqual(store.isPaused(), false);
    assert.strictEqual(storage.saved.length, 0);
    assert.ok(!("workPauseNote" in storage.getData()));
  });

  it("save trims the text, stamps updatedAt, and stores it under workPauseNote", () => {
    const { storage, store } = setup();
    assert.strictEqual(store.save("  Stopped at line 84  "), true);
    assert.deepStrictEqual(store.get(), { text: "Stopped at line 84", updatedAt: "2026-11-11T10:00:00.000Z", paused: false });
    assert.deepStrictEqual(storage.getData().workPauseNote, store.get());
  });

  it("save rejects blank and non-string input and changes nothing", () => {
    const { storage, store } = setup();
    for (const bad of ["", "   \n ", undefined, null, 5, {}]) {
      assert.strictEqual(store.save(bad), false);
    }
    assert.strictEqual(storage.saved.length, 0);
  });

  it("save keeps updatedAt when the text did not change", () => {
    const { store } = setup();
    store.save("same");
    const first = store.get().updatedAt;
    store.save("same");
    assert.strictEqual(store.get().updatedAt, first);
    store.save("different");
    assert.notStrictEqual(store.get().updatedAt, first);
  });

  it("save caps the stored text", () => {
    const { store } = setup();
    store.save("x".repeat(MAX_WORK_PAUSE_TEXT + 10));
    assert.strictEqual(store.get().text.length, MAX_WORK_PAUSE_TEXT);
  });

  it("save(…, true) saves and pauses in one write", () => {
    const { storage, store } = setup();
    assert.strictEqual(store.save("Go", true), true);
    assert.strictEqual(store.isPaused(), true);
    assert.strictEqual(storage.saved.length, 1);
  });

  it("save without pause keeps the current paused flag", () => {
    const { store } = setup();
    store.save("one", true);
    store.save("two");
    assert.strictEqual(store.isPaused(), true);
    assert.strictEqual(store.get().text, "two");
  });

  it("pause refuses when there is no text and work keeps running", () => {
    const { storage, store } = setup();
    assert.strictEqual(store.pause(), false);
    assert.strictEqual(store.isPaused(), false);
    assert.strictEqual(storage.saved.length, 0);
  });

  it("pause locks once, and resume unlocks but keeps the text", () => {
    const { storage, store } = setup();
    store.save("Keep me");
    assert.strictEqual(store.pause(), true);
    assert.strictEqual(store.pause(), true);
    assert.strictEqual(storage.saved.length, 2);
    store.resume();
    assert.strictEqual(store.isPaused(), false);
    assert.strictEqual(store.get().text, "Keep me");
    store.resume();
    assert.strictEqual(storage.saved.length, 3);
  });

  it("does not touch notes, types, or categories", () => {
    const { storage, store } = setup();
    const before = JSON.stringify({ t: storage.getData().types, c: storage.getData().categories, i: storage.getData().items });
    store.save("note", true);
    const after = JSON.stringify({ t: storage.getData().types, c: storage.getData().categories, i: storage.getData().items });
    assert.strictEqual(after, before);
  });

  it("treats a corrupt stored note as empty and not paused", () => {
    const { storage, store } = setup();
    (storage.getData() as unknown as Record<string, unknown>).workPauseNote = { text: "", paused: true };
    assert.strictEqual(store.isPaused(), false);
  });
});
