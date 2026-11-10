import * as assert from "assert";
import * as path from "path";
import { buildLink, MAX_ANCHOR_LINES, resolveLink, toRelativePath } from "../src/linkResolver";
import { MindStreamLink } from "../src/models";

const ROOT = path.resolve("ws-root");
const FILE = path.join(ROOT, "src", "a.ts");
const SOURCE = ["import x from 'x';", "", "function one() {", "  return 1;", "}", "", "function two() {", "  return 2;", "}"];

function link(lineStart: number, lineEnd = lineStart, lines = SOURCE): MindStreamLink {
  const built = buildLink(ROOT, FILE, lines, lineStart, lineEnd);
  assert.ok(built);
  return built;
}

describe("toRelativePath", () => {
  it("returns a posix path inside the workspace", () => {
    assert.strictEqual(toRelativePath(ROOT, FILE), "src/a.ts");
  });

  it("rejects files outside the workspace and the root itself", () => {
    assert.strictEqual(toRelativePath(ROOT, path.resolve("other", "a.ts")), undefined);
    assert.strictEqual(toRelativePath(ROOT, ROOT), undefined);
    assert.strictEqual(toRelativePath(ROOT, path.join(ROOT, "..", "x.ts")), undefined);
  });
});

describe("buildLink", () => {
  it("records a single line with its anchor and context", () => {
    const l = link(4);
    assert.strictEqual(l.filePath, "src/a.ts");
    assert.strictEqual(l.lineStart, 4);
    assert.strictEqual(l.lineEnd, undefined);
    assert.strictEqual(l.state, "ok");
    assert.deepStrictEqual(l.anchor, { text: ["return 1;"], before: "function one() {", after: "}" });
  });

  it("records a range and caps the stored anchor lines", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const l = link(3, 15, lines);
    assert.strictEqual(l.lineEnd, 15);
    assert.strictEqual(l.anchor?.text.length, MAX_ANCHOR_LINES);
  });

  it("rejects invalid ranges and files outside the workspace", () => {
    assert.strictEqual(buildLink(ROOT, FILE, SOURCE, 0, 1), undefined);
    assert.strictEqual(buildLink(ROOT, FILE, SOURCE, 5, 3), undefined);
    assert.strictEqual(buildLink(ROOT, path.resolve("other", "a.ts"), SOURCE, 1, 1), undefined);
  });
});

describe("resolveLink", () => {
  it("keeps the link when the code is still where it was recorded", () => {
    const r = resolveLink(link(4), SOURCE);
    assert.strictEqual(r.outcome, "ok");
    assert.strictEqual(r.link.lineStart, 4);
  });

  it("follows the code when lines are added above it", () => {
    const r = resolveLink(link(8), ["// header", "// header 2", ...SOURCE]);
    assert.strictEqual(r.outcome, "moved");
    assert.strictEqual(r.link.lineStart, 10);
    assert.strictEqual(r.link.state, "ok");
  });

  it("follows the code when lines are removed above it", () => {
    const r = resolveLink(link(8), SOURCE.slice(2));
    assert.strictEqual(r.outcome, "moved");
    assert.strictEqual(r.link.lineStart, 6);
  });

  it("moves a multi-line range as a whole", () => {
    const r = resolveLink(link(3, 5), ["// new", ...SOURCE]);
    assert.strictEqual(r.outcome, "moved");
    assert.strictEqual(r.link.lineStart, 4);
    assert.strictEqual(r.link.lineEnd, 6);
  });

  it("prefers the occurrence with matching context over a nearer duplicate", () => {
    const recorded = link(5, 5, ["a", "b", "c", "x", "dup", "y", "z"]);
    const r = resolveLink(recorded, ["dup", "q", "dup", "w", "x", "dup", "y"]);
    assert.strictEqual(r.link.lineStart, 6);
  });

  it("flags the link as changed when the recorded code is gone, keeping its position", () => {
    const edited = [...SOURCE];
    edited[3] = "  return 42;";
    const r = resolveLink(link(4), edited);
    assert.strictEqual(r.outcome, "changed");
    assert.strictEqual(r.link.state, "changed");
    assert.strictEqual(r.link.lineStart, 4);
  });

  it("recovers from changed once the code comes back", () => {
    const changed = resolveLink(link(4), ["nothing here"]);
    assert.strictEqual(changed.link.state, "changed");
    assert.strictEqual(resolveLink(changed.link, SOURCE).link.state, "ok");
  });

  it("reports a missing file and keeps the rest of the link", () => {
    const r = resolveLink(link(4), null);
    assert.strictEqual(r.outcome, "missing");
    assert.strictEqual(r.link.state, "missing");
    assert.strictEqual(r.link.lineStart, 4);
    assert.strictEqual(r.link.filePath, "src/a.ts");
  });

  it("recovers a missing link when the file exists again", () => {
    const missing = resolveLink(link(4), null).link;
    assert.strictEqual(resolveLink(missing, SOURCE).link.state, "ok");
  });

  describe("long ranges (the end is re-found too)", () => {
    // Range 10-30: head = lines 10-14, middle = lines 15-25, tail = lines 26-30.
    const body = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
    const recorded = () => link(10, 30, body);

    it("stores the tail of a long range but not of a short one", () => {
      assert.deepStrictEqual(recorded().anchor?.endText, ["line 26", "line 27", "line 28", "line 29", "line 30"]);
      assert.strictEqual(link(10, 14, body).anchor?.endText, undefined);
    });

    it("keeps the link when nothing changed", () => {
      assert.strictEqual(resolveLink(recorded(), body).outcome, "ok");
    });

    it("grows lineEnd when lines are added inside the range", () => {
      const edited = [...body.slice(0, 19), "x1", "x2", "x3", ...body.slice(19)];
      const r = resolveLink(recorded(), edited);
      assert.strictEqual(r.outcome, "moved");
      assert.strictEqual(r.link.lineStart, 10);
      assert.strictEqual(r.link.lineEnd, 33);
      assert.strictEqual(r.link.state, "ok");
    });

    it("shrinks lineEnd when lines are removed inside the range", () => {
      const edited = [...body.slice(0, 17), ...body.slice(20)];
      const r = resolveLink(recorded(), edited);
      assert.strictEqual(r.outcome, "moved");
      assert.strictEqual(r.link.lineStart, 10);
      assert.strictEqual(r.link.lineEnd, 27);
    });

    it("moves start and end together when the whole range moves", () => {
      const r = resolveLink(recorded(), ["new", "new", ...body]);
      assert.strictEqual(r.link.lineStart, 12);
      assert.strictEqual(r.link.lineEnd, 32);
    });

    it("flags changed when the tail is gone", () => {
      const edited = body.map((l, i) => (i >= 25 && i <= 29 ? `edited ${i}` : l));
      assert.strictEqual(resolveLink(recorded(), edited).outcome, "changed");
    });

    it("flags changed when the head is gone", () => {
      const edited = body.map((l, i) => (i >= 9 && i <= 13 ? `edited ${i}` : l));
      assert.strictEqual(resolveLink(recorded(), edited).outcome, "changed");
    });

    it("an edit in the middle that keeps head and tail is still ok", () => {
      const edited = [...body];
      edited[19] = "middle changed";
      assert.strictEqual(resolveLink(recorded(), edited).outcome, "ok");
    });

    it("reuses a pre-normalized file", () => {
      const edited = ["new", ...body];
      const r = resolveLink(
        recorded(),
        edited,
        edited.map((l) => l.trim())
      );
      assert.strictEqual(r.link.lineStart, 11);
      assert.strictEqual(r.link.lineEnd, 31);
    });
  });
  it("does not relocate a blank line without matching context", () => {
    const r = resolveLink(link(2), ["x", "y", "", "w"]);
    assert.strictEqual(r.outcome, "changed");
  });
});
