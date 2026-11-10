/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/
import * as assert from "assert";

// media/dropdown-menu.js exposes its pure helpers on `DropdownMenu.utils`
// through a guarded `module.exports` block (no DOM needed for these).
type Entry = Record<string, unknown>;
type Descriptor = { key: string; kind: string; text: string; checked: boolean; disabled: boolean };
type Rect = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };

const { utils } = require("../media/dropdown-menu.js") as {
  utils: {
    normalizeEntries(entries: Entry[]): Entry[];
    describeEntries(entries: Entry[]): Descriptor[];
    activationFor(d: unknown): { detail: Entry; close: boolean } | null;
    moveIndex(count: number, current: number, delta: number): number;
    findTypeaheadMatch(items: { text: string }[], current: number, query: string): number;
    computePosition(opts: { anchor: Rect; menu: Size; viewport: Size; align?: string }): { left: number; top: number; maxHeight: number; placement: string };
  };
};

const types = (list: Entry[]) => list.map((e) => e.type);

describe("DropdownMenu helpers", () => {
  it("normalizeEntries drops hidden entries and empty groups", () => {
    const result = utils.normalizeEntries([
      { type: "item", id: "a", text: "A" },
      { type: "item", id: "b", text: "B", hidden: true },
      { type: "group", label: "G", items: [{ type: "checkbox", id: "c", text: "C", hidden: true }] },
      {
        type: "radio-group",
        id: "r",
        value: "x",
        items: [
          { value: "x", text: "X" },
          { value: "y", text: "Y", hidden: true },
        ],
      },
    ]);
    assert.deepStrictEqual(types(result), ["item", "radio-group"]);
    assert.deepStrictEqual(
      (result[1].items as Entry[]).map((i) => i.value),
      ["x"]
    );
  });

  it("normalizeEntries collapses leading, trailing, and repeated separators", () => {
    const sep = { type: "separator" };
    const result = utils.normalizeEntries([
      sep,
      { type: "item", id: "a", text: "A" },
      sep,
      { type: "group", hidden: true, items: [] },
      sep,
      { type: "item", id: "b", text: "B" },
      sep,
    ]);
    assert.deepStrictEqual(types(result), ["item", "separator", "item"]);
  });

  it("describeEntries flattens in DOM order with checked and disabled states", () => {
    const list = utils.describeEntries(
      utils.normalizeEntries([
        {
          type: "radio-group",
          id: "sort",
          value: "b",
          items: [
            { value: "a", text: "A" },
            { value: "b", text: "B", disabled: true },
          ],
        },
        { type: "group", items: [{ type: "checkbox", id: "c", text: "C", checked: true }] },
        { type: "item", id: "d", text: "D" },
      ])
    );
    assert.deepStrictEqual(
      list.map((d) => [d.key, d.checked, d.disabled]),
      [
        ["radio:sort:a", false, false],
        ["radio:sort:b", true, true],
        ["checkbox:c", true, false],
        ["item:d", false, false],
      ]
    );
  });

  it("activationFor ignores disabled items and uses the close defaults", () => {
    assert.strictEqual(utils.activationFor({ kind: "item", id: "x", disabled: true }), null);
    const [item, checkbox, radio] = utils.describeEntries([
      { type: "item", id: "i", text: "I" },
      { type: "group", items: [{ type: "checkbox", id: "c", text: "C", checked: true }] },
      { type: "radio-group", id: "g", value: "a", items: [{ value: "b", text: "B" }] },
    ]);
    assert.deepStrictEqual(utils.activationFor(item), { detail: { kind: "item", id: "i" }, close: true });
    assert.deepStrictEqual(utils.activationFor(checkbox), { detail: { kind: "checkbox", id: "c", checked: false }, close: false });
    assert.deepStrictEqual(utils.activationFor(radio), { detail: { kind: "radio", group: "g", value: "b" }, close: false });
  });

  it("moveIndex wraps in both directions", () => {
    assert.strictEqual(utils.moveIndex(3, 2, 1), 0);
    assert.strictEqual(utils.moveIndex(3, 0, -1), 2);
    assert.strictEqual(utils.moveIndex(3, -1, 1), 0);
    assert.strictEqual(utils.moveIndex(3, -1, -1), 2);
    assert.strictEqual(utils.moveIndex(0, -1, 1), -1);
  });

  it("findTypeaheadMatch cycles single letters and refines longer queries", () => {
    const items = ["Status", "Sort", "Date", "Size"].map((text) => ({ text }));
    assert.strictEqual(utils.findTypeaheadMatch(items, -1, "s"), 0);
    assert.strictEqual(utils.findTypeaheadMatch(items, 0, "s"), 1);
    assert.strictEqual(utils.findTypeaheadMatch(items, 3, "s"), 0);
    assert.strictEqual(utils.findTypeaheadMatch(items, 0, "ss"), 1);
    assert.strictEqual(utils.findTypeaheadMatch(items, 0, "si"), 3);
    assert.strictEqual(utils.findTypeaheadMatch(items, 1, "so"), 1);
    assert.strictEqual(utils.findTypeaheadMatch(items, 0, "x"), -1);
  });

  it("computePosition places, clamps, aligns, and flips", () => {
    const tall = { width: 400, height: 800 };
    assert.deepStrictEqual(utils.computePosition({ anchor: { left: 20, top: 10, right: 120, bottom: 36 }, menu: { width: 200, height: 300 }, viewport: tall }), {
      left: 20,
      top: 40,
      maxHeight: 756,
      placement: "bottom",
    });
    const narrow = { width: 300, height: 800 };
    assert.strictEqual(utils.computePosition({ anchor: { left: 250, top: 10, right: 290, bottom: 36 }, menu: { width: 200, height: 100 }, viewport: narrow }).left, 96);
    assert.strictEqual(
      utils.computePosition({ anchor: { left: 100, top: 10, right: 290, bottom: 36 }, menu: { width: 200, height: 100 }, viewport: narrow, align: "end" }).left,
      90
    );
    const flipped = utils.computePosition({ anchor: { left: 0, top: 500, right: 50, bottom: 526 }, menu: { width: 100, height: 300 }, viewport: { width: 400, height: 600 } });
    assert.deepStrictEqual([flipped.placement, flipped.top], ["top", 196]);
  });
});
