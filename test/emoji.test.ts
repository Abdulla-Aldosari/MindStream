import * as assert from "assert";

// media/emoji.js is a side-effect-free browser script (no `vscode` or DOM
// usage) that exports `splitEmojis` and `isEmoji` for Node-based unit tests;
// see the guarded `module.exports` block at the bottom of that file.
const { splitEmojis, isEmoji } = require("../media/emoji.js") as {
  splitEmojis: (text: unknown) => string[];
  isEmoji: (text: unknown) => boolean;
};

describe("splitEmojis", () => {
  it("returns an empty array for an empty string", () => {
    assert.deepStrictEqual(splitEmojis(""), []);
  });

  it("returns an empty array for non-string input", () => {
    assert.deepStrictEqual(splitEmojis(null), []);
    assert.deepStrictEqual(splitEmojis(undefined), []);
  });

  it("splits a plain sequence into individual emoji", () => {
    assert.deepStrictEqual(splitEmojis("📌✅📖"), ["📌", "✅", "📖"]);
  });

  it("keeps variation-selector emoji intact", () => {
    assert.deepStrictEqual(splitEmojis("⚠️✔️"), ["⚠️", "✔️"]);
  });

  it("ignores whitespace and newlines", () => {
    assert.deepStrictEqual(splitEmojis("📌\n ✅\t📖"), ["📌", "✅", "📖"]);
  });
});

describe("isEmoji", () => {
  it("returns true for a simple emoji", () => {
    assert.strictEqual(isEmoji("📌"), true);
  });

  it("returns true for a variation-selector emoji", () => {
    assert.strictEqual(isEmoji("✔️"), true);
  });

  it("returns true for a regional-indicator flag", () => {
    assert.strictEqual(isEmoji("🇺🇸"), true);
  });

  it("returns false for plain letters and digits", () => {
    assert.strictEqual(isEmoji("a"), false);
    assert.strictEqual(isEmoji("1"), false);
    assert.strictEqual(isEmoji("hello"), false);
  });

  it("returns false for empty and non-string input", () => {
    assert.strictEqual(isEmoji(""), false);
    assert.strictEqual(isEmoji(null), false);
    assert.strictEqual(isEmoji(undefined), false);
  });
});

describe("isEmoji symbol boundary", () => {
  it("rejects decorative text symbols", () => {
    const rejected = "★☆✦✧✪✫✯❖◆◇■□•●○◉◎◈▷➜➤➔➣⟶✓✗✘☒";
    for (const symbol of rejected) {
      assert.strictEqual(isEmoji(symbol), false, `expected ${symbol} to be rejected`);
    }
  });

  it("accepts real emoji symbols", () => {
    const accepted = "▪▫▶↪✔☑";
    for (const symbol of accepted) {
      assert.strictEqual(isEmoji(symbol), true, `expected ${symbol} to be accepted`);
    }
  });
});
