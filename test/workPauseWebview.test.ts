import * as assert from "assert";

// media/workPause.js is a side-effect-free browser script that exports its
// helpers for Node-based tests through a guarded `module.exports` block.
const WP = require("../media/workPause.js") as {
  shouldReplaceDraft(mode: string): boolean;
  hasUnsavedChanges(saved: unknown, draft: unknown): boolean;
  canSave(draft: unknown): boolean;
  cancelAction(saved: unknown, draft: unknown): "leave" | "confirm";
  directionFor(text: unknown): "rtl" | "ltr";
  updatedLabel(updatedAt: unknown, format: (d: Date) => string): string;
  renderNoteHtml(text: unknown): string;
};

describe("WorkPause webview rules", () => {
  it("an incoming state never replaces a draft that is being edited", () => {
    assert.strictEqual(WP.shouldReplaceDraft("edit"), false);
    assert.strictEqual(WP.shouldReplaceDraft("view"), true);
  });

  it("detects unsaved changes exactly, including whitespace and null input", () => {
    assert.strictEqual(WP.hasUnsavedChanges("a", "a"), false);
    assert.strictEqual(WP.hasUnsavedChanges("a", "a "), true);
    assert.strictEqual(WP.hasUnsavedChanges("", ""), false);
    assert.strictEqual(WP.hasUnsavedChanges(undefined, null), false);
    assert.strictEqual(WP.hasUnsavedChanges(undefined, "x"), true);
  });

  it("canSave requires visible text", () => {
    assert.strictEqual(WP.canSave("x"), true);
    assert.strictEqual(WP.canSave(""), false);
    assert.strictEqual(WP.canSave("  \n\t "), false);
    assert.strictEqual(WP.canSave(undefined), false);
  });

  it("cancel leaves at once when the draft equals the saved text", () => {
    assert.strictEqual(WP.cancelAction("saved", "saved"), "leave");
  });

  it("cancel asks for confirmation when the draft differs from the saved text", () => {
    assert.strictEqual(WP.cancelAction("saved", "edited"), "confirm");
    assert.strictEqual(WP.cancelAction("saved", ""), "confirm");
  });

  it("with no saved note, cancel leaves an empty draft and confirms a typed one", () => {
    assert.strictEqual(WP.cancelAction("", ""), "leave");
    assert.strictEqual(WP.cancelAction(undefined, null), "leave");
    assert.strictEqual(WP.cancelAction("", "typed something"), "confirm");
  });

  describe("directionFor", () => {
    it("is rtl when the first line has an Arabic letter, ltr otherwise", () => {
      assert.strictEqual(WP.directionFor("كنت أعمل على الدالة"), "rtl");
      assert.strictEqual(WP.directionFor("Stopped at line 84"), "ltr");
    });

    it("is rtl when an Arabic letter appears anywhere in the first line, even among English", () => {
      assert.strictEqual(WP.directionFor("Fix bug in دالة refresh"), "rtl");
      assert.strictEqual(WP.directionFor("refresh() ثم الاختبار"), "rtl");
    });

    it("only looks at the first non-empty line", () => {
      assert.strictEqual(WP.directionFor("Stopped here\nثم أكمل غدا"), "ltr");
      assert.strictEqual(WP.directionFor("بدأت اليوم\nNext: run the tests"), "rtl");
    });

    it("skips leading blank and whitespace-only lines, with any line ending", () => {
      assert.strictEqual(WP.directionFor("\n\n   \nمرحبا"), "rtl");
      assert.strictEqual(WP.directionFor("\r\n\r\nمرحبا"), "rtl");
      assert.strictEqual(WP.directionFor("\r\n\r\nHello\r\nمرحبا"), "ltr");
      assert.strictEqual(WP.directionFor("\r  \rمرحبا"), "rtl");
    });

    it("ignores indentation before the text", () => {
      assert.strictEqual(WP.directionFor("   \t مرحبا"), "rtl");
      assert.strictEqual(WP.directionFor("   \t Hello"), "ltr");
    });

    it("stays ltr for digits, punctuation, symbols and bullets only", () => {
      for (const text of ["12345", "- ", "!!! ???", "* [ ] 3.14", "2026-11-12", "🙂"]) {
        assert.strictEqual(WP.directionFor(text), "ltr", text);
      }
    });

    it("does not treat Arabic-Indic digits or Arabic punctuation as Arabic letters", () => {
      assert.strictEqual(WP.directionFor("٠١٢٣٤٥"), "ltr");
      assert.strictEqual(WP.directionFor("، ؛ ؟"), "ltr");
      assert.strictEqual(WP.directionFor("٣ مهام"), "rtl");
    });

    it("recognises the other Arabic blocks (supplement, presentation forms)", () => {
      assert.strictEqual(WP.directionFor("ݐ"), "rtl"); // U+0750 Arabic Supplement
      assert.strictEqual(WP.directionFor("ﻻ"), "rtl"); // U+FEFB presentation form
    });

    it("is ltr for empty, whitespace-only and non-string input", () => {
      for (const text of ["", "   ", "\n\n", undefined, null, 5]) {
        assert.strictEqual(WP.directionFor(text), "ltr");
      }
    });

    it("does not treat another right-to-left script (Hebrew) as Arabic", () => {
      assert.strictEqual(WP.directionFor("שלום"), "ltr");
    });
  });

  it("builds the updated line with the injected formatter and hides it without a valid date", () => {
    const format = (d: Date) => `T${d.getUTCFullYear()}`;
    assert.strictEqual(WP.updatedLabel("2026-11-11T10:00:00.000Z", format), "Updated: T2026");
    assert.strictEqual(WP.updatedLabel("", format), "");
    assert.strictEqual(WP.updatedLabel(undefined, format), "");
    assert.strictEqual(WP.updatedLabel("garbage", format), "");
  });

  describe("renderNoteHtml", () => {
    const check = 'class="work-pause-check"';

    it("renders a checked checkbox with the tick SVG and an unchecked one without", () => {
      const done = WP.renderNoteHtml("[x] done");
      assert.ok(done.includes(check));
      assert.ok(done.includes("<svg"));
      const todo = WP.renderNoteHtml("[ ] todo");
      assert.ok(todo.includes(check));
      assert.ok(!todo.includes("<svg"));
    });

    it("accepts uppercase X and the - / * list prefixes", () => {
      assert.ok(WP.renderNoteHtml("[X] done").includes("<svg"));
      assert.ok(WP.renderNoteHtml("- [x] done").includes(check));
      assert.ok(WP.renderNoteHtml("* [ ] todo").includes(check));
    });

    it("keeps leading indentation before the checkbox", () => {
      assert.ok(WP.renderNoteHtml("  [x] indented").startsWith("  <span"));
    });

    it("does not convert a checkbox off the start of a line", () => {
      assert.strictEqual(WP.renderNoteHtml("a [x] mid"), "a [x] mid");
      assert.strictEqual(WP.renderNoteHtml("[x]no-space").includes(check), false);
    });

    it("escapes HTML in checkbox text and plain lines", () => {
      const out = WP.renderNoteHtml('[x] <script>alert("&")</script>');
      assert.ok(out.includes("&lt;script&gt;"));
      assert.ok(out.includes("&amp;"));
      assert.ok(out.includes("&quot;"));
      assert.ok(!out.includes("<script>"));
      assert.strictEqual(WP.renderNoteHtml("<b>hi</b>"), "&lt;b&gt;hi&lt;/b&gt;");
    });

    it("preserves line breaks", () => {
      assert.strictEqual(WP.renderNoteHtml("a\nb"), "a\nb");
      assert.strictEqual(WP.renderNoteHtml("a\r\nb\r\nc").split("\n").length, 3);
    });

    it("emits no line break after a heading or divider, so no blank line appears", () => {
      const h1 = '<span class="work-pause-h1">T</span>';
      const hr = '<span class="work-pause-divider" aria-hidden="true"></span>';
      assert.strictEqual(WP.renderNoteHtml("# T\nnext"), `${h1}next`);
      assert.strictEqual(WP.renderNoteHtml("a\n---\nb"), `a\n${hr}b`);
      assert.strictEqual(WP.renderNoteHtml("---\n# T"), `${hr}${h1}`);
    });

    it("keeps an intentional blank line after a heading or divider", () => {
      assert.strictEqual(WP.renderNoteHtml("# T\n\nnext"), '<span class="work-pause-h1">T</span>\nnext');
    });

    describe("inline code", () => {
      const code = (inner: string) => `<code class="work-pause-code">${inner}</code>`;

      it("turns a backtick pair into inline code inside a plain line", () => {
        assert.strictEqual(WP.renderNoteHtml("open `exportJson.ts` now"), `open ${code("exportJson.ts")} now`);
      });

      it("handles several spans on one line", () => {
        assert.strictEqual(WP.renderNoteHtml("`a` and `b`"), `${code("a")} and ${code("b")}`);
      });

      it("works in checkbox text and in a heading", () => {
        assert.ok(WP.renderNoteHtml("[ ] fix `run()`").includes(code("run()")));
        assert.ok(WP.renderNoteHtml("# About `x`").includes(code("x")));
      });

      it("escapes HTML inside the span and never lets raw tags through", () => {
        const out = WP.renderNoteHtml('`<script>alert("&")</script>`');
        assert.strictEqual(out, code("&lt;script&gt;alert(&quot;&amp;&quot;)&lt;/script&gt;"));
        assert.ok(!out.includes("<script>"));
      });

      it("keeps an unclosed or empty backtick pair literal", () => {
        assert.strictEqual(WP.renderNoteHtml("a `b"), "a `b");
        assert.strictEqual(WP.renderNoteHtml("a `` b"), "a `` b");
      });

      it("does not span lines", () => {
        assert.strictEqual(WP.renderNoteHtml("`a\nb`"), "`a\nb`");
      });
    });

    describe("checkbox group spacing", () => {
      const start = 'class="work-pause-list-start"';
      const count = (html: string) => html.split(start).length - 1;
      const box = '<span class="work-pause-check" aria-hidden="true"></span>';

      it("marks only the first checkbox of a group, with no \\n after the marker", () => {
        assert.strictEqual(WP.renderNoteHtml("t\n[ ] a\n[ ] b"), `t\n<span ${start}>${box} a</span>${box} b`);
      });

      it("marks every separate group", () => {
        assert.strictEqual(count(WP.renderNoteHtml("t\n[ ] a\n[ ] b\nmid\n[x] c\n[ ] d")), 2);
      });

      it("marks a group that follows a heading or a divider", () => {
        assert.strictEqual(count(WP.renderNoteHtml("# T\n[ ] a")), 1);
        assert.strictEqual(count(WP.renderNoteHtml("---\n[ ] a")), 1);
      });

      it("does not mark a group at the very top of the note", () => {
        assert.strictEqual(count(WP.renderNoteHtml("[ ] a\n[ ] b")), 0);
      });

      it("does not add space when a blank line already separates the group", () => {
        assert.strictEqual(count(WP.renderNoteHtml("t\n\n[ ] a")), 0);
        assert.strictEqual(count(WP.renderNoteHtml("t\n   \n[ ] a")), 0);
      });

      it("treats indented and - / * checkboxes as part of the same group", () => {
        assert.strictEqual(count(WP.renderNoteHtml("t\n- [ ] a\n  * [x] b\n[ ] c")), 1);
      });

      it("escapes the text of a marked line", () => {
        const out = WP.renderNoteHtml("t\n[ ] <b>x</b>");
        assert.ok(out.includes("&lt;b&gt;x&lt;/b&gt;"));
        assert.ok(!out.includes("<b>"));
      });
    });

    it('renders a single leading "# " as a heading', () => {
      const out = WP.renderNoteHtml("# Title");
      assert.ok(out.includes('class="work-pause-h1"'));
      assert.ok(out.includes("Title"));
    });

    it("escapes HTML inside a heading", () => {
      assert.ok(WP.renderNoteHtml("# <b>title</b>").includes("&lt;b&gt;title&lt;/b&gt;"));
    });

    it("never treats two hashes or a space-less hash as a heading", () => {
      assert.strictEqual(WP.renderNoteHtml("## not a heading"), "## not a heading");
      assert.strictEqual(WP.renderNoteHtml("#no-space"), "#no-space");
    });

    it("renders exactly three dashes as a divider and nothing else", () => {
      assert.ok(WP.renderNoteHtml("---").includes('class="work-pause-divider"'));
      assert.strictEqual(WP.renderNoteHtml("--").includes("work-pause-divider"), false);
      assert.strictEqual(WP.renderNoteHtml("-").includes("work-pause-divider"), false);
      assert.strictEqual(WP.renderNoteHtml("----").includes("work-pause-divider"), false);
      assert.strictEqual(WP.renderNoteHtml("--- text").includes("work-pause-divider"), false);
    });
  });
});
