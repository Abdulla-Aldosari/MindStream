/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/
import * as assert from "assert";

// media/tooltip.js is mostly a side-effect-free browser script (no `vscode`
// or DOM usage in its exported functions) that exports computeTooltipPosition,
// buildTooltipHtml, and isLayoutInducedHover for Node-based unit tests; see
// the guarded `module.exports` block at the bottom of that file. The
// interactive part of the file (event wiring) is guarded behind
// `typeof document !== 'undefined'` and never runs here, since Node has no
// `document` global.
const { computeTooltipPosition, buildTooltipHtml, isLayoutInducedHover } = require("../media/tooltip.js") as {
  computeTooltipPosition: (opts: {
    target: { left: number; top: number; right: number; bottom: number; width: number; height: number };
    tipWidth: number;
    tipHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    pos?: string;
    margin?: number;
  }) => { left: number; top: number; resolvedPos: string; arrowX: number; arrowY: number };
  buildTooltipHtml: (header?: string, body?: string, footer?: string) => string;
  isLayoutInducedHover: (opts: {
    timeStamp: number;
    clientX: number;
    clientY: number;
    lastMoveX: number | null;
    lastMoveY: number | null;
    lastMoveTimeStamp: number;
    threshold?: number;
  }) => boolean;
};

function target(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

describe("computeTooltipPosition", () => {
  it("defaults to below the target, centered horizontally", () => {
    const result = computeTooltipPosition({
      target: target(100, 100, 40, 20),
      tipWidth: 80,
      tipHeight: 30,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    assert.strictEqual(result.resolvedPos, "bottom");
    assert.strictEqual(result.top, 126); // 100 + 20 + margin(6)
    assert.strictEqual(result.left, 80); // 100 + 40/2 - 80/2
  });

  it('places the tooltip above the target when pos is "top" and there is room', () => {
    const result = computeTooltipPosition({
      target: target(100, 200, 40, 20),
      tipWidth: 80,
      tipHeight: 30,
      viewportWidth: 800,
      viewportHeight: 600,
      pos: "top",
    });
    assert.strictEqual(result.resolvedPos, "top");
    assert.strictEqual(result.top, 164); // 200 - 30 - margin(6)
  });

  it('flips to bottom when "top" has no room near the viewport edge', () => {
    const result = computeTooltipPosition({
      target: target(100, 2, 40, 20),
      tipWidth: 80,
      tipHeight: 30,
      viewportWidth: 800,
      viewportHeight: 600,
      pos: "top",
    });
    assert.strictEqual(result.resolvedPos, "bottom");
    assert.strictEqual(result.top, 28); // 2 + 20 + margin(6)
  });

  it('flips to top when "bottom" has no room near the viewport bottom edge', () => {
    const result = computeTooltipPosition({
      target: target(100, 580, 40, 10),
      tipWidth: 80,
      tipHeight: 30,
      viewportWidth: 800,
      viewportHeight: 600,
      pos: "bottom",
    });
    assert.strictEqual(result.resolvedPos, "top");
  });

  it("clamps horizontally to stay within the viewport (left edge)", () => {
    const result = computeTooltipPosition({
      target: target(2, 100, 10, 20),
      tipWidth: 80,
      tipHeight: 30,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    assert.strictEqual(result.left, 6); // clamped to margin
  });

  it("clamps horizontally to stay within the viewport (right edge)", () => {
    const result = computeTooltipPosition({
      target: target(790, 100, 10, 20),
      tipWidth: 80,
      tipHeight: 30,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    assert.strictEqual(result.left, 714); // 800 - 80 - margin(6)
  });

  it('places the tooltip to the right of the target when pos is "right"', () => {
    const result = computeTooltipPosition({
      target: target(100, 100, 40, 20),
      tipWidth: 80,
      tipHeight: 30,
      viewportWidth: 800,
      viewportHeight: 600,
      pos: "right",
    });
    assert.strictEqual(result.resolvedPos, "right");
    assert.strictEqual(result.left, 146); // 140 + margin(6)
  });

  it("flips right to left when there is no room on the right", () => {
    const result = computeTooltipPosition({
      target: target(750, 100, 40, 20),
      tipWidth: 80,
      tipHeight: 30,
      viewportWidth: 800,
      viewportHeight: 600,
      pos: "right",
    });
    assert.strictEqual(result.resolvedPos, "left");
  });

  it('places the tooltip to the left of the target when pos is "left"', () => {
    const result = computeTooltipPosition({
      target: target(300, 100, 40, 20),
      tipWidth: 80,
      tipHeight: 30,
      viewportWidth: 800,
      viewportHeight: 600,
      pos: "left",
    });
    assert.strictEqual(result.resolvedPos, "left");
    assert.strictEqual(result.left, 214); // 300 - 80 - margin(6)
  });

  it("clamps vertically for left/right positions near the top edge", () => {
    const result = computeTooltipPosition({
      target: target(300, 2, 40, 10),
      tipWidth: 80,
      tipHeight: 30,
      viewportWidth: 800,
      viewportHeight: 600,
      pos: "right",
    });
    assert.strictEqual(result.top, 6); // clamped to margin
  });

  it("computes an arrow x position centered on the target, clamped within the tooltip", () => {
    const result = computeTooltipPosition({
      target: target(100, 100, 40, 20),
      tipWidth: 80,
      tipHeight: 30,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    // target center x = 120, tooltip left = 80 -> arrow at 40 (within [10, 70])
    assert.strictEqual(result.arrowX, 40);
  });
});

describe("buildTooltipHtml", () => {
  it("renders only the body when header and footer are absent", () => {
    assert.strictEqual(
      buildTooltipHtml(undefined, "Body text", undefined),
      '<div class="tooltip-body">Body text</div>'
    );
  });

  it("renders header, body, and footer with a divider before the footer", () => {
    assert.strictEqual(
      buildTooltipHtml("Header", "Body", "Footer"),
      '<div class="tooltip-header">Header</div><div class="tooltip-body">Body</div><div class="tooltip-divider"></div><div class="tooltip-footer">Footer</div>'
    );
  });

  it("omits the divider and footer section when footer is absent", () => {
    assert.strictEqual(
      buildTooltipHtml("Header", "Body", undefined),
      '<div class="tooltip-header">Header</div><div class="tooltip-body">Body</div>'
    );
  });

  it("returns an empty string when nothing is provided", () => {
    assert.strictEqual(buildTooltipHtml(undefined, undefined, undefined), "");
  });
});

describe("isLayoutInducedHover", () => {
  it("accepts a hover when a mousemove with the same coordinates happened within the threshold", () => {
    const result = isLayoutInducedHover({
      timeStamp: 500,
      clientX: 10,
      clientY: 20,
      lastMoveX: 10,
      lastMoveY: 20,
      lastMoveTimeStamp: 450,
    });
    assert.strictEqual(result, false);
  });

  it("rejects a hover when the pointer is stationary (same coordinates, stale mousemove)", () => {
    const result = isLayoutInducedHover({
      timeStamp: 500,
      clientX: 10,
      clientY: 20,
      lastMoveX: 10,
      lastMoveY: 20,
      lastMoveTimeStamp: 100,
    });
    assert.strictEqual(result, true);
  });

  it("accepts a hover when the coordinates changed even with a stale mousemove", () => {
    const result = isLayoutInducedHover({
      timeStamp: 500,
      clientX: 11,
      clientY: 20,
      lastMoveX: 10,
      lastMoveY: 20,
      lastMoveTimeStamp: 100,
    });
    assert.strictEqual(result, false);
  });

  it("accepts a hover when no mousemove has been tracked yet", () => {
    const result = isLayoutInducedHover({
      timeStamp: 500,
      clientX: 10,
      clientY: 20,
      lastMoveX: null,
      lastMoveY: null,
      lastMoveTimeStamp: 0,
    });
    assert.strictEqual(result, false);
  });

  it("uses a custom threshold when provided", () => {
    const opts = {
      timeStamp: 200,
      clientX: 10,
      clientY: 20,
      lastMoveX: 10,
      lastMoveY: 20,
      lastMoveTimeStamp: 100,
    };
    assert.strictEqual(isLayoutInducedHover({ ...opts, threshold: 50 }), true);
    assert.strictEqual(isLayoutInducedHover({ ...opts, threshold: 150 }), false);
  });

  it("treats a mousemove exactly at the threshold as recent (strict comparison)", () => {
    const result = isLayoutInducedHover({
      timeStamp: 250,
      clientX: 10,
      clientY: 20,
      lastMoveX: 10,
      lastMoveY: 20,
      lastMoveTimeStamp: 100,
      threshold: 150,
    });
    assert.strictEqual(result, false);
  });
});
