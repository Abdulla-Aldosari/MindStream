/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { buildClientConfig } from "../src/mcp/clientConfigs";
import { CLIENTS, COPILOT_AUTOMATIC_MESSAGE, ClientId } from "../src/mcp/clientList";
import { endpointUrl } from "../src/mcp/mcpControllerLogic";

const URL_TEXT = endpointUrl(18741);
const TOKEN = "Zk3-test_token-not-a-real-secret-0123456789";
const HEADER = `Bearer ${TOKEN}`;

const build = (client: ClientId) => buildClientConfig(client, { url: URL_TEXT, token: TOKEN, serverName: "mindstream" });
const parse = (client: ClientId) => JSON.parse(build(client).text) as Record<string, Record<string, Record<string, unknown>>>;

describe("the client list", () => {
  it("lists every client once, Copilot first and described as automatic", () => {
    const ids = CLIENTS.map((c) => c.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    assert.deepStrictEqual([...ids].sort(), ["claude-code", "cline", "codex", "copilot", "cursor", "gemini", "generic", "zed"]);
    assert.strictEqual(ids[0], "copilot");
    assert.strictEqual(CLIENTS[0].description, "Automatic in VS Code");
  });

  it("explains that Copilot needs nothing pasted", () => {
    assert.ok(COPILOT_AUTOMATIC_MESSAGE.includes("nothing needs to be pasted"));
  });
});

describe("buildClientConfig: the text of each client", () => {
  it("Copilot CLI: mcpServers with type http, the url and the bearer header", () => {
    assert.deepStrictEqual(parse("copilot").mcpServers.mindstream, { type: "http", url: URL_TEXT, headers: { Authorization: HEADER } });
    assert.strictEqual(build("copilot").language, "json");
  });

  it("Claude Code: a command with --transport http, the url, and the header, for the user", () => {
    const config = build("claude-code");
    assert.strictEqual(config.language, "shell");
    assert.strictEqual(config.text, `claude mcp add --transport http mindstream ${URL_TEXT} --header "Authorization: ${HEADER}"`);
    assert.ok(!config.text.includes("--scope project"));
  });

  it("Cursor: mcpServers with the url and headers, and no type", () => {
    assert.deepStrictEqual(parse("cursor").mcpServers.mindstream, { url: URL_TEXT, headers: { Authorization: HEADER } });
  });

  it("Cline: one entry with type streamableHttp (a missing type means the legacy SSE), to put inside mcpServers", () => {
    const config = build("cline");
    const entry = (JSON.parse(`{${config.text}}`) as { mindstream: Record<string, unknown> }).mindstream;
    assert.deepStrictEqual(entry, { type: "streamableHttp", url: URL_TEXT, headers: { Authorization: HEADER }, disabled: false, autoApprove: [] });
    assert.ok(config.text.trimStart().startsWith('"mindstream"'), "an entry, never a whole file");
    assert.ok(config.where.includes("inside the existing mcpServers object"));
  });

  it("Codex: a TOML table with url and http_headers, line by line", () => {
    const config = build("codex");
    assert.strictEqual(config.language, "toml");
    assert.deepStrictEqual(config.text.split("\n"), ["[mcp_servers.mindstream]", `url = "${URL_TEXT}"`, `http_headers = { "Authorization" = "${HEADER}" }`]);
  });

  it("Zed: context_servers with the url and headers", () => {
    assert.deepStrictEqual(parse("zed").context_servers.mindstream, { url: URL_TEXT, headers: { Authorization: HEADER } });
  });

  it("Gemini CLI: mcpServers with httpUrl (not url) and headers", () => {
    const entry = parse("gemini").mcpServers.mindstream;
    assert.deepStrictEqual(entry, { httpUrl: URL_TEXT, headers: { Authorization: HEADER } });
    assert.strictEqual("url" in entry, false);
  });

  it("Generic: the address and the exact header", () => {
    const config = build("generic");
    assert.strictEqual(config.language, "text");
    assert.deepStrictEqual(config.text.split("\n"), [`URL: ${URL_TEXT}`, `Header: Authorization: ${HEADER}`]);
  });
});
