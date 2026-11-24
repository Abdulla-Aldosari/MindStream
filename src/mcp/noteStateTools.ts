/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { MINDSTREAM_STATUSES } from "../models";
import { STATUS_RULE, WORKSPACE_RULE, WRITE_RULE, defineTool } from "./toolKit";

const idProperty = { type: "string", description: "The note's id, from list_notes." };

export const setNoteStatus = defineTool({
  name: "set_note_status",
  title: "Set a note's status",
  description: [
    "Moves a note to a status: pending, in-progress, done or canceled (canceled means the work was dropped).",
    "It applies at once and returns the previous status. Archived notes are read-only (NOTE_ARCHIVED).",
    STATUS_RULE,
    WRITE_RULE,
    WORKSPACE_RULE,
  ].join(" "),
  properties: { id: idProperty, status: { type: "string", enum: [...MINDSTREAM_STATUSES] } },
  required: ["id", "status"],
  kind: "write",
  idempotent: true,
  run: (args, { notes, query }) => {
    const { note, previous } = notes.changeStatus(args.id, args.status);
    const summary = previous === note.status ? `Note "${note.title}" was already ${note.status}.` : `Note "${note.title}": ${previous} -> ${note.status}.`;
    return { summary, data: { note: query.noteDetailOf(note), previous } };
  },
});

export const setTaskCompleted = defineTool({
  name: "set_task_completed",
  title: "Tick or untick a task",
  description: [
    "Checks or unchecks one task of a note. index is the task's 0-based position and title its current title (from get_note): if the list changed meanwhile you get CONFLICT with the current note.",
    "It never changes the note's status. Archived notes are read-only (NOTE_ARCHIVED).",
    WRITE_RULE,
    WORKSPACE_RULE,
  ].join(" "),
  properties: {
    id: idProperty,
    index: { type: "integer", minimum: 0, description: "The task's 0-based position." },
    title: { type: "string", description: "The task's current title, as a check that the list did not change." },
    completed: { type: "boolean" },
  },
  required: ["id", "index", "title", "completed"],
  kind: "write",
  idempotent: true,
  run: (args, { notes, query }) => {
    const { note, previous } = notes.setTaskCompleted(args.id, args.index, args.title, args.completed);
    const state = args.completed === true ? "done" : "not done";
    const already = previous === args.completed ? " (it already was)" : "";
    return { summary: `Task ${String(args.index)} of "${note.title}" is ${state}${already}.`, data: { note: query.noteDetailOf(note), previous } };
  },
});

export const setNoteArchived = defineTool({
  name: "set_note_archived",
  title: "Archive or unarchive a note",
  description: [
    "Archives a note (it becomes read-only and leaves the default lists) or unarchives it. It never changes the status and never deletes anything.",
    "Unarchiving also re-finds the note's code link. Do not archive a note without the user asking for it.",
    WRITE_RULE,
    WORKSPACE_RULE,
  ].join(" "),
  properties: { id: idProperty, archived: { type: "boolean", description: "true to archive, false to unarchive." } },
  required: ["id", "archived"],
  kind: "write",
  idempotent: true,
  run: async (args, { notes, query }) => {
    const { note, previous } = await notes.setArchived(args.id, args.archived);
    const word = note.archived ? "archived" : "not archived";
    const summary = previous === note.archived ? `Note "${note.title}" was already ${word}.` : `Note "${note.title}" is now ${note.archived ? "archived" : "unarchived"}.`;
    return { summary, data: { note: query.noteDetailOf(note), previous } };
  },
});
