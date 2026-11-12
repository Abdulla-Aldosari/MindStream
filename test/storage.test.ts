import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createEmptyData, DEFAULT_TYPES, DEFAULT_CATEGORIES, normalizeData, StorageService } from "../src/storage";
import { DATA_VERSION, GENERAL_CATEGORY_ID } from "../src/models";

describe("createEmptyData", () => {
  it("creates versioned empty data with ready-made types and the General category", () => {
    const data = createEmptyData();
    assert.strictEqual(data.version, DATA_VERSION);
    assert.strictEqual(data.items.length, 0);
    assert.strictEqual(data.types.length, DEFAULT_TYPES.length);

    const general = data.categories[0];
    assert.strictEqual(data.categories.length, 1);
    assert.strictEqual(general.id, GENERAL_CATEGORY_ID);
    assert.strictEqual(general.isDefault, true);

    const ids = new Set(data.types.map((t) => t.id));
    assert.strictEqual(ids.size, data.types.length);
    for (const t of data.types) {
      assert.ok(t.id.length > 0);
      assert.ok(t.createdAt.length > 0);
    }
  });
});

describe("normalizeData workPauseNote", () => {
  it("never adds the key when the file has none", () => {
    assert.ok(!("workPauseNote" in normalizeData({ items: [] })));
    assert.ok(!("workPauseNote" in createEmptyData()));
  });

  it("keeps a valid note as the last key", () => {
    const note = { text: "Stopped here", updatedAt: "2026-11-11T10:00:00.000Z", paused: true };
    const data = normalizeData({ version: 1, types: [], categories: [], items: [], workPauseNote: note });
    assert.deepStrictEqual(data.workPauseNote, note);
    assert.strictEqual(Object.keys(data).pop(), "workPauseNote");
  });

  it("drops a key of the wrong shape and fixes an active note without text", () => {
    assert.ok(!("workPauseNote" in normalizeData({ workPauseNote: "oops" })));
    assert.ok(!("workPauseNote" in normalizeData({ workPauseNote: [] })));
    assert.strictEqual(normalizeData({ workPauseNote: { text: "", paused: true } }).workPauseNote?.paused, false);
  });

  it("round-trips through StorageService", () => {
    const text = JSON.stringify({ version: 1, types: [], categories: [], items: [], workPauseNote: { text: "A", updatedAt: "", paused: false } });
    const storage = StorageService.fromText(text);
    assert.strictEqual(storage.getData().workPauseNote?.text, "A");
  });
});

describe("DEFAULT_TYPES / DEFAULT_CATEGORIES", () => {
  it("ships 11 default types", () => {
    assert.strictEqual(DEFAULT_TYPES.length, 11);
  });

  it("ships the General default category", () => {
    assert.strictEqual(DEFAULT_CATEGORIES.length, 1);
    assert.strictEqual(DEFAULT_CATEGORIES[0].id, GENERAL_CATEGORY_ID);
    assert.strictEqual(DEFAULT_CATEGORIES[0].label, "General");
  });
});

describe("normalizeData link", () => {
  const base = { id: "i", typeId: "t", categoryId: "general", title: "T", status: "pending", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

  it("keeps a valid link and drops unknown link fields", () => {
    const d = normalizeData({ items: [{ ...base, link: { filePath: "src/a.ts", lineStart: 2, state: "ok", gitCommit: "abc" } }] });
    assert.deepStrictEqual(d.items[0].link, { filePath: "src/a.ts", lineStart: 2, state: "ok" });
  });

  it("drops a link that points outside the workspace, keeping the note", () => {
    const d = normalizeData({ items: [{ ...base, link: { filePath: "../secret.txt", lineStart: 1, state: "ok" } }] });
    assert.strictEqual(d.items.length, 1);
    assert.strictEqual("link" in d.items[0], false);
  });
});

describe("normalizeData priority", () => {
  const base = { id: "i", typeId: "t", categoryId: "general", title: "T", status: "pending", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

  it("keeps a valid priority", () => {
    const d = normalizeData({ items: [{ ...base, priority: "critical" }] });
    assert.strictEqual(d.items[0].priority, "critical");
  });

  it("never adds a priority key to notes without one", () => {
    const d = normalizeData({ items: [{ ...base }] });
    assert.strictEqual("priority" in d.items[0], false);
  });

  it("drops an unknown priority instead of guessing a level", () => {
    for (const bad of ["urgent", "High", 2, null]) {
      const d = normalizeData({ items: [{ ...base, priority: bad }] });
      assert.strictEqual("priority" in d.items[0], false, String(bad));
    }
  });
});

describe("normalizeData", () => {
  it("returns empty data for null / non-object input", () => {
    for (const raw of [null, undefined, 42, "text", true]) {
      const d = normalizeData(raw);
      assert.strictEqual(d.version, DATA_VERSION);
      assert.strictEqual(d.types.length, DEFAULT_TYPES.length);
      assert.strictEqual(d.items.length, 0);
    }
  });

  it("fills missing arrays and version", () => {
    const d = normalizeData({});
    assert.strictEqual(d.version, DATA_VERSION);
    assert.deepStrictEqual(d.types, []);
    assert.strictEqual(d.categories.length, 1);
    assert.deepStrictEqual(d.items, []);
  });

  it("injects the General category at the front when missing", () => {
    const d = normalizeData({ categories: [{ id: "x", label: "X", createdAt: "t" }] });
    assert.strictEqual(d.categories[0].id, GENERAL_CATEGORY_ID);
    assert.strictEqual(d.categories.length, 2);
  });

  it("does not duplicate the General category when already present", () => {
    const d = normalizeData({
      categories: [
        { id: GENERAL_CATEGORY_ID, label: "General", isDefault: true, order: 0, createdAt: "t" },
        { id: "x", label: "X", createdAt: "t" },
      ],
    });
    assert.strictEqual(d.categories.filter((c) => c.id === GENERAL_CATEGORY_ID).length, 1);
    assert.strictEqual(d.categories.length, 2);
  });

  it("ignores legacy items without a categoryId", () => {
    const d = normalizeData({ items: [{ id: "x", typeId: "t", title: "No cat" }] });
    assert.strictEqual(d.items.length, 0);
  });

  it("fills missing statusHistory and archived on kept items", () => {
    const d = normalizeData({
      items: [
        {
          id: "x",
          typeId: "t",
          categoryId: "general",
          title: "A",
          status: "done",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });
    assert.strictEqual(d.items.length, 1);
    const it = d.items[0];
    assert.deepStrictEqual(it.statusHistory, [{ status: "done", at: "2020-01-01T00:00:00.000Z" }]);
    assert.strictEqual(it.archived, false);
  });

  it("preserves a numeric version when provided", () => {
    const d = normalizeData({ version: 7 });
    assert.strictEqual(d.version, 7);
  });
});

describe("StorageService", () => {
  it("fromText: corrupt JSON falls back to default data", () => {
    const s = StorageService.fromText("{not valid json");
    assert.strictEqual(s.getData().version, DATA_VERSION);
  });

  it("fromText: reads and normalizes valid JSON", () => {
    const s = StorageService.fromText(JSON.stringify({ version: 1, types: [], categories: [], items: [] }));
    assert.strictEqual(s.getData().version, 1);
    assert.strictEqual(s.getData().categories[0].id, GENERAL_CATEGORY_ID);
  });

  it("forDir: round-trips data through the filesystem", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-test-"));
    try {
      const s1 = StorageService.forDir(dir);
      const data = s1.getData();
      data.items.push({
        id: "i1",
        typeId: "t1",
        categoryId: GENERAL_CATEGORY_ID,
        title: "Hello",
        status: "pending",
        statusHistory: [{ status: "pending", at: "2020-01-01T00:00:00.000Z" }],
        archived: false,
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
      });
      s1.saveData(data);

      const s2 = StorageService.forDir(dir);
      assert.strictEqual(s2.getData().items.length, 1);
      assert.strictEqual(s2.getData().items[0].title, "Hello");

      const file = path.join(dir, ".vscode", "mindstream.data.json");
      assert.ok(fs.existsSync(file));
      assert.ok(!fs.existsSync(file + ".tmp"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("forDir: falls back to the legacy .mindstream/data.json when the new file is absent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-migrate-test-"));
    try {
      const legacyFile = path.join(dir, ".mindstream", "data.json");
      fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
      const legacyData = createEmptyData();
      legacyData.items.push({
        id: "legacy-1",
        typeId: "t1",
        categoryId: GENERAL_CATEGORY_ID,
        title: "Legacy note",
        status: "pending",
        statusHistory: [{ status: "pending", at: "2020-01-01T00:00:00.000Z" }],
        archived: false,
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
      });
      fs.writeFileSync(legacyFile, JSON.stringify(legacyData, null, 2), "utf8");

      const s = StorageService.forDir(dir);
      assert.strictEqual(s.getData().items.length, 1);
      assert.strictEqual(s.getData().items[0].title, "Legacy note");

      // Saving migrates the data into the new location.
      s.saveData(s.getData());
      const newFile = path.join(dir, ".vscode", "mindstream.data.json");
      assert.ok(fs.existsSync(newFile));

      // A fresh instance now reads from the new location.
      const reloaded = StorageService.forDir(dir);
      assert.strictEqual(reloaded.getData().items.length, 1);
      assert.strictEqual(reloaded.getData().items[0].title, "Legacy note");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("StorageService.reloadIfExternal", () => {
  it("returns false and keeps the in-memory data when the backend is unchanged", () => {
    const s = StorageService.fromText(JSON.stringify(createEmptyData()));
    const before = s.getData();

    assert.strictEqual(s.reloadIfExternal(), false);
    assert.strictEqual(s.getData(), before);
  });

  it("returns false for an event that just echoes this instance's own saveData()", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-reload-test-"));
    try {
      const s = StorageService.forDir(dir);
      const data = s.getData();
      s.saveData(data);

      assert.strictEqual(s.reloadIfExternal(), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns true and reloads when the backend file changed externally", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-reload-test-"));
    try {
      const s = StorageService.forDir(dir);
      assert.strictEqual(s.getData().items.length, 0);

      const file = path.join(dir, ".vscode", "mindstream.data.json");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const externalData = createEmptyData();
      externalData.items.push({
        id: "ext-1",
        typeId: "t1",
        categoryId: GENERAL_CATEGORY_ID,
        title: "External edit",
        status: "pending",
        statusHistory: [{ status: "pending", at: "2020-01-01T00:00:00.000Z" }],
        archived: false,
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
      });
      fs.writeFileSync(file, JSON.stringify(externalData, null, 2), "utf8");

      assert.strictEqual(s.reloadIfExternal(), true);
      assert.strictEqual(s.getData().items.length, 1);
      assert.strictEqual(s.getData().items[0].title, "External edit");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a second call right after a detected external change returns false (no-op)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-reload-test-"));
    try {
      const s = StorageService.forDir(dir);
      const file = path.join(dir, ".vscode", "mindstream.data.json");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(createEmptyData(), null, 2), "utf8");

      assert.strictEqual(s.reloadIfExternal(), true);
      assert.strictEqual(s.reloadIfExternal(), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
