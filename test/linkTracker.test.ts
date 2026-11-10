import * as assert from "assert";
import { createEmptyData } from "../src/storage";
import { ItemsStore } from "../src/itemsStore";
import { LinkFiles, LinkTracker } from "../src/linkTracker";
import { MindStreamLink } from "../src/models";
import { InMemoryStorage } from "./helpers";

const SOURCE = ["a", "function f() {", "  return 1;", "}", "b"];

class FakeFiles implements LinkFiles {
  files = new Map<string, string[]>();
  reads: string[] = [];
  async readLines(relPath: string): Promise<string[] | null> {
    this.reads.push(relPath);
    return this.files.get(relPath) ?? null;
  }
}

function setup() {
  const storage = new InMemoryStorage(createEmptyData());
  const items = new ItemsStore(storage);
  const files = new FakeFiles();
  const tracker = new LinkTracker(items, files);
  const typeId = storage.getData().types[0].id;
  const link: MindStreamLink = {
    filePath: "src/a.ts",
    lineStart: 3,
    state: "ok",
    anchor: { text: ["return 1;"], before: "function f() {", after: "}" },
  };
  const note = items.create({ typeId, title: "N", link });
  files.files.set("src/a.ts", SOURCE);
  return { storage, items, files, tracker, typeId, note };
}

describe("LinkTracker", () => {
  it("applyEdits shifts only links of the edited file and reports a change", () => {
    const { items, tracker, note, typeId } = setup();
    const other = items.create({ typeId, title: "O", link: { filePath: "src/b.ts", lineStart: 3, state: "ok" } });
    assert.strictEqual(tracker.applyEdits("src/a.ts", [{ startLine: 0, endLine: 0, addedLines: 1 }]), true);
    assert.strictEqual(items.get(note.id)?.link?.lineStart, 4);
    assert.strictEqual(items.get(other.id)?.link?.lineStart, 3);
    assert.strictEqual(tracker.applyEdits("src/a.ts", [{ startLine: 9, endLine: 9, addedLines: 1 }]), false);
  });

  it("applyEdits ignores edits that keep the line count, without touching any note", () => {
    const { storage, items, tracker, note } = setup();
    const saves = storage.saved.length;
    assert.strictEqual(tracker.applyEdits("src/a.ts", [{ startLine: 0, endLine: 0, addedLines: 0 }]), false);
    assert.strictEqual(tracker.applyEdits("src/a.ts", [{ startLine: 0, endLine: 2, addedLines: 2 }]), false);
    assert.strictEqual(items.get(note.id)?.link?.lineStart, 3);
    assert.strictEqual(tracker.flush(), false);
    assert.strictEqual(storage.saved.length, saves);
  });

  it("applyEdits shifts in memory only, and flush writes once", () => {
    const { storage, items, tracker, note } = setup();
    const saves = storage.saved.length;
    tracker.applyEdits("src/a.ts", [{ startLine: 0, endLine: 0, addedLines: 1 }]);
    tracker.applyEdits("src/a.ts", [{ startLine: 0, endLine: 0, addedLines: 1 }]);
    assert.strictEqual(items.get(note.id)?.link?.lineStart, 5);
    assert.strictEqual(storage.saved.length, saves);
    assert.strictEqual(tracker.flush(), true);
    assert.strictEqual(storage.saved.length, saves + 1);
    assert.strictEqual(storage.saved[storage.saved.length - 1].items[0].link?.lineStart, 5);
    assert.strictEqual(tracker.flush(), false);
  });

  it("applyRename and applyDelete update links without touching the note", () => {
    const { items, tracker, note } = setup();
    const before = items.get(note.id)?.updatedAt;
    assert.strictEqual(tracker.applyRename("src", "lib"), true);
    assert.strictEqual(items.get(note.id)?.link?.filePath, "lib/a.ts");
    assert.strictEqual(tracker.applyDelete("lib/a.ts"), true);
    assert.strictEqual(items.get(note.id)?.link?.state, "missing");
    assert.ok(items.get(note.id));
    assert.strictEqual(items.get(note.id)?.updatedAt, before);
  });

  it("resolveItem relocates the link after an external change and persists it", async () => {
    const { items, files, tracker, note } = setup();
    files.files.set("src/a.ts", ["new", "new", ...SOURCE]);
    const r = await tracker.resolveItem(note.id);
    assert.strictEqual(r?.outcome, "moved");
    assert.strictEqual(items.get(note.id)?.link?.lineStart, 5);
  });

  it("resolveItem marks a vanished file as missing and a returned file as ok", async () => {
    const { items, files, tracker, note } = setup();
    files.files.delete("src/a.ts");
    assert.strictEqual((await tracker.resolveItem(note.id))?.outcome, "missing");
    assert.strictEqual(items.get(note.id)?.link?.state, "missing");
    files.files.set("src/a.ts", SOURCE);
    assert.strictEqual((await tracker.resolveItem(note.id))?.outcome, "ok");
    assert.strictEqual(items.get(note.id)?.link?.state, "ok");
  });

  it("resolveItem ignores notes without a link", async () => {
    const { items, tracker, typeId } = setup();
    const plain = items.create({ typeId, title: "P" });
    assert.strictEqual(await tracker.resolveItem(plain.id), undefined);
  });

  it("refreshAll reads each file once and saves only real changes", async () => {
    const { storage, items, files, tracker, typeId } = setup();
    items.create({ typeId, title: "Second", link: { filePath: "src/a.ts", lineStart: 1, state: "ok" } });
    const savesBefore = storage.saved.length;
    assert.strictEqual(await tracker.refreshAll(), false);
    assert.strictEqual(storage.saved.length, savesBefore);
    assert.strictEqual(files.reads.length, 1);
    files.files.delete("src/a.ts");
    assert.strictEqual(await tracker.refreshAll(), true);
    assert.ok(items.list().every((it) => it.link?.state === "missing"));
  });
});
