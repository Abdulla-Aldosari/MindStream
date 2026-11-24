/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

/** The AI clients the connection setup knows. Pure data, no `vscode` import. */

export type ClientId = "copilot" | "claude-code" | "cursor" | "cline" | "codex" | "zed" | "gemini" | "generic";

export interface ClientChoice {
  id: ClientId;
  label: string;
  /** Shown beside the label in the picker. */
  description: string;
}

/** The clients in the order the picker lists them: Copilot first, because VS Code needs nothing pasted. */
export const CLIENTS: readonly ClientChoice[] = [
  { id: "copilot", label: "GitHub Copilot", description: "Automatic in VS Code" },
  { id: "claude-code", label: "Claude Code", description: "One command" },
  { id: "cursor", label: "Cursor", description: "~/.cursor/mcp.json" },
  { id: "cline", label: "Cline", description: "Cline MCP settings" },
  { id: "codex", label: "Codex", description: "~/.codex/config.toml" },
  { id: "zed", label: "Zed", description: "Zed settings" },
  { id: "gemini", label: "Gemini CLI", description: "~/.gemini/settings.json" },
  { id: "generic", label: "Generic", description: "URL and header for any MCP client" },
];

/** What choosing Copilot explains: VS Code registers the server itself. */
export const COPILOT_AUTOMATIC_MESSAGE =
  "GitHub Copilot in VS Code finds MindStream by itself: nothing needs to be pasted. Open the MCP server list (MCP: List Servers) to see it.";
