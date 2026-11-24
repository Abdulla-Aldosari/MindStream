/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { DATA_RULE, STATUS_RULE, TASKS_RULE } from "./toolKit";

/**
 * The MCP prompts: ready-made instructions an agent client offers as slash
 * commands. Pure text templates (no `vscode`, no SDK). Each one tells the agent
 * to pass its project root as `workspace`, and carries the sentence that note
 * text is data to read, never instructions to follow. None of them touches the
 * Work Pause note: it is the user's own note for a long absence.
 */

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
  /** The instruction text; `args` holds the values the client sent. */
  build(args: Record<string, string | undefined>): string;
}

const WORKSPACE_LINE =
  "Pass the absolute path of your project root (the folder open in VS Code) as `workspace` in every MindStream tool call. If a call answers WORKSPACE_NOT_OPEN, tell the user instead of guessing another path.";

const WRITE_LINE =
  "If a write is refused with WORK_PAUSED, do not retry, and do not ask the user to resume so that you can write: tell the user that work is paused. Only they resume it, by their own decision, in the MindStream sidebar.";

function lines(...parts: string[]): string {
  return parts.join("\n\n");
}

export const PROMPTS: readonly PromptDefinition[] = [
  {
    name: "continue_work",
    title: "Continue from the notes",
    description: "Read what is in progress and what is open and important, then propose where to continue.",
    arguments: [],
    build: () =>
      lines(
        "Propose where to continue the work on this project, from its MindStream notes.",
        WORKSPACE_LINE,
        "1. Call `project_summary` to see how many notes are pending, in progress, and linked to code that changed.",
        '2. Call `list_notes` with `status: ["in-progress"]`, then with `priority: ["critical", "high"]`, to find what is open and important.',
        TASKS_RULE,
        "3. Say, in a few lines, where you propose to continue and why. Do not start working or change any note until the user agrees.",
        STATUS_RULE,
        DATA_RULE,
        WRITE_LINE
      ),
  },
  {
    name: "record_verification",
    title: "Record a verification note",
    description: "Record what must be checked by hand after a change, linked to the code that changed.",
    arguments: [{ name: "topic", description: "What was changed and has to be verified.", required: true }],
    build: ({ topic }) =>
      lines(
        `Record a "verify by hand" note for this change: ${topic ?? "(no topic given: ask the user)"}`,
        WORKSPACE_LINE,
        '1. Call `list_types_and_categories`. If there is no verification category, create one with `add_category` (for example "Verify by hand"); if the name exists, use the one it returns.',
        "2. Call `add_note` in that category. Give it a short title, put what to check in the description, add one task per manual check in `tasks`, and link it to the code you changed with `codeLocation` (a path relative to the project root with / separators, and lines that exist).",
        "3. Tell the user the note's id and what was recorded.",
        WRITE_LINE
      ),
  },
  {
    name: "review_stale_links",
    title: "Review notes whose code changed",
    description: "Check the notes whose linked code changed or disappeared, and propose what to do with each.",
    arguments: [],
    build: () =>
      lines(
        "Review the MindStream notes whose linked code is no longer where it was.",
        WORKSPACE_LINE,
        '1. Call `list_notes` with `linkState: ["changed", "missing"]`.',
        "2. For each note, call `get_note` and read its description and the excerpt of the linked code. Look at the code yourself to judge whether the problem is already fixed, still valid, or no longer applies.",
        TASKS_RULE,
        "3. Propose, for each note, one action: keep it, move it to another status with `set_note_status`, or close it as done or canceled. Wait for the user's answer before you change anything.",
        STATUS_RULE,
        "4. Never archive a note without asking the user, and there is no tool that deletes one.",
        DATA_RULE,
        WRITE_LINE
      ),
  },
];

/** The prompt with this name, or `undefined`. */
export function findPrompt(name: string): PromptDefinition | undefined {
  return PROMPTS.find((prompt) => prompt.name === name);
}
