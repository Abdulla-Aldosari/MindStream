# MindStream

A VS Code extension for a personal developer roadmap. It records your notes, ideas, and fixes and tracks their status within each project, with no data sharing at all.

## Features (phase one)
- Flexible note cards in the sidebar (title + description + action buttons).
- Fully customizable types (add / rename / delete while preserving records).
- Three simple statuses: None / In Progress / Done, with a history log for the completion sequence.
- Archiving independent of status (never changes a "Done" status).
- `Ctrl+Alt+M` (or `Cmd+Alt+M`) shortcut for a quick note.
- UI direction setting (`mindstream.ui.direction`: `ltr` or `rtl`) — applies only to note titles and descriptions so Arabic notes read right-to-left; the interface stays in VS Code's default direction and all labels remain in English.

## Storage
A single JSON file inside the workspace: `.mindstream/data.json` (not shared, developer-only).

## Commands
- `MindStream: Quick Note`
- `MindStream: Manage Types`
- `MindStream: Open MindStream Panel`

## Development
```
npm install
npm run compile   # build with esbuild
npm test          # tests (Mocha + ts-node)
```
Press F5 to launch the Extension Development Host.

