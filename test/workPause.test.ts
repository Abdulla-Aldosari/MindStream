import * as assert from "assert";
import { MAX_WORK_PAUSE_TEXT, guardWhenWorkPaused, isAllowedDuringWorkPause, normalizeWorkPauseNote } from "../src/workPause";

describe("guardWhenWorkPaused", () => {
  it("runs the handler with its arguments while the lock is off", () => {
    let active = false;
    const guard = guardWhenWorkPaused(() => active);
    const calls: number[][] = [];
    const run = guard((a: number, b: number) => {
      calls.push([a, b]);
      return a + b;
    });
    assert.strictEqual(run(1, 2), 3);
    active = true;
    assert.strictEqual(run(3, 4), undefined);
    assert.deepStrictEqual(calls, [[1, 2]]);
    active = false;
    assert.strictEqual(run(5, 6), 11);
  });

  it("reads the lock at call time, not at wrap time", () => {
    let active = true;
    const run = guardWhenWorkPaused(() => active)(() => "ran");
    assert.strictEqual(run(), undefined);
    active = false;
    assert.strictEqual(run(), "ran");
  });
});

describe("normalizeWorkPauseNote", () => {
  it("drops anything that is not a plain object", () => {
    for (const raw of [undefined, null, "text", 5, true, [], [{ text: "a" }]]) {
      assert.strictEqual(normalizeWorkPauseNote(raw), undefined);
    }
  });

  it("keeps a valid note as it is", () => {
    const raw = { text: "Stopped at line 84", updatedAt: "2026-11-11T10:00:00.000Z", paused: true };
    assert.deepStrictEqual(normalizeWorkPauseNote(raw), raw);
  });

  it("falls back to empty values for wrong field types", () => {
    assert.deepStrictEqual(normalizeWorkPauseNote({ text: 5, updatedAt: 7, paused: "yes" }), { text: "", updatedAt: "", paused: false });
  });

  it("rejects an unparsable date", () => {
    assert.strictEqual(normalizeWorkPauseNote({ text: "a", updatedAt: "not a date", paused: false })?.updatedAt, "");
  });

  it("never stays active without text", () => {
    assert.strictEqual(normalizeWorkPauseNote({ text: "", paused: true })?.paused, false);
    assert.strictEqual(normalizeWorkPauseNote({ text: "   \n ", paused: true })?.paused, false);
  });

  it("only accepts the boolean true as active", () => {
    assert.strictEqual(normalizeWorkPauseNote({ text: "a", paused: 1 })?.paused, false);
    assert.strictEqual(normalizeWorkPauseNote({ text: "a", paused: "true" })?.paused, false);
  });

  it("caps the text length", () => {
    const note = normalizeWorkPauseNote({ text: "x".repeat(MAX_WORK_PAUSE_TEXT + 50), paused: false });
    assert.strictEqual(note?.text.length, MAX_WORK_PAUSE_TEXT);
  });
});

describe("isAllowedDuringWorkPause", () => {
  it("allows only the messages the note itself needs", () => {
    assert.strictEqual(isAllowedDuringWorkPause("refresh"), true);
    assert.strictEqual(isAllowedDuringWorkPause("saveWorkPauseNote"), true);
    assert.strictEqual(isAllowedDuringWorkPause("confirmDiscardWorkPauseDraft"), true);
  });

  it("blocks every other message, including destructive ones", () => {
    for (const type of ["addItem", "updateItem", "deleteItem", "deleteCategory", "deleteType", "toggleArchive", "openLink", "copyToClipboard", ""]) {
      assert.strictEqual(isAllowedDuringWorkPause(type), false, type);
    }
  });
});
