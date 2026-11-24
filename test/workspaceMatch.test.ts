/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { errorCodeOf } from "../src/domainError";
import { isAbsoluteWorkspace, isInside, matchWorkspace, normalizeFolder, requireWorkspace } from "../src/mcp/workspaceMatch";

const entry = (folder: string) => ({ folder });

describe("normalizeFolder", () => {
  it("uses / separators and drops a trailing separator", () => {
    assert.strictEqual(normalizeFolder("D:\\Dev\\proj\\", "win32"), "d:/dev/proj");
    assert.strictEqual(normalizeFolder("/home/me/proj/", "posix"), "/home/me/proj");
  });

  it("is case-insensitive on Windows only", () => {
    assert.strictEqual(normalizeFolder("D:\\Dev\\Proj", "win32"), "d:/dev/proj");
    assert.strictEqual(normalizeFolder("/Home/Me/Proj", "posix"), "/Home/Me/Proj");
  });

  it("drops . segments and repeated separators, and keeps the root", () => {
    assert.strictEqual(normalizeFolder("/a/./b//c", "posix"), "/a/b/c");
    assert.strictEqual(normalizeFolder("/", "posix"), "/");
    assert.strictEqual(normalizeFolder("C:\\", "win32"), "c:");
  });

  it("keeps a UNC path's leading separators as one root", () => {
    assert.strictEqual(normalizeFolder("\\\\server\\share\\proj", "win32"), "/server/share/proj");
  });
});

describe("isInside", () => {
  it("matches the folder itself and anything below it", () => {
    assert.strictEqual(isInside("D:\\proj", "D:\\proj", "win32"), true);
    assert.strictEqual(isInside("D:\\proj\\src\\deep", "D:\\proj", "win32"), true);
    assert.strictEqual(isInside("/home/me/proj/src", "/home/me/proj", "posix"), true);
  });

  it("counts a prefix only on a separator boundary", () => {
    assert.strictEqual(isInside("D:\\proj-b", "D:\\proj", "win32"), false);
    assert.strictEqual(isInside("D:\\proj-b\\src", "D:\\proj", "win32"), false);
    assert.strictEqual(isInside("/home/me/proj2", "/home/me/proj", "posix"), false);
  });

  it("ignores trailing separators on either side", () => {
    assert.strictEqual(isInside("D:\\proj\\", "D:\\proj", "win32"), true);
    assert.strictEqual(isInside("D:\\proj", "D:\\proj\\", "win32"), true);
  });

  it("does not match a parent folder", () => {
    assert.strictEqual(isInside("D:\\Dev", "D:\\Dev\\proj", "win32"), false);
  });

  it("matches the root folder as the parent of everything on posix", () => {
    assert.strictEqual(isInside("/anything/here", "/", "posix"), true);
  });

  it("mixes / and \\ separators on Windows", () => {
    assert.strictEqual(isInside("D:/Dev/proj/src", "D:\\Dev\\proj", "win32"), true);
  });
});

describe("matchWorkspace", () => {
  it("returns the entry whose folder contains the workspace", () => {
    const a = entry("D:\\a");
    const b = entry("D:\\b");
    assert.strictEqual(matchWorkspace("D:\\b\\src", [a, b], "win32"), b);
  });

  it("picks the longest folder among nested ones", () => {
    const outer = entry("D:\\mono");
    const inner = entry("D:\\mono\\packages\\app");
    assert.strictEqual(matchWorkspace("D:\\mono\\packages\\app\\src", [outer, inner], "win32"), inner);
    assert.strictEqual(matchWorkspace("D:\\mono\\packages\\app\\src", [inner, outer], "win32"), inner);
    assert.strictEqual(matchWorkspace("D:\\mono\\other", [outer, inner], "win32"), outer);
  });

  it("returns undefined when no folder contains the workspace", () => {
    assert.strictEqual(matchWorkspace("D:\\elsewhere", [entry("D:\\a")], "win32"), undefined);
    assert.strictEqual(matchWorkspace("D:\\proj-b", [entry("D:\\proj")], "win32"), undefined);
    assert.strictEqual(matchWorkspace("D:\\a", [], "win32"), undefined);
  });

  it("matches ignoring case on Windows, never on posix", () => {
    assert.ok(matchWorkspace("d:\\dev\\PROJ", [entry("D:\\Dev\\proj")], "win32"));
    assert.strictEqual(matchWorkspace("/home/Me/proj", [entry("/home/me/proj")], "posix"), undefined);
  });
});

describe("requireWorkspace", () => {
  it("accepts an absolute path and returns it trimmed", () => {
    assert.strictEqual(requireWorkspace("  D:\\proj ", "win32"), "D:\\proj");
    assert.strictEqual(requireWorkspace("/home/me/proj", "posix"), "/home/me/proj");
    assert.strictEqual(requireWorkspace("\\\\server\\share\\proj", "win32"), "\\\\server\\share\\proj");
  });

  it("refuses a relative, empty, or non-text workspace with INVALID_INPUT", () => {
    const bad: [unknown, "win32" | "posix"][] = [
      ["proj", "win32"],
      ["..\\proj", "win32"],
      ["\\proj", "win32"],
      ["/home/me", "win32"],
      ["", "win32"],
      ["   ", "posix"],
      ["proj/src", "posix"],
      ["C:\\proj", "posix"],
      [undefined, "posix"],
      [42, "posix"],
      [{}, "win32"],
    ];
    for (const [workspace, platform] of bad) {
      assert.throws(
        () => requireWorkspace(workspace, platform),
        (err: unknown) => errorCodeOf(err) === "INVALID_INPUT",
        `${String(workspace)} on ${platform}`
      );
    }
  });

  it("knows what an absolute path is on each platform", () => {
    assert.strictEqual(isAbsoluteWorkspace("C:/x", "win32"), true);
    assert.strictEqual(isAbsoluteWorkspace("C:x", "win32"), false);
    assert.strictEqual(isAbsoluteWorkspace("/x", "posix"), true);
  });
});
