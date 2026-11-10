import * as assert from "assert";
import { markLinkMissingForPath, renameLinkPath, sanitizeLink, shiftLinkForEdits } from "../src/linkResolver";
import { MindStreamLink } from "../src/models";

function link(lineStart: number, lineEnd?: number): MindStreamLink {
  const l: MindStreamLink = { filePath: "src/a.ts", lineStart, state: "ok" };
  if (lineEnd !== undefined) {
    l.lineEnd = lineEnd;
  }
  return l;
}

describe("shiftLinkForEdits", () => {
  it("shifts down when lines are inserted above", () => {
    assert.strictEqual(shiftLinkForEdits(link(4), [{ startLine: 0, endLine: 0, addedLines: 2 }]).lineStart, 6);
  });

  it("shifts up when lines are deleted above", () => {
    assert.strictEqual(shiftLinkForEdits(link(4), [{ startLine: 0, endLine: 2, addedLines: 0 }]).lineStart, 2);
  });

  it("shifts the whole range", () => {
    const shifted = shiftLinkForEdits(link(3, 5), [{ startLine: 0, endLine: 0, addedLines: 1 }]);
    assert.strictEqual(shifted.lineStart, 4);
    assert.strictEqual(shifted.lineEnd, 6);
  });

  it("returns the same object for edits at or below a single-line link", () => {
    const l = link(4);
    assert.strictEqual(shiftLinkForEdits(l, [{ startLine: 3, endLine: 3, addedLines: 1 }]), l);
    assert.strictEqual(shiftLinkForEdits(l, [{ startLine: 7, endLine: 7, addedLines: 1 }]), l);
  });

  describe("edits inside a range (lines 10-20 = indexes 9-19)", () => {
    it("grows the end when lines are added inside", () => {
      const shifted = shiftLinkForEdits(link(10, 20), [{ startLine: 14, endLine: 14, addedLines: 3 }]);
      assert.strictEqual(shifted.lineStart, 10);
      assert.strictEqual(shifted.lineEnd, 23);
    });

    it("shrinks the end when lines are deleted inside", () => {
      const shifted = shiftLinkForEdits(link(10, 20), [{ startLine: 12, endLine: 15, addedLines: 0 }]);
      assert.strictEqual(shifted.lineEnd, 17);
    });

    it("grows the end for an edit on the last line", () => {
      assert.strictEqual(shiftLinkForEdits(link(10, 20), [{ startLine: 19, endLine: 19, addedLines: 1 }]).lineEnd, 21);
    });

    it("combines edits above and inside", () => {
      const shifted = shiftLinkForEdits(link(10, 20), [
        { startLine: 0, endLine: 0, addedLines: 2 },
        { startLine: 14, endLine: 14, addedLines: 1 },
      ]);
      assert.strictEqual(shifted.lineStart, 12);
      assert.strictEqual(shifted.lineEnd, 23);
    });

    it("leaves edits below the range and edits on the first line to the resolver", () => {
      const l = link(10, 20);
      assert.strictEqual(shiftLinkForEdits(l, [{ startLine: 25, endLine: 25, addedLines: 4 }]), l);
      assert.strictEqual(shiftLinkForEdits(l, [{ startLine: 9, endLine: 9, addedLines: 1 }]), l);
      assert.strictEqual(shiftLinkForEdits(l, [{ startLine: 18, endLine: 23, addedLines: 0 }]), l);
    });

    it("a deletion inside a short range keeps at least the first line", () => {
      const shifted = shiftLinkForEdits(link(10, 12), [{ startLine: 10, endLine: 11, addedLines: 0 }]);
      assert.strictEqual(shifted.lineStart, 10);
      assert.strictEqual(shifted.lineEnd, 11);
    });
  });
});

describe("link path tracking", () => {
  it("follows a file rename and ignores other files", () => {
    const l = link(4);
    assert.strictEqual(renameLinkPath(l, "src/a.ts", "src/b.ts").filePath, "src/b.ts");
    assert.strictEqual(renameLinkPath(l, "src/c.ts", "src/d.ts"), l);
  });

  it("follows a folder move without matching a sibling with the same prefix", () => {
    const l = link(4);
    assert.strictEqual(renameLinkPath(l, "src", "lib").filePath, "lib/a.ts");
    assert.strictEqual(renameLinkPath(l, "sr", "lib"), l);
  });

  it("marks links under a deleted file or folder as missing", () => {
    const l = link(4);
    assert.strictEqual(markLinkMissingForPath(l, "src/a.ts").state, "missing");
    assert.strictEqual(markLinkMissingForPath(l, "src").state, "missing");
    assert.strictEqual(markLinkMissingForPath(l, "other"), l);
  });
});

describe("sanitizeLink", () => {
  it("accepts a valid link and drops unknown fields", () => {
    const clean = sanitizeLink({ filePath: "src/a.ts", lineStart: 3, lineEnd: 5, state: "changed", extra: 1 });
    assert.deepStrictEqual(clean, { filePath: "src/a.ts", lineStart: 3, state: "changed", lineEnd: 5 });
  });

  it("defaults an unknown state to ok", () => {
    assert.strictEqual(sanitizeLink({ filePath: "a.ts", lineStart: 1, state: "weird" })?.state, "ok");
  });

  it("rejects paths that could escape the workspace", () => {
    for (const filePath of ["../x.ts", "a/../../x.ts", "/etc/passwd", "C:/x.ts", "a\\b.ts", "a//b.ts", ""]) {
      assert.strictEqual(sanitizeLink({ filePath, lineStart: 1, state: "ok" }), undefined, filePath);
    }
  });

  it("rejects invalid shapes and line numbers", () => {
    assert.strictEqual(sanitizeLink(null), undefined);
    assert.strictEqual(sanitizeLink({ filePath: "a.ts", lineStart: 0 }), undefined);
    assert.strictEqual(sanitizeLink({ filePath: "a.ts", lineStart: 1.5 }), undefined);
    assert.strictEqual(sanitizeLink({ filePath: "a.ts" }), undefined);
  });

  it("drops a malformed anchor but keeps the link", () => {
    const clean = sanitizeLink({ filePath: "a.ts", lineStart: 1, state: "ok", anchor: { text: "nope" } });
    assert.ok(clean);
    assert.strictEqual(clean.anchor, undefined);
  });
});
