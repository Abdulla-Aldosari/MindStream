import * as assert from "assert";
import { DEFAULT_PRIORITY, DEFAULT_PRIORITY_STYLE, isPriority, normalizePriorityStyle, PRIORITIES, PRIORITY_LABEL, PRIORITY_STYLES, priorityFeatures } from "../src/priority";

describe("priority", () => {
  it("lists the four levels highest first, with labels", () => {
    assert.deepStrictEqual([...PRIORITIES], ["critical", "high", "medium", "low"]);
    assert.deepStrictEqual(
      PRIORITIES.map((p) => PRIORITY_LABEL[p]),
      ["Critical", "High", "Medium", "Low"]
    );
  });

  it("uses Low as the default for new notes", () => {
    assert.strictEqual(DEFAULT_PRIORITY, "low");
    assert.ok(isPriority(DEFAULT_PRIORITY));
  });

  it("isPriority accepts only known levels", () => {
    for (const p of PRIORITIES) {
      assert.strictEqual(isPriority(p), true);
    }
    for (const bad of ["", "Low", "urgent", undefined, null, 1, {}]) {
      assert.strictEqual(isPriority(bad), false, String(bad));
    }
  });

  it("defaults the style setting to the footer chip", () => {
    assert.strictEqual(DEFAULT_PRIORITY_STYLE, "chip");
    assert.strictEqual(normalizePriorityStyle(undefined), "chip");
    assert.strictEqual(normalizePriorityStyle("bogus"), "chip");
    assert.strictEqual(normalizePriorityStyle(3), "chip");
  });

  it("keeps every valid style", () => {
    for (const style of PRIORITY_STYLES) {
      assert.strictEqual(normalizePriorityStyle(style), style);
    }
  });

  it("priorityFeatures enables everything and maps the card indicator", () => {
    for (const style of ["dot", "stripe", "chip", "typeStripe"] as const) {
      assert.deepStrictEqual(priorityFeatures(style), { enabled: true, editor: true, group: true, sort: true, filter: true, cardIndicator: style });
    }
  });

  it('priorityFeatures("off") disables every feature', () => {
    assert.deepStrictEqual(priorityFeatures("off"), { enabled: false, editor: false, group: false, sort: false, filter: false, cardIndicator: null });
  });
});
