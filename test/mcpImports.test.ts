/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

const MCP_DIR = path.join(__dirname, "..", "src", "mcp");

/** The module names a source file imports (`import ... from "x"`, `import "x"`, `require("x")`). */
function importsOf(file: string): string[] {
  const text = fs.readFileSync(path.join(MCP_DIR, file), "utf8");
  const found: string[] = [];
  for (const match of text.matchAll(/(?:from\s+|import\s+|require\()\s*["']([^"']+)["']/g)) {
    found.push(match[1]);
  }
  return found;
}

const files = fs.readdirSync(MCP_DIR).filter((name) => name.endsWith(".ts"));
const importing = (prefix: string) => files.filter((file) => importsOf(file).some((name) => name === prefix || name.startsWith(prefix)));

describe("src/mcp dependency rules", () => {
  it("has source files to check", () => {
    assert.ok(files.length >= 10, files.join(", "));
  });

  it("imports the MCP SDK only in mcpServerCore.ts", () => {
    assert.deepStrictEqual(importing("@modelcontextprotocol/"), ["mcpServerCore.ts"]);
  });

  it("imports vscode in no file of src/mcp except the controller", () => {
    for (const file of importing("vscode")) {
      assert.strictEqual(file, "mcpController.ts", `${file} imports vscode`);
    }
  });

  it("keeps the tool layer free of the transport: no tool file imports http, the router, or the server", () => {
    const toolFiles = [
      "tools.ts",
      "readTools.ts",
      "writeTools.ts",
      "noteStateTools.ts",
      "catalogTools.ts",
      "toolKit.ts",
      "toolErrors.ts",
      "notesQuery.ts",
      "noteView.ts",
      "mcpTypes.ts",
    ];
    for (const file of toolFiles) {
      for (const name of importsOf(file)) {
        assert.ok(!/^(http|https|net|\.\/(mcpRouter|innerServer|mcpHttpServer|mcpServerCore|portHolder|routerRegistry))/.test(name), `${file} imports ${name}`);
      }
    }
  });

  it("never lets the guard, the matcher, or the registry reach the notes or the SDK", () => {
    for (const file of ["httpGuard.ts", "workspaceMatch.ts"]) {
      for (const name of importsOf(file)) {
        assert.ok(!/notesService|notesQuery|itemsStore|storage|@modelcontextprotocol/.test(name), `${file} imports ${name}`);
      }
    }
  });
});
