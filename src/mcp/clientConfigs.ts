/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { ClientId } from "./clientList";

/**
 * Pure builders of the text a user pastes into each AI client's own
 * configuration. Every text is one global entry, the same for every project:
 * MindStream never edits another tool's file and never writes the token into a
 * file of the project (such a file can be committed). No `vscode` import.
 */

export interface ClientConfigInput {
  url: string;
  token: string;
  /** The name of the entry in the client's configuration. */
  serverName: string;
}

export interface ClientConfig {
  text: string;
  language: "json" | "toml" | "shell" | "text";
  /** A full sentence: where the text goes. Always a global place, never a project file. */
  where: string;
}

/** The token is generated as base64url; anything else could break out of a shell command or a quoted value. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
/** A URL without a character that could break out of a quoted value. */
const URL_PATTERN = /^https?:\/\/[^\s"'`$\\]+$/;
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function check(input: ClientConfigInput): void {
  if (!TOKEN_PATTERN.test(input.token)) {
    throw new Error("The MCP token has characters a configuration cannot carry safely.");
  }
  if (!URL_PATTERN.test(input.url)) {
    throw new Error("The MCP address has characters a configuration cannot carry safely.");
  }
  if (!NAME_PATTERN.test(input.serverName)) {
    throw new Error("The MCP server name must be letters, digits, dashes, and underscores.");
  }
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** The text for one client. Throws when the token, address, or name could not be carried safely. */
export function buildClientConfig(client: ClientId, input: ClientConfigInput): ClientConfig {
  check(input);
  const { url, token, serverName } = input;
  const headers = { Authorization: `Bearer ${token}` };
  switch (client) {
    case "copilot":
      return {
        text: json({ mcpServers: { [serverName]: { type: "http", url, headers } } }),
        language: "json",
        where:
          "GitHub Copilot in VS Code needs nothing pasted. Only for the Copilot CLI: add this entry under mcpServers in ~/.copilot/mcp-config.json (create the file if it does not exist).",
      };
    case "claude-code":
      return {
        text: `claude mcp add --transport http ${serverName} ${url} --header "Authorization: Bearer ${token}"`,
        language: "shell",
        where: "Run this command once in any terminal; Claude Code stores it for your user, so every project sees it.",
      };
    case "cursor":
      return {
        text: json({ mcpServers: { [serverName]: { url, headers } } }),
        language: "json",
        where: "Add this entry under mcpServers in ~/.cursor/mcp.json (create the file if it does not exist).",
      };
    case "cline":
      return {
        text: `${JSON.stringify(serverName)}: ${json({ type: "streamableHttp", url, headers, disabled: false, autoApprove: [] })}`,
        language: "json",
        where:
          "In Cline, open the MCP Servers panel and choose Configure MCP Servers (cline_mcp_settings.json). Paste this entry inside the existing mcpServers object, separated from the others by a comma.",
      };
    case "codex":
      return {
        text: [`[mcp_servers.${serverName}]`, `url = ${JSON.stringify(url)}`, `http_headers = { "Authorization" = ${JSON.stringify(`Bearer ${token}`)} }`].join("\n"),
        language: "toml",
        where: "Add this table to ~/.codex/config.toml (create the file if it does not exist).",
      };
    case "zed":
      return {
        text: json({ context_servers: { [serverName]: { url, headers } } }),
        language: "json",
        where: "Add this entry under context_servers in your Zed settings (the command palette: zed: open settings).",
      };
    case "gemini":
      return {
        text: json({ mcpServers: { [serverName]: { httpUrl: url, headers } } }),
        language: "json",
        where: "Add this entry under mcpServers in ~/.gemini/settings.json (create the file if it does not exist).",
      };
    case "generic":
      return {
        text: `URL: ${url}\nHeader: Authorization: Bearer ${token}`,
        language: "text",
        where: "Give any MCP client that speaks Streamable HTTP this address and this header.",
      };
  }
}
