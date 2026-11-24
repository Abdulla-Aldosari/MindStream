/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { MINDSTREAM_STATUSES } from "../models";
import { PRIORITIES } from "../priority";
import { CodeLocation } from "../notesService";
import { NoteField } from "../noteInput";
import { TASKS_RULE, WORKSPACE_RULE, WRITE_RULE, defineTool } from "./toolKit";

const taskSchema = {
  type: "array",
  description: "Checklist items, in order.",
  items: {
    type: "object",
    properties: { title: { type: "string" }, completed: { type: "boolean" } },
    required: ["title", "completed"],
    additionalProperties: false,
  },
};

const idProperty = { type: "string", description: "The note's id, from list_notes." };

export const addNote = defineTool({
  name: "add_note",
  title: "Add a note",
  description: [
    "Creates a note. Use it for out-of-scope findings you must not fix now and for 'verify by hand' items.",
    "codeLocation links the note to code: filePath is relative to the project root with / separators, and the lines must exist; the extension builds the link from the file's real content.",
    "Omit typeId to use the category's default type and categoryId to use General. Omit priority to use the default; while priority is turned off a priority is refused.",
    "Do not use it to change an existing note: use update_note.",
    TASKS_RULE,
    WRITE_RULE,
    WORKSPACE_RULE,
  ].join(" "),
  properties: {
    title: { type: "string", description: "One line, at most 300 characters." },
    description: { type: "string", description: "Details, at most 50000 characters." },
    typeId: { type: "string", description: "A type id from list_types_and_categories." },
    categoryId: { type: "string", description: "A category id from list_types_and_categories." },
    priority: { type: "string", enum: [...PRIORITIES] },
    status: { type: "string", enum: [...MINDSTREAM_STATUSES], description: "Default pending. Set another status only when the user asks for it." },
    tasks: taskSchema,
    codeLocation: {
      type: "object",
      description: "The code the note is about.",
      properties: {
        filePath: { type: "string", description: "Relative to the project root, with / separators." },
        lineStart: { type: "integer", minimum: 1 },
        lineEnd: { type: "integer", minimum: 1, description: "Omit for a single line." },
      },
      required: ["filePath", "lineStart"],
      additionalProperties: false,
    },
  },
  required: ["title"],
  kind: "write",
  run: async (args, { notes, query }) => {
    const { codeLocation, title, ...rest } = args;
    const input = { title, ...rest };
    // The service checks every field of the location: a malformed one is refused as LINK_INVALID.
    const link = codeLocation === undefined ? undefined : await notes.linkFor(codeLocation as CodeLocation);
    const note = notes.addNote(input, link);
    const where = link ? `, linked to ${link.filePath}:${link.lineStart}` : "";
    return { summary: `Added note "${note.title}" (id ${note.id})${where}.`, data: { note: query.noteDetailOf(note) } };
  },
});

export const updateNote = defineTool({
  name: "update_note",
  title: "Update a note",
  description: [
    "Changes a note's fields. To add findings, use appendDescription: it adds a paragraph and never overwrites.",
    "To replace the description or the task list, pass expectedUpdatedAt from get_note; if the note changed meanwhile you get CONFLICT with the current note: redo your change on it.",
    "Title, type, category and priority change at once. Code links cannot be edited. Archived notes are read-only (NOTE_ARCHIVED).",
    "Use set_note_status to change the status and set_task_completed to tick one task.",
    TASKS_RULE,
    WRITE_RULE,
    WORKSPACE_RULE,
  ].join(" "),
  properties: {
    id: idProperty,
    title: { type: "string" },
    typeId: { type: "string" },
    categoryId: { type: "string" },
    priority: { type: "string", enum: [...PRIORITIES] },
    appendDescription: { type: "string", description: "Text added as a new paragraph after the description." },
    description: { type: "string", description: "Replaces the whole description. Needs expectedUpdatedAt." },
    tasks: { ...taskSchema, description: "Replaces the whole task list ([] clears it). Needs expectedUpdatedAt." },
    expectedUpdatedAt: { type: "string", description: "The note's updatedAt from get_note." },
  },
  required: ["id"],
  kind: "write",
  destructive: true,
  run: (args, { notes, query }) => {
    const { id, expectedUpdatedAt, ...patch } = args;
    const { note, changes } = notes.updateNote(id, patch, { expectedUpdatedAt });
    const fields = changes.map((change: { field: NoteField }) => change.field);
    const summary = fields.length ? `Updated note "${note.title}": ${fields.join(", ")}.` : `Note "${note.title}" already had these values; nothing was written.`;
    return { summary, data: { note: query.noteDetailOf(note), changes } };
  },
});
