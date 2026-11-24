/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PROTOCOL_VERSION, RouterRegistry, processExists } from "../src/mcp/routerRegistry";

describe("RouterRegistry", () => {
  let dir: string;
  const alive = new Set<number>();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-registry-"));
    alive.clear();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A window of its own: a registry over the shared directory with its own pid and clock. */
  function window(pid: number, startedAt = 1000) {
    alive.add(pid);
    return new RouterRegistry({ dir, platform: "posix", isAlive: (p) => alive.has(p), pid, now: () => startedAt });
  }

  it("writes the entry atomically: no temporary file is left, and no token is in it", () => {
    const a = window(101);
    a.register("/work/a", 5000);
    const names = fs.readdirSync(dir);
    assert.deepStrictEqual(names, ["window-101.json"]);
    const text = fs.readFileSync(path.join(dir, names[0]), "utf8");
    assert.deepStrictEqual(JSON.parse(text), { protocol: PROTOCOL_VERSION, folder: "/work/a", port: 5000, pid: 101, startedAt: 1000 });
    assert.strictEqual(/token/i.test(text), false);
  });

  it("lists the live entries of every window", () => {
    window(101).register("/work/a", 5000);
    window(102).register("/work/b", 5001);
    const entries = window(103).liveEntries();
    assert.deepStrictEqual(entries.map((e) => e.folder).sort(), ["/work/a", "/work/b"]);
  });

  it("removes its own entry, and removing it twice is safe", () => {
    const a = window(101);
    a.register("/work/a", 5000);
    a.unregister();
    a.unregister();
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });

  it("ignores an entry whose process is gone and deletes its file", () => {
    window(101).register("/work/a", 5000);
    window(102).register("/work/b", 5001);
    alive.delete(101);
    const entries = window(103).liveEntries();
    assert.deepStrictEqual(
      entries.map((e) => e.folder),
      ["/work/b"]
    );
    assert.deepStrictEqual(fs.readdirSync(dir), ["window-102.json"]);
  });

  it("keeps the newest live entry when one folder is open in two windows", () => {
    window(101, 1000).register("/work/a", 5000);
    window(102, 2000).register("/work/a", 5001);
    const entries = window(103).liveEntries();
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].port, 5001);
  });

  it("treats the same folder written with different case or separators as one on Windows", () => {
    alive.add(101).add(102);
    const first = new RouterRegistry({ dir, platform: "win32", isAlive: (p) => alive.has(p), pid: 101, now: () => 1 });
    const second = new RouterRegistry({ dir, platform: "win32", isAlive: (p) => alive.has(p), pid: 102, now: () => 2 });
    first.register("D:\\Dev\\Proj", 5000);
    second.register("d:/dev/proj/", 5001);
    assert.strictEqual(first.liveEntries().length, 1);
    assert.strictEqual(first.liveEntries()[0].port, 5001);
  });

  it("ignores a corrupt or foreign file and never throws", () => {
    window(101).register("/work/a", 5000);
    fs.writeFileSync(path.join(dir, "window-900.json"), "{ not json", "utf8");
    fs.writeFileSync(path.join(dir, "window-901.json"), JSON.stringify({ folder: 3 }), "utf8");
    fs.writeFileSync(path.join(dir, "window-902.json"), JSON.stringify({ protocol: 1, folder: "/x", port: 99999, pid: 902, startedAt: 1 }), "utf8");
    fs.writeFileSync(path.join(dir, "notes.txt"), "hello", "utf8");
    alive.add(900).add(901).add(902);
    assert.deepStrictEqual(
      window(103)
        .liveEntries()
        .map((e) => e.folder),
      ["/work/a"]
    );
  });

  it("returns nothing when the directory does not exist", () => {
    fs.rmSync(dir, { recursive: true, force: true });
    assert.deepStrictEqual(window(101).liveEntries(), []);
  });

  it("serves the cache until it is dropped, then reads the new state", () => {
    const reader = window(103);
    assert.strictEqual(reader.liveEntries().length, 0);
    window(101).register("/work/a", 5000);
    assert.strictEqual(reader.liveEntries().length, 0, "still cached");
    assert.strictEqual(reader.liveEntries(true).length, 1, "forced read");
  });

  it("drops an entry whose server did not answer: its file goes and the cache is cleared", () => {
    const a = window(101);
    const entry = a.register("/work/a", 5000);
    const reader = window(103);
    assert.strictEqual(reader.liveEntries().length, 1);
    reader.drop(entry);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
    assert.strictEqual(reader.liveEntries().length, 0);
  });

  it("refreshes its cache when the directory changes (watch)", async () => {
    const reader = window(103);
    reader.watch();
    try {
      assert.strictEqual(reader.liveEntries().length, 0);
      window(101).register("/work/a", 5000);
      const deadline = Date.now() + 3000;
      while (reader.liveEntries().length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.strictEqual(reader.liveEntries().length, 1);
    } finally {
      reader.stopWatching();
    }
  });
});

describe("processExists", () => {
  it("is true for this process and false for a pid that cannot exist", () => {
    assert.strictEqual(processExists(process.pid), true);
    assert.strictEqual(processExists(2 ** 22 + 12345), false);
  });
});
