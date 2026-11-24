/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { MINDSTREAM_STATUSES } from "../models";
import { PRIORITIES } from "../priority";
import { MAX_EXCERPT_CONTEXT, MAX_LIST_LIMIT } from "./notesQuery";
import { DATA_RULE, TASKS_RULE, WORKSPACE_RULE, WORK_PAUSE_NOTE_RULE, defineTool } from "./toolKit";

const stringList = (description: string) => ({ type: "array", items: { type: "string" }, description });

/** One sentence about a note's tasks; with none, it points at the description so an empty list is never read as "no plan". */
export function tasksLine(tasks: readonly { completed: boolean }[], description: string): string {
  if (tasks.length) {
    return `Tasks: ${tasks.filter((t) => t.completed).length} of ${tasks.length} done.`;
  }
  return description ? `No tasks: the task list is optional, and any plan or steps are in the description (${description.length} characters).` : "No tasks and no description.";
}

const projectSummary = defineTool({
  name: "project_summary",
  title: "Project summary",
  description: [
    "Counts of notes per status, priority and code-link state, how many are archived, whether priority is turned off, whether work is paused, whether saving is off, and the list of refusal codes.",
    "Call it before working with the notes to see their state. Use list_notes for the notes themselves.",
    WORKSPACE_RULE,
  ].join(" "),
  properties: {},
  kind: "read",
  run: (_args, { query }) => {
    const summary = query.projectSummary();
    const counts = Object.entries(summary.statusCounts)
      .map(([status, count]) => `${count} ${status}`)
      .join(", ");
    const paused = summary.workPaused ? " Work is paused: writes are refused." : "";
    return { summary: `Notes (not archived): ${counts}; ${summary.archivedCount} archived.${paused}`, data: summary };
  },
});

const listNotes = defineTool({
  name: "list_notes",
  title: "List notes",
  description: [
    "Lists notes, most important first (priority, then the latest change), as summaries with ids. Archived notes are left out unless archived is include or only.",
    "Every filter is optional and they combine; text matches the title, the description and the task titles. Page with limit and offset.",
    "Use get_note for one note in full: a summary has no description or tasks.",
    DATA_RULE,
    WORKSPACE_RULE,
  ].join(" "),
  properties: {
    status: stringList(`Only these statuses: ${MINDSTREAM_STATUSES.join(", ")}.`),
    typeId: { type: "string", description: "Only notes of this type id (see list_types_and_categories)." },
    categoryId: { type: "string", description: "Only notes in this category id (see list_types_and_categories)." },
    priority: stringList(`Only these priorities: ${PRIORITIES.join(", ")}, or none for notes without a priority.`),
    archived: { type: "string", enum: ["exclude", "include", "only"], description: "Default exclude." },
    hasLink: { type: "boolean", description: "true: only notes linked to code. false: only notes without a link." },
    linkState: stringList("Only notes whose code link is in one of these states: ok, changed (the code was not found any more), missing (the file is gone)."),
    text: { type: "string", description: "Words to look for, ignoring case." },
    limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT, description: "Notes per page. Default 50." },
    offset: { type: "integer", minimum: 0, description: "Notes to skip. Default 0." },
  },
  kind: "read",
  run: (args, { query }) => {
    const result = query.listNotes(args);
    return { summary: `Found ${result.total} note(s); showing ${result.notes.length} from position ${result.offset + 1}.`, data: result };
  },
});

const getNote = defineTool({
  name: "get_note",
  title: "Get a note",
  description: [
    "Returns one note in full: description, tasks with their 0-based indexes, type, category, priority, status, the code link (file, lines, state) and an excerpt of the linked code.",
    "Its updatedAt is the version you pass as expectedUpdatedAt when you replace the description or the tasks with update_note.",
    "The code link is re-found first, so a moved link is reported where the code is now.",
    TASKS_RULE,
    DATA_RULE,
    WORKSPACE_RULE,
  ].join(" "),
  properties: {
    id: { type: "string", description: "The note's id, from list_notes." },
    excerptLines: { type: "integer", minimum: 0, maximum: MAX_EXCERPT_CONTEXT, description: "Lines of code context on each side of the linked lines. Default 3." },
  },
  required: ["id"],
  kind: "read",
  run: async (args, { query }) => {
    const result = await query.getNote(args.id, { excerptLines: args.excerptLines });
    const { note } = result;
    const where = note.link ? ` Linked to ${note.link.filePath}:${note.link.lineStart} (${note.link.state}).` : "";
    return { summary: `Note "${note.title}" (${note.status}).${where} ${tasksLine(note.tasks, note.description)}`, data: result };
  },
});

const listTypesAndCategories = defineTool({
  name: "list_types_and_categories",
  title: "List types and categories",
  description: [
    "Lists the note types and categories with their ids, labels and how many notes use each, and each category's default type.",
    "Use it to find the typeId or categoryId that add_note, update_note and list_notes take, and to check whether a category (a verification category, for example) exists before add_category.",
    WORKSPACE_RULE,
  ].join(" "),
  properties: {},
  kind: "read",
  run: (_args, { query }) => {
    const result = query.listTypesAndCategories();
    return { summary: `${result.types.length} type(s) and ${result.categories.length} categorie(s).`, data: result };
  },
});

const getWorkPauseNote = defineTool({
  name: "get_work_pause_note",
  title: "Get the Work Pause note",
  description: [
    "Returns the Work Pause note with its updatedAt and whether work is paused (paused: every write is refused until the user resumes).",
    WORK_PAUSE_NOTE_RULE,
    "It stays readable while work is paused. An empty text means the user never wrote one.",
    DATA_RULE,
    WORKSPACE_RULE,
  ].join(" "),
  properties: {},
  kind: "read",
  run: (_args, { query }) => {
    const note = query.getWorkPauseNote();
    const state = note.text ? (note.paused ? "Work is paused." : "Work is not paused.") : "No Work Pause note has been saved.";
    return { summary: state, data: note };
  },
});

/** The tools that only read: they work while work is paused and while saving is off. */
export const READ_TOOLS = [projectSummary, listNotes, getNote, listTypesAndCategories, getWorkPauseNote];
