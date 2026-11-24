/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { ToolDefinition } from "./mcpTypes";
import { READ_TOOLS } from "./readTools";
import { addNote, updateNote } from "./writeTools";
import { setNoteArchived, setNoteStatus, setTaskCompleted } from "./noteStateTools";
import { addCategory, addType } from "./catalogTools";

/**
 * Every MCP tool, in the order a client lists them. Each one is a thin call to
 * `NotesService` (writes) or `NotesQuery` (reads): the rules live there, never
 * here. There is no tool that deletes anything, pauses or resumes work, writes
 * the Work Pause note (it is the user's own), edits a code link, imports,
 * exports, or changes settings.
 */
export const MCP_TOOLS: readonly ToolDefinition[] = [...READ_TOOLS, addNote, updateNote, setNoteStatus, setTaskCompleted, setNoteArchived, addCategory, addType];

/** The tool with this name, or `undefined`. */
export function findTool(name: string): ToolDefinition | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}
