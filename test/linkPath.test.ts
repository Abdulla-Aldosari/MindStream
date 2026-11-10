/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/
import * as assert from "assert";

// media/linkPath.js is a side-effect-free browser script that exports its
// functions for Node-based unit tests through a guarded `module.exports`.
const { pathCandidates, fitPath } = require("../media/linkPath.js") as {
  pathCandidates: (path: string) => string[];
  fitPath: (path: string, available: number, measure: (text: string) => number) => string;
};

const LONG = "stream/user-data/Shared Dictionary/cache/index-dir/reconcile-stripe-refunds.js";
const FILE = "reconcile-stripe-refunds.js";
// One width unit per character keeps the expectations easy to read.
const chars = (text: string): number => text.length;

describe("pathCandidates", () => {
  it("starts with the full path and ends with the bare file name", () => {
    const list = pathCandidates(LONG);
    assert.strictEqual(list[0], LONG);
    assert.strictEqual(list[list.length - 1], FILE);
  });

  it("never cuts the file name, and always replaces folders with a single ellipsis in the middle", () => {
    for (const text of pathCandidates(LONG).slice(0, -1)) {
      assert.ok(text.endsWith(`/${FILE}`) || text === LONG, text);
      assert.ok((text.match(/\u2026/g) || []).length <= 1, text);
    }
  });

  it("is ordered from the longest to the shortest", () => {
    const lengths = pathCandidates(LONG).map((t) => t.length);
    assert.deepStrictEqual(
      lengths,
      [...lengths].sort((a, b) => b - a)
    );
  });

  it("has no duplicates", () => {
    const list = pathCandidates(LONG);
    assert.strictEqual(new Set(list).size, list.length);
  });

  it("offers the first folder and the last folders around the ellipsis", () => {
    const list = pathCandidates(LONG);
    assert.ok(list.includes(`stream/\u2026/index-dir/${FILE}`));
    assert.ok(list.includes(`\u2026/index-dir/${FILE}`));
    assert.ok(list.includes(`\u2026/${FILE}`));
  });

  it("returns only the name for a file at the root", () => {
    assert.deepStrictEqual(pathCandidates("README.md"), ["README.md"]);
  });

  it("handles a single folder", () => {
    assert.deepStrictEqual(pathCandidates("src/a.ts"), ["src/a.ts", "\u2026/a.ts", "a.ts"]);
  });
});

describe("fitPath", () => {
  it("shows the full path when there is room", () => {
    assert.strictEqual(fitPath(LONG, LONG.length, chars), LONG);
    assert.strictEqual(fitPath(LONG, 500, chars), LONG);
  });

  it("shrinks gradually as the room narrows, always keeping the file name", () => {
    let previous = LONG.length + 1;
    for (let room = LONG.length; room >= FILE.length; room--) {
      const shown = fitPath(LONG, room, chars);
      assert.ok(shown.endsWith(FILE), shown);
      assert.ok(shown.length <= room, `${shown} in ${room}`);
      assert.ok(shown.length <= previous);
      previous = shown.length;
    }
  });

  it("keeps as much of the folders as the room allows", () => {
    const room = `stream/\u2026/index-dir/${FILE}`.length;
    assert.strictEqual(fitPath(LONG, room, chars), `stream/\u2026/index-dir/${FILE}`);
    assert.strictEqual(fitPath(LONG, room - 1, chars).endsWith(FILE), true);
  });

  it("falls back to the bare file name when nothing else fits", () => {
    assert.strictEqual(fitPath(LONG, FILE.length, chars), FILE);
    assert.strictEqual(fitPath(LONG, 5, chars), FILE);
    assert.strictEqual(fitPath(LONG, 0, chars), FILE);
  });

  it("uses the supplied measure, so proportional fonts work", () => {
    const wide = (text: string): number => text.length * 2;
    assert.strictEqual(fitPath(LONG, LONG.length, wide).length <= LONG.length / 2, true);
  });

  it("measures each candidate with the line suffix when the caller includes it", () => {
    const withSuffix = (text: string): number => `${text}:1016-1024`.length;
    const shown = fitPath("media/sidebar.css", "media/sidebar.css:1016-1024".length - 1, withSuffix);
    assert.strictEqual(shown, "\u2026/sidebar.css");
  });
});
