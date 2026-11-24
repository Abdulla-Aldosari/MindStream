/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { buildClientConfig } from "../src/mcp/clientConfigs";
import { CLIENTS } from "../src/mcp/clientList";
import { endpointUrl } from "../src/mcp/mcpControllerLogic";

const INPUT = { url: endpointUrl(18741), token: "Zk3-test_token-not-a-real-secret-0123456789", serverName: "mindstream" };
const all = CLIENTS.map((c) => c.id);

describe("buildClientConfig: what every text has in common", () => {
  it("carries the fixed port's address and the exact bearer header", () => {
    for (const id of all) {
      const { text } = buildClientConfig(id, INPUT);
      assert.ok(text.includes(INPUT.url), id);
      assert.ok(text.includes(`Bearer ${INPUT.token}`), id);
    }
  });

  it("depends only on the address, the token, and the name: the same for every workspace", () => {
    for (const id of all) {
      assert.strictEqual(buildClientConfig(id, INPUT).text, buildClientConfig(id, { ...INPUT }).text, id);
    }
  });

  it("never names a project file, a project folder, or a workspace", () => {
    const forbidden = [".mcp.json", ".cline/mcp.json", ".vscode/mcp.json", ".roo/", "${workspaceFolder}", "--scope project", "--scope local"];
    for (const id of all) {
      const { text, where } = buildClientConfig(id, INPUT);
      for (const word of forbidden) {
        assert.ok(!text.includes(word) && !where.includes(word), `${id}: ${word}`);
      }
    }
  });

  it("names a file of the user's home only, never a bare dot-folder that would sit inside a project", () => {
    for (const id of all) {
      const { where } = buildClientConfig(id, INPUT);
      for (const match of where.matchAll(/(\S*)\.(cursor|codex|gemini|copilot)\/\S+/g)) {
        assert.ok(match[1].endsWith("~/"), `${id}: ${match[0]} is not under the home folder`);
      }
    }
  });

  it("tells the user a place to paste it, as a full sentence", () => {
    for (const id of all) {
      const { where } = buildClientConfig(id, INPUT);
      assert.ok(where.length > 40 && where.endsWith("."), id);
    }
  });

  it("uses the server name given, except the generic text, which is only an address and a header", () => {
    for (const id of all.filter((client) => client !== "generic")) {
      assert.ok(buildClientConfig(id, { ...INPUT, serverName: "notes-memory" }).text.includes("notes-memory"), id);
    }
    assert.ok(!buildClientConfig("generic", { ...INPUT, serverName: "notes-memory" }).text.includes("notes-memory"));
  });
});

describe("buildClientConfig: input that could not be carried safely", () => {
  const unsafe: [string, Partial<typeof INPUT>][] = [
    ["a token with a quote", { token: 'abc"def' }],
    ["a token with a space", { token: "abc def" }],
    ["a token with a newline", { token: "abc\ndef" }],
    ["a token with a dollar sign", { token: "abc$(whoami)" }],
    ["an empty token", { token: "" }],
    ["a url with a quote", { url: 'http://127.0.0.1:1/mcp"; rm -rf' }],
    ["a url with a space", { url: "http://127.0.0.1:1/mcp x" }],
    ["a url that is not http", { url: "file:///etc/passwd" }],
    ["a server name with a space", { serverName: "my server" }],
    ["a server name with a dot", { serverName: "a.b" }],
  ];

  it("refuses it for every client, before building any text", () => {
    for (const [label, change] of unsafe) {
      for (const id of all) {
        assert.throws(() => buildClientConfig(id, { ...INPUT, ...change }), /cannot carry safely|must be letters/, `${id}: ${label}`);
      }
    }
  });
});
