/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { DESCRIPTION_SCHEME, DescriptionDraft, draftFileName, normalizeEol } from "../src/descriptionDraft";

describe("draftFileName", () => {
  it("uses the note title with a .md extension", () => {
    assert.strictEqual(draftFileName("Fix login"), "Fix login.md");
  });

  it("replaces characters that are not allowed in a file name", () => {
    assert.strictEqual(draftFileName('a/b\\c:d*e?f"g<h>i|j'), "a-b-c-d-e-f-g-h-i-j.md");
  });

  it("falls back for an empty, blank or missing title", () => {
    assert.strictEqual(draftFileName(""), "Note description.md");
    assert.strictEqual(draftFileName("   "), "Note description.md");
    assert.strictEqual(draftFileName(undefined), "Note description.md");
  });

  it("never starts with a dot and collapses whitespace", () => {
    assert.strictEqual(draftFileName("..hidden   name"), "hidden name.md");
  });

  it("limits the length without splitting a character", () => {
    const name = draftFileName("😀".repeat(100));
    assert.strictEqual(Array.from(name).length, 60 + ".md".length);
  });
});

describe("normalizeEol", () => {
  it("turns CRLF and CR into LF", () => {
    assert.strictEqual(normalizeEol("a\r\nb\rc\nd"), "a\nb\nc\nd");
  });
});

describe("DescriptionDraft", () => {
  it("has no draft until one is opened", () => {
    const draft = new DescriptionDraft();
    assert.strictEqual(draft.isOpen(), false);
    assert.strictEqual(draft.liveText(), undefined);
    assert.strictEqual(draft.info(), undefined);
    assert.strictEqual(draft.savedText("/1/x.md"), undefined);
    assert.strictEqual(draft.stat("/1/x.md"), undefined);
  });

  it("open() starts a draft whose file holds the text", () => {
    const draft = new DescriptionDraft();
    const info = draft.open("Idea", "Long text");
    assert.strictEqual(info.path, `/${info.id}/Idea.md`);
    assert.strictEqual(draft.savedText(info.path), "Long text");
    assert.strictEqual(draft.liveText(), "Long text");
    assert.strictEqual(draft.stat(info.path)?.size, Buffer.byteLength("Long text"));
  });

  it("an edit changes the live text but not the file until the tab is saved", () => {
    const draft = new DescriptionDraft();
    const { path } = draft.open("Idea", "one");
    const before = draft.stat(path)?.mtime;
    assert.strictEqual(draft.setLive(path, "one two"), true);
    assert.strictEqual(draft.liveText(), "one two");
    assert.strictEqual(draft.savedText(path), "one");
    assert.strictEqual(draft.stat(path)?.mtime, before);
  });

  it("an edit that changes nothing is not reported", () => {
    const draft = new DescriptionDraft();
    const { path } = draft.open("Idea", "one");
    assert.strictEqual(draft.setLive(path, "one"), false);
  });

  it("the live text uses LF even when the tab uses CRLF", () => {
    const draft = new DescriptionDraft();
    const { path } = draft.open("Idea", "a\nb");
    assert.strictEqual(draft.setLive(path, "a\r\nb"), false);
    draft.setLive(path, "a\r\nb\r\nc");
    assert.strictEqual(draft.liveText(), "a\nb\nc");
  });

  it("save() stores the text in the file and moves the modification time", () => {
    const draft = new DescriptionDraft();
    const { path } = draft.open("Idea", "one");
    const before = draft.stat(path)?.mtime ?? 0;
    assert.strictEqual(draft.save(path, "two\r\n"), true);
    assert.strictEqual(draft.savedText(path), "two\r\n");
    assert.strictEqual(draft.liveText(), "two\n");
    assert.ok((draft.stat(path)?.mtime ?? 0) > before);
  });

  it("refuses any other path", () => {
    const draft = new DescriptionDraft();
    draft.open("Idea", "one");
    assert.strictEqual(draft.setLive("/99/other.md", "x"), false);
    assert.strictEqual(draft.save("/99/other.md", "x"), false);
    assert.strictEqual(draft.liveText(), "one");
  });

  it("close() ends the draft", () => {
    const draft = new DescriptionDraft();
    const { path } = draft.open("Idea", "one");
    draft.close();
    assert.strictEqual(draft.isOpen(), false);
    assert.strictEqual(draft.savedText(path), undefined);
    assert.strictEqual(draft.setLive(path, "x"), false);
  });

  it("a new draft replaces the old one and gets a new path", () => {
    const draft = new DescriptionDraft();
    const first = draft.open("Idea", "one");
    const second = draft.open("Idea", "two");
    assert.notStrictEqual(first.path, second.path);
    assert.strictEqual(draft.savedText(first.path), undefined);
    assert.strictEqual(draft.savedText(second.path), "two");
  });

  it("uses a scheme VS Code treats as a custom file system", () => {
    assert.strictEqual(DESCRIPTION_SCHEME, "mindstream-desc");
  });
});
