/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { MAX_EXCERPT_LINES, MAX_EXCERPT_LINE_CHARS, toCodeExcerpt } from "../src/mcp/noteView";

describe("toCodeExcerpt", () => {
  const file = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
  const lineNumbers = (excerpt: ReturnType<typeof toCodeExcerpt>) => excerpt!.lines.map((l) => l.line);

  it("returns the linked lines with context on each side, numbered from 1", () => {
    const excerpt = toCodeExcerpt(file, { filePath: "f", lineStart: 5, lineEnd: 6, state: "ok" }, 2);
    assert.deepStrictEqual(lineNumbers(excerpt), [3, 4, 5, 6, 7, 8]);
    assert.strictEqual(excerpt!.lines[0].text, "line 3");
    assert.strictEqual(excerpt!.truncated, false);
  });

  it("stops at the start and the end of the file", () => {
    assert.deepStrictEqual(lineNumbers(toCodeExcerpt(file, { filePath: "f", lineStart: 1, state: "ok" }, 2)), [1, 2, 3]);
    assert.deepStrictEqual(lineNumbers(toCodeExcerpt(file, { filePath: "f", lineStart: 10, state: "ok" }, 2)), [8, 9, 10]);
  });

  it("returns only the linked lines without context", () => {
    assert.deepStrictEqual(lineNumbers(toCodeExcerpt(file, { filePath: "f", lineStart: 4, lineEnd: 5, state: "ok" }, 0)), [4, 5]);
  });

  it("returns null when the link points past the end of the file", () => {
    assert.strictEqual(toCodeExcerpt(file, { filePath: "f", lineStart: 50, state: "changed" }, 3), null);
  });

  it("caps the number of lines and marks the excerpt as truncated", () => {
    const big = Array.from({ length: 500 }, (_, i) => `l${i + 1}`);
    const excerpt = toCodeExcerpt(big, { filePath: "f", lineStart: 1, lineEnd: 400, state: "ok" }, 0)!;
    assert.strictEqual(excerpt.lines.length, MAX_EXCERPT_LINES);
    assert.strictEqual(excerpt.truncated, true);
  });

  it("cuts a very long line", () => {
    const excerpt = toCodeExcerpt(["x".repeat(MAX_EXCERPT_LINE_CHARS + 500)], { filePath: "f", lineStart: 1, state: "ok" }, 0)!;
    assert.strictEqual(excerpt.lines[0].text.length, MAX_EXCERPT_LINE_CHARS);
  });
});
