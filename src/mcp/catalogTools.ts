/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { WORKSPACE_RULE, WRITE_RULE, defineTool } from "./toolKit";

export const addCategory = defineTool({
  name: "add_category",
  title: "Add a category",
  description: [
    "Creates a category, for example a verification category for 'verify by hand' notes. Names are unique ignoring case: if the name exists you get DUPLICATE with the existing category, which you can use.",
    "Check list_types_and_categories first.",
    WRITE_RULE,
    WORKSPACE_RULE,
  ].join(" "),
  properties: { label: { type: "string", description: "The category's name, at most 80 characters." } },
  required: ["label"],
  kind: "write",
  run: (args, { notes }) => {
    const category = notes.addCategory(args.label);
    return { summary: `Added category "${category.label}" (id ${category.id}).`, data: { category: { id: category.id, label: category.label } } };
  },
});

export const addType = defineTool({
  name: "add_type",
  title: "Add a type",
  description: [
    "Creates a note type. Names are unique ignoring case: if the name exists you get DUPLICATE with the existing type, which you can use.",
    "icon is an optional codicon name such as bug. Check list_types_and_categories first.",
    WRITE_RULE,
    WORKSPACE_RULE,
  ].join(" "),
  properties: {
    label: { type: "string", description: "The type's name, at most 80 characters." },
    icon: { type: "string", description: "A codicon name made of letters, digits and dashes." },
  },
  required: ["label"],
  kind: "write",
  run: (args, { notes }) => {
    const type = notes.addType(args.label, args.icon);
    return { summary: `Added type "${type.label}" (id ${type.id}).`, data: { type: { id: type.id, label: type.label, icon: type.icon ?? null } } };
  },
});
