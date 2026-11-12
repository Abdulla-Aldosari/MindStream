/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "media", "sidebar.css"), "utf8");
const provider = fs.readFileSync(path.join(root, "src", "sidebarProvider.ts"), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `rule ${selector} not found`);
  return match[1];
}

describe("Work Pause card CSS", () => {
  it("keeps `filter` off the tilted card so the note text stays sharp", () => {
    assert.ok(!/(^|[\s;])filter\s*:/.test(ruleBody(".work-pause-card")));
  });

  it("casts the drop shadow from a separate text-free element", () => {
    assert.match(ruleBody(".work-pause-shadow"), /filter\s*:\s*drop-shadow/);
    assert.ok(provider.includes(`<span class="work-pause-shadow" aria-hidden="true"></span>`));
  });

  it("themes the shadow silhouette so light themes never show a hard black edge", () => {
    assert.match(ruleBody(".work-pause-shadow::before"), /var\(--work-pause-shadow-color,\s*#000000\)/);
    assert.ok(css.includes("--work-pause-shadow-color: #000000"));
    assert.ok(css.includes("--work-pause-shadow-color: #ffffff"));
  });
});
