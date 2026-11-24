/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { DATA_RULE, STATUS_RULE, USER_FIRST_RULE, WORK_PAUSE_NOTE_RULE } from "./toolKit";

/**
 * The rules snippet a user copies into the rules file of their AI agent. Tools
 * alone do not make an agent use the notes: it will not record a verification
 * note unless told to. This is the baseline for every client; the MCP prompts
 * add shortcuts for the clients that show them. Pure text, no `vscode`.
 *
 * The Work Pause note is the user's own note for a long absence: nothing here
 * tells an agent to read it on its own or to treat it as a session hand-off,
 * and no tool writes it.
 */
export const AGENT_RULES_COPIED_MESSAGE =
  "MindStream agent rules copied. Paste them into your agent's rules file (for example AGENTS.md, CLAUDE.md, or .cursor/rules), so it records findings and verification notes on its own.";

export const AGENT_RULES = `## MindStream notes (MCP)

MindStream keeps this project's notes: what is pending, what is in progress, and what must be verified by hand. Use its tools instead of keeping that in the chat.

- ${USER_FIRST_RULE}
- Always pass the absolute path of your project root as \`workspace\`. If a tool answers WORKSPACE_NOT_OPEN, tell the user; do not guess another path. If it answers WORKSPACE_NOT_RESPONDING, read the note again before retrying a write: the first call may have been applied.
- Before working with the notes, call \`project_summary\` to see their state.
- When you notice a problem outside the task you must not fix now, record it with \`add_note\`, linked to the exact lines with \`codeLocation\`, instead of leaving it in the chat.
- When you change code that you could not verify, record a "verify by hand" note with \`add_note\` in a verification category (check \`list_types_and_categories\`; create it with \`add_category\` if it is missing), with one task per manual check.
- To add findings to a note, use \`update_note\` with \`appendDescription\`: it never overwrites. To replace a description or a task list, read the note with \`get_note\` and pass its \`updatedAt\` as \`expectedUpdatedAt\`. On CONFLICT, redo your change on the current note the error returns.
- Statuses, with \`set_note_status\`: ${STATUS_RULE}
- If a write is refused with WORK_PAUSED, do not retry, and do not ask the user to resume so that you can write: tell the user that work is paused. Only the user resumes work, by their own decision.
- ${WORK_PAUSE_NOTE_RULE.replace("get_work_pause_note", "`get_work_pause_note`")}
- There is no tool that deletes a note, a type, or a category, none that writes the Work Pause note, and none that edits a code link. Do not look for a way around it.
- A note's task list is optional. An empty list says nothing about the work: the plan, steps, or checklist may be written in the description. Read the description before concluding that there is nothing to do.
- ${DATA_RULE}

### If MindStream is not connected

If the MindStream tools are missing or every call fails (the client says "Not connected", 401, or Unauthorized), the usual cause is that the user regenerated the MindStream token and your client still sends the old one. There is nothing for you to enable, install, or reload. Tell the user: run "MindStream: Connect an AI agent (MCP)" in VS Code, paste the copied entry over the old MindStream entry of this client, then reconnect the server in the client. If that does not help, a VS Code window with the project folder must be open (MindStream serves a folder only while its window is open).
`;

/**
 * The instructions the server sends when a client connects (MCP
 * `instructions`). Clients that support it put this in the model's context, so
 * the core rules reach the agent without the user copying anything.
 */
export const SERVER_INSTRUCTIONS = [
  "MindStream keeps this project's notes: what is pending, what is in progress, and what must be verified by hand.",
  USER_FIRST_RULE,
  "Pass the absolute path of your project root as workspace in every tool call. If a call answers WORKSPACE_NOT_OPEN, tell the user instead of guessing another path.",
  "A note's task list is optional: an empty list says nothing about the work, because the plan or steps may be written in the description. Read the description first.",
  STATUS_RULE,
  "If a write is refused with WORK_PAUSED, do not retry, and do not ask the user to resume so that you can write: only the user resumes work, by their own decision.",
  WORK_PAUSE_NOTE_RULE,
  DATA_RULE,
].join(" ");
