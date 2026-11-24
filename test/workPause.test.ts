/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { MAX_WORK_PAUSE_TEXT, WorkPauseCopy, guardWhenWorkPaused, isAllowedDuringWorkPause, normalizeWorkPauseNote } from "../src/workPause";

describe("WorkPauseCopy", () => {
  it("shows the stored note until the first snapshot (a tab restored by a reload)", () => {
    let stored = "Stored";
    const copy = new WorkPauseCopy(() => stored);
    assert.strictEqual(copy.content(), "Stored");
    stored = "Changed";
    assert.strictEqual(copy.content(), "Changed");
  });

  it("is a snapshot: a later change to the note does not reach it until it is taken again", () => {
    let stored = "First";
    const copy = new WorkPauseCopy(() => stored);
    copy.take("First");
    stored = "Second";
    assert.strictEqual(copy.content(), "First");
    copy.take("Second");
    assert.strictEqual(copy.content(), "Second");
  });

  it("keeps its text after the note is deleted", () => {
    let stored = "Keep me";
    const copy = new WorkPauseCopy(() => stored);
    copy.take(stored);
    stored = "";
    assert.strictEqual(copy.content(), "Keep me");
  });
});

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

  it("allows the note card's buttons: copy, open in editor, resume, delete and resume", () => {
    for (const type of ["copyWorkPauseNote", "openWorkPauseNoteInEditor", "resumeWork", "deleteWorkPauseNote"]) {
      assert.strictEqual(isAllowedDuringWorkPause(type), true, type);
    }
  });

  it("blocks every other message, including destructive ones", () => {
    for (const type of ["addItem", "updateItem", "deleteItem", "deleteCategory", "deleteType", "toggleArchive", "openLink", "copyToClipboard", ""]) {
      assert.strictEqual(isAllowedDuringWorkPause(type), false, type);
    }
  });
});
