<a href="https://github.com/Abdulla-Aldosari/MindStream"><img src="icons/mindstream.png" width="128" alt="MindStream logo"></a>

# MindStream for Visual Studio Code

Capture notes and ideas as they happen, link them to the exact lines of code
they are about, organize them into your own types and categories, and track
them from idea to done, without ever leaving the editor.

<!-- asset: hero.gif -->

![Capturing a coding idea as a note in MindStream](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

_A thought strikes mid-code. One shortcut later, it's a saved note, without ever leaving the editor._

## Contents

- [Why MindStream?](#why-mindstream)
- [Getting Started](#getting-started)
- [Key Features](#key-features)
- [Use MindStream with AI Agents (MCP)](#use-mindstream-with-ai-agents-mcp)
- [Keyboard and Mouse Shortcuts](#keyboard-and-mouse-shortcuts)
- [Commands](#commands)
- [Settings](#settings)
- [Data and Storage](#data-and-storage)
- [Privacy & Security](#privacy--security)
- [Requirements](#requirements)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Why MindStream?

- **Never lose a thought.** Ideas, bugs, and to-dos show up while you are busy
  with something else. One shortcut captures them in the sidebar, and you keep
  coding.
- **Notes that know where they belong.** A note can point at the exact lines it
  is about, and the link follows the code when lines move or the file is
  renamed.
- **Your notes, your files.** Everything lives in one JSON file inside your
  project. Commit it to share it with your team, or ignore it to keep it
  private. No account, no cloud, no telemetry.
- **A memory for your AI agent.** Coding agents forget everything between
  sessions. Through MCP they can read what is pending and in progress, and
  record their own findings as notes you review.
- **Built not to lose data.** A refused or failed save changes nothing, a note
  edited elsewhere is never silently overwritten, and a damaged data file is
  never replaced.

## Getting Started

1. Install **MindStream - Notes** from the Extensions view and open a project
   folder.
2. Click the **MindStream** icon in the Activity Bar to open the **Notes**
   panel.
3. Press `Ctrl+Alt+M` (`Cmd+Alt+M` on macOS), type a title, and click **Save**.
4. To attach a note to code, right-click a line (or a selection) in the editor
   and choose **Add note to this line**.

> [!NOTE]
> MindStream stores notes per project, so it needs an open folder. Without one,
> it offers to open a folder for you.

## Key Features

The features with a demo come first and are explained in detail; the others
follow with a shorter description.

| Feature                                                       | In short                                              |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| [Quick Capture](#quick-capture)                               | A new note from anywhere with one shortcut            |
| [Notes Linked to Code](#notes-linked-to-code)                 | Links that follow the code as it moves                |
| [Statuses and Archive](#statuses-and-archive)                 | None, In Progress, Done, Canceled, and an archive     |
| [Types, Categories, and Views](#types-categories-and-views)   | Your own labels, icons, filters, grouping, and sort   |
| [Task Checklists](#task-checklists)                           | A checklist with a progress bar inside any note       |
| [Work Pause Note](#work-pause-note)                           | A hand-off note to yourself before a long break       |
| [AI Agent Memory (MCP)](#ai-agent-memory-mcp)                 | Your coding agent reads and records notes             |
| [Priority Levels](#priority-levels)                           | Critical, High, Medium, Low, in the style you choose  |
| [Description in an Editor Tab](#description-in-an-editor-tab) | Write long descriptions in a full editor              |
| [Weekly Report](#weekly-report)                               | What you created, finished, and archived this week    |
| [Note Viewer and Copy](#note-viewer-and-copy)                 | Read a note in full and copy it as Markdown           |
| [Emoji Picker](#emoji-picker)                                 | Emoji in titles, descriptions, and tasks              |
| [Export and Import](#export-and-import)                       | Markdown and JSON export, JSON import (merge/replace) |
| [Right-to-Left Notes](#right-to-left-notes)                   | Arabic and other RTL notes read naturally             |
| [Safe by Design](#safe-by-design)                             | No partial writes, no silent overwrites               |

### Highlights

#### Quick Capture

<!-- asset: quick-capture.gif -->

![Opening the note form with Ctrl+Alt+M and saving a new note](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

A note takes seconds to write, so you write it when the thought arrives.

- Press `Ctrl+Alt+M` (`Cmd+Alt+M` on macOS), click **+** in the panel title,
  or run **MindStream: Quick Note**. The panel opens with an empty form.
- A note has a **title**, an optional **description**, a **type**, a
  **category**, a **priority**, and an optional **task list**.
- The type is picked for you from the category's default type, so most notes
  need only a title.
- If a form with unsaved changes is already open, MindStream asks whether to
  save or discard them first, so nothing you typed is lost.

> [!TIP]
> Closing a changed form asks before discarding it. To close it at once
> instead, see
> [Note form close behavior](docs/settings.md#note-form-close-behavior).

#### Notes Linked to Code

<!-- asset: code-links.gif -->

![Adding a note to a line, then editing the file while the link follows the code](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

Point a note at the code it is about, and come back to that exact spot later.

- Right-click a line, or select several lines, and choose **Add note to this
  line**. The note shows a badge such as `src/app.ts:42`; click it to open the
  file at that line.
- **The link follows the code.** Add or remove lines above it and it moves;
  rename or move the file (or its folder) and the path is updated; change the
  code outside VS Code (a `git pull`, a branch switch) and MindStream finds the
  code again at its new line.
- **It tells you when it cannot.** If the code was edited or removed, the badge
  warns that it **changed** and keeps the last position; if the file was
  deleted, the badge is struck through as **missing**. The note itself is never
  deleted, and the link recovers when the file or the code comes back.
- A long path is shortened from the middle, so the file name always stays
  visible.

> [!NOTE]
> A link is created only from the editor and cannot be edited afterward. To
> point at different code, add a new note there. See the
> [code links FAQ](docs/faqs.md#code-links).

#### Statuses and Archive

<!-- asset: statuses-archive.gif -->

![Clicking a status badge to move a note through its statuses, then archiving it](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

Every note has a status, changed with one click on its badge.

| Status      | Meaning                         | How to get there                                      |
| ----------- | ------------------------------- | ----------------------------------------------------- |
| None        | Not started (the default)       | Click a Done note, or `Ctrl+Click` an In Progress one |
| In Progress | Being worked on                 | Click a None note                                     |
| Done        | Finished; the time is recorded  | Click an In Progress note, or `Ctrl+Click` a None one |
| Canceled    | Dropped, but kept for reference | `Ctrl+Shift+Click` (again to return it to None)       |

- A plain click moves forward: None → In Progress → Done → None. On macOS, use
  `Cmd` instead of `Ctrl`.
- **Canceled** is never set by accident: only `Ctrl+Shift+Click` moves a note
  into or out of it.
- The MindStream icon in the Activity Bar shows how many notes are **In
  Progress**.
- **Archive** a note to put it away without changing its status. The
  **Archive** button in the toolbar shows or hides archived notes.

> [!IMPORTANT]
> An archived note is read-only: you can view, unarchive, or delete it, but not
> edit it or tick its tasks. Unarchive it first to change it.

#### Types, Categories, and Views

<!-- asset: organize.gif -->

![Adding a category, creating a type with its own icon, then filtering and grouping the list](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

_Add a category, create a type with its own icon, then filter and group the
list, all from the sidebar._

- **Types** say what a note is. A new project starts with eleven: General,
  Task, Issue, Idea, Feature, Plan, Refactor, Question, Docs, Test, and
  Resource. Add your own, rename them, and give each an icon from VS Code's
  icon set. **Restore Default Types** adds back any default you removed,
  without touching yours.
- **Categories** say where a note belongs (a module, a release, a client).
  Each category can have a **default type** that its new notes start with. The
  built-in **General** category can be renamed but not deleted.
- **Filters** in the toolbar narrow the list to one category and one type.
- The **View** menu groups notes (by status, by priority, or not at all), sorts
  them (by date modified, fixed order, status, or priority), and hides the
  priority levels you do not want to see. Groups can be collapsed and show how
  many notes they hold.
- Renaming a type or a category never breaks a note: notes refer to them by a
  stable id, not by name.

> [!WARNING]
> Deleting a category permanently deletes every note in it (you are asked to
> confirm first). A type can be deleted only when no note uses it and it is not
> the last type.

#### Task Checklists

<!-- asset: task-checklists.gif -->

![Adding tasks to a note, reordering them by drag, and ticking them in the viewer](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

Any note can hold an ordered checklist, so a plan and its steps stay together.

- Add tasks under **Tasks (optional)** in the note form. A progress bar
  (`done/total`) appears on the card and in the viewer, and turns green when
  every task is done.
- Tick tasks in the viewer, in any order. Ticking a task never changes the
  note's status.
- Keyboard: `Enter` adds a task below, `Backspace` in an empty task removes
  it, `Alt+↑` / `Alt+↓` moves it, and `Ctrl+↑` / `Ctrl+↓` jumps between tasks.
  You can also drag a task by its number.
- With more than five tasks, **Focus mode** folds the description away so the
  whole list fits on screen.
- A note holds up to 200 tasks.

#### Work Pause Note

<!-- asset: work-pause.gif -->

![Writing a Work Pause note, the locked panel, and resuming work](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

Before you step away from a project for a long time, write down where you
stopped and what comes next. When you come back, it is the first thing you see.

- Choose **Pause work and show note** in the **More** (`...`) menu, write the
  note, and save it. The panel is locked and shows only that note until you
  click **Resume work** on it.
- While work is paused, every change is refused, an AI agent's included, so
  the project stays exactly as you left it.
- The note understands light formatting: `# ` headings, `[ ]` / `[x]`
  checkboxes, `---` dividers, and `` `code` ``. **Preview formatting** shows
  the result before you save, and **Formatting example** shows every pattern.
- **Copy note**, or **Open in editor** to keep a read-only copy in a tab while
  you work. **Delete & resume** removes the note and unlocks the panel.
- Pausing again shows your earlier note first, with the choice to keep it or to
  start a new one.
- The text direction comes from the first line, so a note written in Arabic
  reads right-to-left on its own.

> [!NOTE]
> Only you can resume work: click **Resume work** or **Delete & resume** on the
> note, or `✓ Work paused - click to resume` in the **More** menu. See the
> [Work Pause FAQ](docs/faqs.md#work-pause).

#### AI Agent Memory (MCP)

<!-- asset: mcp-agent.gif -->

![An AI agent adding a note through MCP while the note appears in the sidebar](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

Your coding agent forgets everything between sessions. MindStream gives it a
memory that you can see and edit.

- The agent reads what is pending, in progress, or important, and the code each
  note points to.
- It records its own findings and "verify by hand" items as notes, linked to
  the exact lines.
- It moves a note to **In Progress** when you ask it to work on it, and asks you
  before marking anything done.
- It cannot delete anything, and it never writes your Work Pause note.

MindStream makes no model call of its own: the intelligence is whatever model
your agent already runs. Setup takes one command; see
[Use MindStream with AI Agents (MCP)](#use-mindstream-with-ai-agents-mcp).

### More Features

#### Priority Levels

<!-- asset: priority-styles.png -->

![The four priority display styles: dot, edge stripe, chip, and type-badge stripe](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

Give each note a priority: **Critical**, **High**, **Medium**, or **Low** (new
notes start at Low). Choose how it is shown on cards: a dot before the title, a
stripe on the card edge, a chip next to the status, or a stripe on the type
badge. Sort or group by priority from the **View** menu, or hide the levels you
do not want to see.

> [!TIP]
> Not using priorities? Set [Priority style](docs/settings.md#priority-style)
> to `off`. Saved priorities are kept and come back when you turn it on again.

#### Description in an Editor Tab

<!-- asset: description-tab.png -->

![The note form beside a full editor tab holding the note's description](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

Long descriptions are hard to write in a narrow sidebar. Click the **Edit in an
editor tab** icon next to **Description** to edit it in a normal VS Code tab,
with Markdown highlighting and word wrap; the form follows every change. The
note is stored only when you click **Save** in the form. What closing the tab
does with your edits is set by
[Description tab close behavior](docs/settings.md#description-tab-close-behavior).

#### Weekly Report

<!-- asset: weekly-report.png -->

![The Weekly Report window with its counts and lists of notes](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

Click the graph icon in the panel title to see your week at a glance: how many
notes you created, completed, and archived since Monday, and what is in
progress now, with the completed and in-progress notes listed. **Export Weekly
Report** in the **More** menu saves it as a Markdown file, ready for a stand-up
or a status update.

### Everyday Essentials

#### Note Viewer and Copy

Double-click a card (or click its eye icon) to read the whole note: the
description, the checklist, the code link, and the dates. The viewer's options
menu copies the note's ID, or its content as Markdown (title, description, and
tasks). To add the category, type, status, and dates to the copy, turn on
[Copy note info](docs/settings.md#copy-note-info).

#### Emoji Picker

In a title, a description, or a task, press `Ctrl+Shift+/` (`Cmd+Shift+/` on
macOS) to open the emoji picker, or `Ctrl+/` (`Cmd+/`) to insert the emoji you
used last. The emoji list is yours to edit, and **Restore original emoji list**
brings back the default. The list and your recent emoji are shared by all your
projects.

#### Export and Import

- **Export Markdown** writes every note, archived ones included, to a readable
  Markdown file.
- **Export JSON** saves a full copy of the project's data, ready to import
  elsewhere.
- **Import JSON** checks that the file really holds MindStream data, shows how
  many notes, types, and categories it has, and lets you choose:
  - **Merge** adds what is missing and keeps everything you have.
  - **Replace** swaps your data for the file's.

All three are in the **More** (`...`) menu. See the
[import and export FAQ](docs/faqs.md#import-and-export).

> [!WARNING]
> **Replace** removes every current note, type, and category. Run **Export
> JSON** first if you may want them back.

#### Right-to-Left Notes

Writing notes in Arabic or another right-to-left language? Set
[Text direction](docs/settings.md#text-direction) to `rtl` so note titles and
descriptions read right-to-left. The rest of the interface keeps VS Code's
layout.

#### Safe by Design

MindStream treats your notes as something you cannot afford to lose:

- **Atomic writes.** The data file is written to a temporary file first, then
  swapped in, so a crash never leaves it half-written.
- **A refused save changes nothing.** If the file cannot be written, or is
  damaged, MindStream tells you why, changes nothing, and stops saving until
  the problem is fixed. It never replaces a file it cannot read.
- **No silent overwrites.** If a note changes elsewhere (another window, a
  `git pull`, an AI agent) while you edit it, the form tells you and keeps what
  you typed instead of overwriting either version.
- **Outside changes show up by themselves.** Editing the data file by hand,
  switching branches, or pulling new notes refreshes the panel.

See [what to do when a save is refused](docs/faqs.md#data-safety).

## Use MindStream with AI Agents (MCP)

MindStream is the project's memory for your coding agent. The agent knows the
code, the git history, and the current conversation, but it forgets everything
between sessions. Through the Model Context Protocol (MCP) it can read what is
pending, what is in progress, and what must be verified by hand, and it can
record its own findings. MindStream adds no AI client and makes no model call:
the intelligence is whatever model your agent already runs.

It is always on. In every VS Code window that has a folder open, MindStream
serves that folder's notes on `127.0.0.1`, with no setting to turn on. It adds
nothing to the status bar while it works; a `$(warning) MCP` item appears only
when another program holds its port.

### Connect an agent, once

1. Run **`MindStream: Connect an AI agent (MCP)`** (Command Palette or the **More** menu).
2. Pick your agent. MindStream copies its configuration to the clipboard and tells you where to paste it.
3. Paste it once. It is a single global entry, the same for every project: you never configure a project separately.

| Agent            | What you do                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------- |
| GitHub Copilot   | Nothing. VS Code lists MindStream by itself (`MCP: List Servers`).                       |
| Claude Code      | Run the copied `claude mcp add ...` command once.                                        |
| Cursor           | Add the entry to `~/.cursor/mcp.json`.                                                   |
| Cline            | Paste the entry inside `mcpServers` of Cline's MCP settings (`cline_mcp_settings.json`). |
| Codex            | Add the table to `~/.codex/config.toml`.                                                 |
| Zed              | Add the entry under `context_servers` in the settings.                                   |
| Gemini CLI       | Add the entry to `~/.gemini/settings.json`.                                              |
| Any other client | Use the copied address and `Authorization` header (Streamable HTTP).                     |

MindStream never edits another tool's file, and never writes the token into a file of your project, because such a file can be committed.

> [!TIP]
> Run **`MindStream: Copy agent rules for MCP`** and paste the result into your agent's rules file (for example `AGENTS.md`), so it records findings and verification notes on its own.

### One endpoint for every project

The address is always `http://127.0.0.1:18741/mcp`. Every tool takes a required `workspace`: the absolute path of the project root the agent works in. One window holds the port and routes each call to the window that has that folder open, so one entry serves every project you have open. A folder that is not open in VS Code is refused with `WORKSPACE_NOT_OPEN`: open it, and MindStream serves it while its window is open. If another program uses port 18741, change the [MCP port](docs/settings.md#mcp-port) and copy the configuration again.

### What an agent can do

Read the project summary, list and read notes (with an excerpt of the linked code), read the types and categories, read the Work Pause note when you ask about it; add notes (linked to exact lines), edit them, change a status, tick a task, archive, and add a type or category. MindStream also offers three prompts your agent can show as commands: **Continue from the notes**, **Record a verification note**, and **Review notes whose code changed**.

- **There is no tool that deletes anything,** and none that pauses or resumes work, writes the Work Pause note, edits a code link, imports, exports, or changes settings.
- **The Work Pause note is yours.** It is the note you write for yourself before a long absence; an agent never writes it and reads it only when you ask.
- **Work Pause blocks every write,** including an agent's. Reads still work. Only you can resume, and the agent is told never to ask you to.
- **Statuses follow you.** The agent moves a note to in-progress when you ask it to carry out that note (not when you only ask it to read or evaluate it), never changes a done note unless you ask, and never marks a note done on its own: it asks you when the work seems finished.
- **Your own rules come first.** The agent is told that MindStream's instructions are defaults and that yours always take precedence.
- Every refusal comes with a stable code (`WORK_PAUSED`, `CONFLICT`, ...), a reason, and what to do. A refused write changes nothing.
- A note you edit while an agent changes it is never overwritten: the form tells you it changed elsewhere and refuses the Save until you reopen it.
- **Note text is data, not instructions.** The agent is told never to follow instructions written inside a note without asking you.

How the connection is protected is described in [Privacy & Security](#privacy--security).

### Remote development

MindStream runs on the machine of the window, so the agent and the project must be on the same machine: this is the normal case. It has been tried locally, in WSL, and over SSH. All windows share one token, but each machine has its own set of open folders and its own port, and the `workspace` path is that machine's own: for a WSL project the agent inside WSL sends a Linux path such as `/var/www/html/app`, while an agent on Windows would send `C:\...` for a Windows project. That is why the same kind of project can have two different `workspace` values on two machines.

- An agent on Windows cannot reach a project inside WSL while a Windows window holds port 18741.
- An agent on your computer reaching an SSH project may see a different forwarded port.
- With WSL mirrored networking, Windows and WSL share the port, so the side that does not hold it is not reachable.

### Troubleshooting

An agent that says "Not connected", a warning in the status bar, or a call that
answers `WORKSPACE_NOT_OPEN` or `WORKSPACE_NOT_RESPONDING`: each case and its
fix are in the [MCP troubleshooting FAQ](docs/faqs.md#mcp-troubleshooting).

## Keyboard and Mouse Shortcuts

On macOS, use `Cmd` wherever `Ctrl` is shown.

| Where                    | Shortcut                            | What it does                                  |
| ------------------------ | ----------------------------------- | --------------------------------------------- |
| Anywhere                 | `Ctrl+Alt+M`                        | New note (Quick Note)                         |
| Editor                   | Right-click → Add note to this line | New note linked to the line or selection      |
| Status badge             | Click                               | Next status: None → In Progress → Done → None |
| Status badge             | `Ctrl+Click`                        | None → Done, or In Progress → None            |
| Status badge             | `Ctrl+Shift+Click`                  | Canceled, or back to None                     |
| Card                     | Double-click                        | Open the note viewer                          |
| Title, description, task | `Ctrl+Shift+/`                      | Open the emoji picker                         |
| Title, description, task | `Ctrl+/`                            | Insert the emoji you used last                |
| Task                     | `Enter`                             | Add a task below                              |
| Empty task               | `Backspace`                         | Remove the task                               |
| Task                     | `Alt+↑` / `Alt+↓`                   | Move the task up or down                      |
| Task                     | `Ctrl+↑` / `Ctrl+↓`                 | Go to the previous or next task               |
| Note form                | `Esc`                               | Close the form (asks first if you changed it) |

## Commands

Run them from the Command Palette (`Ctrl+Shift+P`) or from the places listed.
**Add note to this line** is not in the Command Palette: it is in the editor's
context menu, because it needs the line under the cursor.

| Command                                 | Also in                           |
| --------------------------------------- | --------------------------------- |
| `MindStream: Quick Note`                | Panel title (**+**), `Ctrl+Alt+M` |
| Add note to this line                   | Editor context menu only          |
| `MindStream: Manage Categories`         | Panel title                       |
| `MindStream: Manage Types`              | Panel title                       |
| `MindStream: Restore Default Types`     | Manage Types window header        |
| `MindStream: Weekly Report`             | Panel title                       |
| `MindStream: Refresh`                   | Panel title                       |
| `MindStream: Open MindStream Panel`     |                                   |
| `MindStream: Export Markdown`           | **More** menu                     |
| `MindStream: Export JSON`               | **More** menu                     |
| `MindStream: Import JSON`               | **More** menu                     |
| `MindStream: Export Weekly Report`      | **More** menu                     |
| `MindStream: Pause work and show note`  | **More** menu                     |
| `MindStream: Connect an AI agent (MCP)` | **More** menu                     |
| `MindStream: Copy agent rules for MCP`  | **More** menu                     |
| `MindStream: Regenerate MCP token`      |                                   |

> [!NOTE]
> While work is paused, every command that changes notes is unavailable. Resume
> with **Resume work** on the note, or `✓ Work paused - click to resume` in the
> **More** menu.

## Settings

Open them with **File → Preferences → Settings** and search for `MindStream`.
Each setting is explained, with examples, in the
[Settings reference](docs/settings.md).

| Setting                                                                                | Default | In short                                                |
| -------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| [`mindstream.ui.direction`](docs/settings.md#text-direction)                           | `ltr`   | Read note titles and descriptions right-to-left         |
| [`mindstream.copy.includeNoteInfo`](docs/settings.md#copy-note-info)                   | `false` | Add category, type, status, and dates to copied notes   |
| [`mindstream.priority.style`](docs/settings.md#priority-style)                         | `chip`  | How priority is shown on cards, or `off` to turn it off |
| [`mindstream.descriptionTab.onClose`](docs/settings.md#description-tab-close-behavior) | `keep`  | What closing the description tab does with your edits   |
| [`mindstream.noteForm.onCloseWithChanges`](docs/settings.md#note-form-close-behavior)  | `ask`   | Ask, or discard, when closing a changed note form       |
| [`mindstream.mcp.port`](docs/settings.md#mcp-port)                                     | `18741` | The local port AI agents connect to (advanced)          |

## Data and Storage

Your notes, types, categories, and Work Pause note live in one file inside the
project: `.vscode/mindstream.data.json`.

- **Share it or keep it private.** It is a normal project file: commit it to
  share notes with your team and keep their history, or add it to
  `.gitignore` to keep them to yourself.
- **Always in sync.** A change to the file from outside (a `git pull`, a branch
  switch, another window) appears in the panel on its own; **Refresh** forces
  it.
- **Personal preferences are not in the file.** Your emoji list, recent emoji,
  the description field's height, and the **View** menu choices are kept by
  VS Code, so committing the file never shares them.

> [!TIP]
> Before a big change, such as an **Import JSON → Replace**, run **Export JSON**
> to keep a backup you can import again.

> [!NOTE]
> **Multi-root workspaces:** MindStream uses the first folder of the workspace.
> All notes are read from and written to `.vscode/mindstream.data.json` inside
> that folder.

## Privacy & Security

- **Nothing leaves your computer.** MindStream has no account, no cloud, and no
  telemetry, and it sends nothing to the internet. The only network it uses is
  the local MCP server on `127.0.0.1`.
- **Your data is a file you control.** Notes stay in
  `.vscode/mindstream.data.json` in your project. You decide whether it is
  committed, shared, or ignored.
- **The MCP server is local and locked.** It listens on `127.0.0.1` only,
  refuses any request that carries a browser `Origin` header (so a web page can
  never reach it), checks the `Host` header, and requires a secret token.
- **The token is kept in VS Code's encrypted secret storage**, never in a
  setting or a project file, so it cannot be committed by mistake. Every
  VS Code window, WSL and SSH windows included, reads the same token.
- **Agents are told that note text is data, not instructions.** An agent never
  follows instructions written inside a note without asking you.

> [!NOTE]
> **`MindStream: Regenerate MCP token`** replaces the token everywhere at once.
> Every configured agent, inside WSL or SSH too, stops working until you copy
> its entry again with **Connect an AI agent (MCP)**.

## Requirements

- **VS Code 1.101 or newer.** It is the first version with the API that lets
  MindStream register itself with GitHub Copilot.
- **An open folder.** Notes are stored per project, inside the folder.
- **For AI agents (optional):** an MCP client that supports Streamable HTTP,
  running on the same machine as the project (local, WSL, or SSH).

## Documentation

| Document                                   | What is in it                                            |
| ------------------------------------------ | -------------------------------------------------------- |
| [Settings reference](docs/settings.md)     | Every setting, its values, and examples                  |
| [Frequently asked questions](docs/faqs.md) | Answers to common questions and how to fix common issues |
| [Contributing guide](CONTRIBUTING.md)      | Building, testing, and submitting changes                |
| [Changelog](CHANGELOG.md)                  | What changed in each version                             |

## Contributing

Bug reports, ideas, and pull requests are welcome. Report a problem in
[GitHub Issues](https://github.com/Abdulla-Aldosari/MindStream/issues), and read
the [Contributing guide](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE) © 2026 Abdulla Aldosari
