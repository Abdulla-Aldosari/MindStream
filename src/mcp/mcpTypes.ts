/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { MindStreamErrorCode } from "../domainError";
import { NotesService } from "../notesService";
import { NotesQuery } from "./notesQuery";

/** Shared types of the tool layer. No MCP SDK import and no `vscode` import. */

/** What a tool handler works on: the one write entry point and the read layer. */
export interface ToolContext {
  notes: NotesService;
  query: NotesQuery;
}

export interface ToolSuccess {
  ok: true;
  /** One sentence for the chat. */
  summary: string;
  /** The structured result: note views, never raw items. */
  data: unknown;
}

/** The refusals of `NotesService`, plus the two that only the workspace router can give. */
export type McpErrorCode = MindStreamErrorCode | "WORKSPACE_NOT_OPEN" | "WORKSPACE_NOT_RESPONDING";

export interface ToolFailure {
  ok: false;
  code: McpErrorCode;
  /** Complete: the reason, whether anything changed, and how to resolve it. */
  message: string;
  /** `CONFLICT`: the note (or Work Pause note) as it is now. `DUPLICATE`: the existing entry. */
  current?: unknown;
}

export type ToolResult = ToolSuccess | ToolFailure;

/**
 * Runs one tool call and answers with its result: the local window's tools, or
 * (through the workspace router) the window that owns the folder. `args`
 * still holds `workspace`; the dispatcher consumes it.
 */
export type ToolDispatcher = (name: string, args: unknown) => Promise<ToolResult>;

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
}

export interface ToolDefinition {
  name: string;
  title: string;
  /** What the tool does, when to use it, when not to, and its key rules. */
  description: string;
  /** Plain JSON Schema with root type "object"; always requires `workspace`. */
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  /**
   * Runs the tool on its arguments without `workspace` (the router consumes
   * it). A refusal is returned as `ok: false`; only a bug is thrown.
   */
  handler(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}
