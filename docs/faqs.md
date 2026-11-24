# MindStream FAQ

Answers to common questions, and how to fix the problems you may meet.
[Back to README](../README.md) · [Settings reference](settings.md)

## Contents

- [General](#general)
- [Notes and organization](#notes-and-organization)
- [Code links](#code-links)
- [Work Pause](#work-pause)
- [Import and export](#import-and-export)
- [Data safety](#data-safety)
- [AI agents (MCP)](#ai-agents-mcp)
- [MCP troubleshooting](#mcp-troubleshooting)

## General

### Where are my notes stored?

In one file inside your project: `.vscode/mindstream.data.json`. It holds the
notes, the types, the categories, and the Work Pause note. Your emoji list,
the description field's height, and the **View** menu choices are kept by
VS Code instead (see
[Preferences that are not settings](settings.md#preferences-that-are-not-settings)).

### Should I commit the data file to Git?

Either choice works:

- **Commit it** to share notes with your team, keep their history, and get
  them back on another computer. Changes pulled from Git appear in the panel on
  their own.
- **Add it to `.gitignore`** to keep your notes to yourself.

### Do my notes leave my computer?

No. MindStream has no account, no cloud, and no telemetry, and it sends nothing
to the internet. The only network it uses is its local MCP server on
`127.0.0.1`, for AI agents on the same machine. See
[Privacy & Security](../README.md#privacy--security).

### Why does MindStream ask me to open a folder?

Notes belong to a project and are stored inside its folder, so MindStream needs
an open folder. Choose **Open Folder** in its message, or **File → Open
Folder**.

### I use a multi-root workspace. Where do the notes go?

Into the **first** folder of the workspace:
`.vscode/mindstream.data.json` inside that folder. The other folders are not
used.

## Notes and organization

### How do I mark a note as canceled?

`Ctrl+Shift+Click` (`Cmd+Shift+Click` on macOS) its status badge. Do it again to
return it to **None**. Canceled is kept out of the normal click cycle so it is
never set by accident. See
[Statuses and Archive](../README.md#statuses-and-archive).

### Why can't I edit an archived note?

Archived notes are read-only, so a finished note stays as it was. You can still
view, unarchive, or delete it. Unarchive it (the archive icon on its card) to
change it again.

### What happens when I delete a type or a category?

- **A category:** after you confirm, the category **and every note in it** are
  deleted. The built-in **General** category cannot be deleted, only renamed.
- **A type:** it can be deleted only when no note uses it and it is not the last
  type. Move those notes to another type first. **Restore Default Types** adds
  back any built-in type you removed.

### Where did the priority go?

[Priority style](settings.md#priority-style) is set to `off`. Choose a style
again; the saved priorities were kept. If you see priorities but some notes are
missing, check the **View** menu: a priority level may be hidden.

### How do I write notes in Arabic?

Set [Text direction](settings.md#text-direction) to `rtl` so titles and
descriptions read right-to-left. The Work Pause note picks its direction by
itself.

### How long can a note be?

A title can have up to 300 characters, a description up to 50,000, and a note
up to 200 tasks of 500 characters each. Type and category names can have up to
80 characters. Text over a limit is refused, never cut.

## Code links

### How do I link a note to code?

Right-click a line, or select several lines, in the editor and choose **Add
note to this line**. The file must be inside the project folder. See
[Notes Linked to Code](../README.md#notes-linked-to-code).

### What do "changed" and "missing" mean on a link badge?

<!-- asset: link-badge-states.png -->

![A code link badge in its changed and missing states](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

- **Changed:** the linked code was edited or removed, so MindStream could not
  find it again. The badge keeps the last known position and warns you.
- **Missing:** the file was deleted or moved out of the project. The badge is
  struck through.

In both cases the note is kept. When the file or the code comes back, the badge
returns to normal at the next check (when VS Code regains focus, or when you
open the link).

### Can I change a note's link?

No. A link is created only from the editor and cannot be edited, added, or
removed afterward. To point at different code, add a new note there.

### Do links survive a `git pull` or a branch switch?

Yes. When code moves outside the editor, MindStream finds it again from a
snapshot of the linked lines, on startup and whenever the window regains focus.

## Work Pause

### What is the Work Pause note?

A note you write to yourself before a long break from a project: where you
stopped, what is half-done, and what comes next. While work is paused, the
panel shows only that note, so it is the first thing you read when you come
back. See [Work Pause Note](../README.md#work-pause-note).

### How do I get out of Work Pause?

<!-- asset: work-pause-locked.png -->

![The locked panel showing the Work Pause note with its Resume work button](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

Use one of these:

- **Resume work** on the note card (the note is kept).
- **Delete & resume** on the note card (the note is deleted after you confirm).
- `✓ Work paused - click to resume` in the **More** (`...`) menu.

### Why are the commands and buttons gone?

While work is paused, every action that changes notes is hidden and refused, an
AI agent's included, so nothing changes until you come back.
**Open MindStream Panel** and the **More** menu stay available, so you can
always reach the note and resume.

### Can an AI agent pause or resume work?

No. An agent can read the Work Pause note when you ask it to, but it can never
write it, pause, or resume. Only you resume work.

## Import and export

### What is the difference between Merge and Replace?

- **Merge** adds the notes, types, and categories from the file that you do not
  already have, and keeps all of yours and your Work Pause note.
- **Replace** swaps all your data for the file's.

Before you choose, MindStream shows how many notes, types, and categories each
side has.

> [!WARNING]
> **Replace** removes every current note, type, and category. Run **Export
> JSON** first if you may want them back.

### Can an import lock me out with Work Pause?

No. An imported Work Pause note is never imported as paused.

### Why was my file refused?

**Import JSON** accepts only MindStream data, such as a file made by **Export
JSON**. Any other JSON file is refused with the reason, and nothing is changed.

### What is in the Markdown export?

Every note, archived ones included: its type, title, status, category, dates,
description, and tasks. The Work Pause note is not exported.

## Data safety

### A message says "Not saved: … Nothing was changed." What happened?

MindStream refused to save because it could not do so safely. Nothing was
written, and the message ends with how to fix it:

- **"cannot read its data file":** another program (an antivirus, a sync tool)
  is locking the file. Close it, then return to VS Code or run **MindStream:
  Refresh**.
- **"is not valid":** the file was damaged, for example by a broken merge.
  Fix it, or restore it from Git. MindStream reloads it as soon as it changes.
- **"could not write":** check that the folder is writable and the disk has
  free space, then try again.

While the problem lasts, saving stays off so the file is never overwritten.
When it is fixed, MindStream says "Saving is back on".

### The form says the note was changed elsewhere. What now?

Someone else changed the note after you opened it: another window, a
`git pull`, or an AI agent. To avoid overwriting their change, **Save** is
refused, and the form keeps what you typed. Copy what you need, cancel, open the
note again, and apply your changes to the new version.

### Can a crash corrupt my notes?

No. MindStream writes to a temporary file first and then swaps it in, so the
data file is never left half-written.

## AI agents (MCP)

### Which agents work with MindStream?

GitHub Copilot (no setup), Claude Code, Cursor, Cline, Codex, Zed, Gemini CLI,
and any MCP client that supports Streamable HTTP. Run **MindStream: Connect an
AI agent (MCP)** and follow the steps. See
[Use MindStream with AI Agents (MCP)](../README.md#use-mindstream-with-ai-agents-mcp).

### Does MindStream call an AI model?

No. It makes no model call and needs no API key. The intelligence is whatever
model your agent already uses.

### Can an agent delete my notes?

No. No tool deletes anything. An agent can add and edit notes, change a status,
tick a task, archive, and add a type or category. A note you are editing is
never overwritten by an agent's change.

### Do I need to configure each project?

No. One entry in your agent serves every project you have open in VS Code. The
agent passes the project folder with each call.

## MCP troubleshooting

### The agent says "Not connected" (or 401 / Unauthorized)

Its entry holds an old token, usually after **Regenerate MCP token**. Run
**MindStream: Connect an AI agent (MCP)**, paste the copied entry over the old
one, and reconnect the server in the agent. Do it for every agent: an agent
inside WSL keeps its own entry (for Cline, its own `cline_mcp_settings.json`).
VS Code also warns once when an agent sends an old token, with a button that
opens the same command.

### The status bar shows `$(warning) MCP`

Another program uses the port. Set [MCP port](settings.md#mcp-port) to a free
port, then copy each agent's entry again.

### A call answers `WORKSPACE_NOT_OPEN`

Open the project folder in VS Code. MindStream serves a folder only while its
window is open.

### A call answers `WORKSPACE_NOT_RESPONDING`

The window of that folder did not answer in time. The call may have been
applied anyway, so read the note again before you retry.

### An agent on Windows cannot reach my WSL project

MindStream runs on the machine of each window, and each machine has its own
port. Run the agent on the same machine as the project: inside WSL for a WSL
project. See [Remote development](../README.md#remote-development).

---

Still stuck? Open an issue on
[GitHub](https://github.com/Abdulla-Aldosari/MindStream/issues).
