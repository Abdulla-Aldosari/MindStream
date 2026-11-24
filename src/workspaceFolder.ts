/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

/**
 * The one place that decides which workspace folder MindStream serves.
 * Today it is the first folder; multi-root support changes only this function,
 * and the sidebar, the commands, and the MCP server all follow it.
 * It takes the folder list as an argument so it needs no `vscode` import.
 */
export function resolveWorkspaceFolder<T extends { uri: { fsPath: string } }>(folders: readonly T[] | undefined): T | undefined {
  return folders?.[0];
}
