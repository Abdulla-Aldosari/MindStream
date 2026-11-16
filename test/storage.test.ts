import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createEmptyData,
  DEFAULT_TYPES,
  DEFAULT_CATEGORIES,
  describeStorageTransition,
  normalizeData,
  parseDataText,
  StorageError,
  StorageProblem,
  StorageService,
} from "../src/storage";
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
    assert.strictEqual(d.types.length, DEFAULT_TYPES.length);
    assert.strictEqual(d.categories.length, 1);
    assert.deepStrictEqual(d.items, []);
  });

  it("restores the default types when the file has none, and keeps existing ones", () => {
    assert.strictEqual(normalizeData({ types: [] }).types.length, DEFAULT_TYPES.length);
    const kept = normalizeData({ types: [{ id: "mine", label: "Mine", createdAt: "t" }] });
    assert.deepStrictEqual(
      kept.types.map((t) => t.id),
      ["mine"]
    );
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

  it("drops items missing a categoryId", () => {
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
  it("fromText: corrupt JSON is reported as a problem and blocks saving", () => {
    const s = StorageService.fromText("{not valid json");
    assert.strictEqual(s.getProblem()?.kind, "invalid");
    assert.throws(() => s.saveData(s.getData()), StorageError);
  });

  it("fromText: no file and an empty file both start a new project", () => {
    for (const text of [null, "", "  \n"]) {
      const s = StorageService.fromText(text);
      assert.strictEqual(s.getProblem(), undefined);
      assert.strictEqual(s.getData().version, DATA_VERSION);
      assert.strictEqual(s.getData().types.length, DEFAULT_TYPES.length);
    }
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

describe("parseDataText", () => {
  it("treats no file, an empty file, and whitespace as a new project", () => {
    for (const raw of [null, "", " \r\n\t"]) {
      const r = parseDataText(raw);
      assert.ok("data" in r);
      assert.strictEqual(r.data.items.length, 0);
    }
  });

  it("ignores a leading byte order mark", () => {
    const r = parseDataText(`\uFEFF${JSON.stringify({ version: 1, types: [], categories: [], items: [] })}`);
    assert.ok("data" in r);
  });

  it("reports invalid JSON and non-object values instead of starting over", () => {
    for (const raw of ["{broken", "null", "[]", "42", '"text"', "true"]) {
      const r = parseDataText(raw);
      assert.ok("problem" in r, raw);
      assert.strictEqual(r.problem.kind, "invalid");
      assert.ok(r.problem.message.includes(".vscode/mindstream.data.json"));
      assert.ok(r.problem.howToFix.length > 0);
    }
  });
});

describe("describeStorageTransition", () => {
  const invalid: StorageProblem = { kind: "invalid", message: "Bad.", howToFix: "Fix it." };
  const invalidOther: StorageProblem = { kind: "invalid", message: "Bad again.", howToFix: "Fix it." };
  const unreadable: StorageProblem = { kind: "unreadable", message: "Locked.", howToFix: "Unlock it." };

  it("warns when a problem appears or changes kind", () => {
    assert.strictEqual(describeStorageTransition(undefined, invalid)?.level, "warning");
    assert.ok(describeStorageTransition(undefined, invalid)?.message.includes("Fix it."));
    assert.strictEqual(describeStorageTransition(invalid, unreadable)?.level, "warning");
  });

  it("stays quiet while the same kind of problem continues or nothing is wrong", () => {
    assert.strictEqual(describeStorageTransition(invalid, invalidOther), undefined);
    assert.strictEqual(describeStorageTransition(undefined, undefined), undefined);
  });

  it("tells the user once saving works again", () => {
    assert.strictEqual(describeStorageTransition(invalid, undefined)?.level, "info");
  });
});

describe("StorageService protection of the data file", () => {
  function withDir(run: (dir: string, file: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-guard-test-"));
    try {
      run(dir, path.join(dir, ".vscode", "mindstream.data.json"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  function writeFile(file: string, text: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, "utf8");
  }

  function dataWithNote(title: string) {
    const data = createEmptyData();
    data.items.push({
      id: "n1",
      typeId: data.types[0].id,
      categoryId: GENERAL_CATEGORY_ID,
      title,
      status: "pending",
      statusHistory: [{ status: "pending", at: "2020-01-01T00:00:00.000Z" }],
      archived: false,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    return data;
  }

  it("never overwrites a corrupt file: the save throws and the file stays byte for byte", () => {
    withDir((dir, file) => {
      const corrupt = '{"items": [ {"title": "my notes"'; // truncated
      writeFile(file, corrupt);
      const s = StorageService.forDir(dir);
      assert.strictEqual(s.getProblem()?.kind, "invalid");
      assert.throws(
        () => s.saveData(createEmptyData()),
        (e: unknown) => e instanceof StorageError && e.code === "STORAGE_BLOCKED"
      );
      assert.strictEqual(fs.readFileSync(file, "utf8"), corrupt);
      assert.ok(!fs.existsSync(`${file}.tmp`));
    });
  });

  it("the refused save message states the reason, that nothing changed, and the fix", () => {
    const s = StorageService.fromText("[]");
    try {
      s.saveData(s.getData());
      assert.fail("expected a StorageError");
    } catch (e) {
      assert.ok(e instanceof StorageError);
      assert.ok(e.message.startsWith("Not saved:"));
      assert.ok(e.message.includes("Nothing was changed."));
      assert.ok(e.message.includes(s.getProblem()!.howToFix));
    }
  });

  it("a refused save leaves the in-memory data exactly as it was, even after an in-place change", () => {
    withDir((dir, file) => {
      writeFile(file, JSON.stringify(dataWithNote("Original")));
      const s = StorageService.forDir(dir);
      writeFile(file, "{broken");
      assert.strictEqual(s.reloadIfExternal(), true);
      // The last good data is still shown.
      assert.strictEqual(s.getData().items[0].title, "Original");

      const data = s.getData();
      data.items[0].title = "Changed in place";
      data.items.push({ ...data.items[0], id: "n2" });
      assert.throws(() => s.saveData(data), StorageError);
      assert.strictEqual(s.getData().items.length, 1);
      assert.strictEqual(s.getData().items[0].title, "Original");
      assert.strictEqual(fs.readFileSync(file, "utf8"), "{broken");
    });
  });

  it("an unreadable file (a folder in its place) blocks saving", () => {
    withDir((dir, file) => {
      fs.mkdirSync(file, { recursive: true }); // reading a directory fails
      const s = StorageService.forDir(dir);
      assert.strictEqual(s.getProblem()?.kind, "unreadable");
      assert.strictEqual(s.getData().items.length, 0);
      assert.throws(() => s.saveData(s.getData()), StorageError);
      assert.ok(fs.statSync(file).isDirectory());
    });
  });

  it("a failed write throws WRITE_FAILED and restores memory, leaving the file untouched", () => {
    withDir((dir, file) => {
      writeFile(file, JSON.stringify(dataWithNote("Original")));
      const s = StorageService.forDir(dir);
      // A folder where the temp file goes makes the write fail.
      fs.mkdirSync(`${file}.tmp`);
      const data = s.getData();
      data.items[0].title = "Changed";
      assert.throws(
        () => s.saveData(data),
        (e: unknown) => e instanceof StorageError && e.code === "WRITE_FAILED"
      );
      assert.strictEqual(s.getData().items[0].title, "Original");
      assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).items[0].title, "Original");
    });
  });

  it("recovers as soon as the file is fixed", () => {
    withDir((dir, file) => {
      writeFile(file, "{broken");
      const s = StorageService.forDir(dir);
      assert.ok(s.getProblem());
      writeFile(file, JSON.stringify(dataWithNote("Fixed")));
      assert.strictEqual(s.reloadIfExternal(), true);
      assert.strictEqual(s.getProblem(), undefined);
      assert.strictEqual(s.getData().items[0].title, "Fixed");
      s.saveData(s.getData());
    });
  });

  it("recovers when the file returns to the last saved content (a lock released)", () => {
    withDir((dir, file) => {
      writeFile(file, JSON.stringify(dataWithNote("Same")));
      const s = StorageService.forDir(dir);
      const good = fs.readFileSync(file, "utf8");
      writeFile(file, "{broken");
      s.reloadIfExternal();
      assert.ok(s.getProblem());
      writeFile(file, good);
      assert.strictEqual(s.reloadIfExternal(), true);
      assert.strictEqual(s.getProblem(), undefined);
    });
  });

  it("deleting the broken file turns saving back on and keeps the last good notes", () => {
    withDir((dir, file) => {
      writeFile(file, JSON.stringify(dataWithNote("Keep me")));
      const s = StorageService.forDir(dir);
      writeFile(file, "{broken");
      s.reloadIfExternal();
      fs.rmSync(file);
      assert.strictEqual(s.reloadIfExternal(), true);
      assert.strictEqual(s.getProblem(), undefined);
      assert.strictEqual(s.getData().items[0].title, "Keep me");
      s.saveData(s.getData());
      assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).items[0].title, "Keep me");
    });
  });

  it("deleting a healthy file keeps the notes in memory and reports no change", () => {
    withDir((dir, file) => {
      writeFile(file, JSON.stringify(dataWithNote("Still here")));
      const s = StorageService.forDir(dir);
      fs.rmSync(file);
      assert.strictEqual(s.reloadIfExternal(), false);
      assert.strictEqual(s.getData().items[0].title, "Still here");
    });
  });

  it("an empty file is a new project: saving works", () => {
    withDir((dir, file) => {
      writeFile(file, "");
      const s = StorageService.forDir(dir);
      assert.strictEqual(s.getProblem(), undefined);
      s.saveData(s.getData());
      assert.ok(fs.readFileSync(file, "utf8").length > 0);
    });
  });
});
