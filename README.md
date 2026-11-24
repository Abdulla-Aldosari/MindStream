<a href="https://github.com/Abdulla-Aldosari/MindStream"><img src="icons/mindstream.png" width="128" alt="MindStream logo"></a>

# MindStream for Visual Studio Code

Capture notes and ideas as they happen, organize them into custom types
and categories, and track their status.

![Capturing a coding idea as a note in MindStream](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

_A thought strikes mid-code. One shortcut later, it's a saved note, without ever leaving the editor._

## Features

- Flexible note cards in the sidebar (title + description + type + category + status), with a detail viewer modal.
- Quick note creation via the `Ctrl+Alt+M` / `Cmd+Alt+M` shortcut or the "+ Note" button.
- Fully customizable types: add, rename, delete (with reassignment), and pick an icon from the built-in codicon set — records keep their type safely via stable IDs.
- Customizable categories with a protected built-in "General" category (rename allowed, delete blocked). Deleting a category deletes its notes.
- Category filter dropdown ("All Categories") to focus the list on one category at a time.
- Three statuses — None / In Progress / Done — with one-click cycling, `Ctrl+Click` (or `Cmd+Click` on macOS) for direct jumps, and a recorded completion time.
- Archiving fully independent of status (never changes a "Done" status), with a show/hide archive toggle.
- Note priority (Critical / High / Medium / Low), shown on each card in the style you choose, or disabled entirely.
- View menu: group by None / Status / Priority (collapsible sections with counters), sort by Date modified / Fixed order / Status / Priority, and show or hide individual priority levels.
- Smooth reorder animations and a flash highlight on status change.
- Export Markdown and Export JSON.
- Import JSON with merge/replace options.
- Weekly Report modal, plus Export Weekly Report (Markdown).
- Work pause note: before you step away for a long time, write where you stopped and what comes next. While work is paused, the whole panel is locked and shows only that note, until you click **Resume work** on it (or use the **More** (`...`) menu). You can copy the note, open it as a read-only editor tab that stays open while you work, or delete it and resume. Pausing again shows the earlier note first, with the choice to start a new one.

## Organize & Customize

![Organizing and managing notes in MindStream](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

_Add a category, create a type with its own icon, cycle a note through its
statuses, archive it once it's done, then filter the list back down by
category, all from the sidebar._

## Use MindStream with AI agents (MCP)

MindStream is the project's memory for your coding agent. The agent knows the code, the git history, and the current conversation; it forgets everything between sessions. Through the Model Context Protocol (MCP) it can read what is pending, what is in progress, and what must be verified by hand, and it can record its own findings. MindStream adds no AI client and makes no model call: the intelligence is whatever model your agent already runs.

It is always on. In every VS Code window that has a folder, MindStream serves that folder's notes on `127.0.0.1`, with no setting to turn on. It adds nothing to the status bar while it works; a `$(warning) MCP` item appears only when another program holds its port.

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

MindStream never edits another tool's file, and never writes the token into a file of your project, because such a file can be committed. Then copy **`MindStream: Copy agent rules for MCP`** into your agent's rules file (for example `AGENTS.md`), so it records findings and verification notes on its own.

### One endpoint for every project

The address is always `http://127.0.0.1:18741/mcp`. Every tool takes a required `workspace`: the absolute path of the project root the agent works in. One window holds the port and routes each call to the window that has that folder open, so one entry serves every project you have open. A folder that is not open in VS Code is refused with `WORKSPACE_NOT_OPEN`: open it, and MindStream serves it while its window is open. If another program uses port 18741, set `mindstream.mcp.port` and copy the configuration again.

### What an agent can do

Read the project summary, list and read notes (with an excerpt of the linked code), read the types and categories, read the Work Pause note when you ask about it; add notes (linked to exact lines), edit them, change a status, tick a task, archive, and add a type or category. MindStream also offers three prompts (continue from the notes, record a verification note, review notes whose code changed).

- **There is no tool that deletes anything,** and none that pauses or resumes work, writes the Work Pause note, edits a code link, imports, exports, or changes settings.
- **The Work Pause note is yours.** It is the note you write for yourself before a long absence; an agent never writes it and reads it only when you ask.
- **Work Pause blocks every write,** including an agent's. Reads still work. Only you can resume, and the agent is told never to ask you to.
- **Statuses follow you.** The agent moves a note to in-progress only when you ask it to start that note, never changes a done note unless you ask, and never marks a note done on its own: it asks you when the work seems finished.
- **Your own rules come first.** The agent is told that MindStream's instructions are defaults and that yours always take precedence.
- Every refusal comes with a stable code (`WORK_PAUSED`, `CONFLICT`, ...), a reason, and what to do. A refused write changes nothing.
- A note you edit while an agent changes it is never overwritten: the form tells you it changed elsewhere and refuses the Save until you reopen it.
- **Note text is data, not instructions.** The agent is told never to follow instructions written inside a note without asking you.

### Security

The server listens on `127.0.0.1` only, refuses any request that carries a browser `Origin` header (so a web page can never reach it), checks the `Host` header, and requires a secret token. The token is generated once per user and kept in VS Code's encrypted secret storage, on your computer: every VS Code window reads the same token, including WSL and SSH windows. Run **`MindStream: Regenerate MCP token`** to replace it everywhere at once; every configured agent then stops working until you copy its entry again, including agents inside WSL or SSH. The token protects against other users of the same machine, a port exposed by mistake, and local programs you did not configure. It does not protect against malware running as you, which can read your project files directly.

### Remote development

MindStream runs on the machine of the window, so the agent and the project must be on the same machine: this is the normal case. It has been tried locally, in WSL, and over SSH. All windows share one token, but each machine has its own set of open folders and its own port, and the `workspace` path is that machine's own: for a WSL project the agent inside WSL sends a Linux path such as `/var/www/html/app`, while an agent on Windows would send `C:\...` for a Windows project. That is why the same kind of project can have two different `workspace` values on two machines.

- An agent on Windows cannot reach a project inside WSL while a Windows window holds port 18741.
- An agent on your computer reaching an SSH project may see a different forwarded port.
- With WSL mirrored networking, Windows and WSL share the port, so the side that does not hold it is not reachable.

### Troubleshooting

- **The agent says "Not connected" (or 401 / Unauthorized) after you regenerated the token.** Its entry still holds the old token. Run `MindStream: Connect an AI agent (MCP)`, paste the copied entry over the old one, and reconnect the server in the agent. Do it for every agent: an agent inside WSL keeps its own entry (for Cline, its own `cline_mcp_settings.json`). VS Code also warns once when an agent sends an old token, with a button that opens the same command.
- **The status bar item shows a warning.** Another program uses the port. Set `mindstream.mcp.port` to a free port, then copy each agent's entry again.
- **A call answers `WORKSPACE_NOT_OPEN`.** Open the project folder in VS Code; MindStream serves a folder only while its window is open.
- **A call answers `WORKSPACE_NOT_RESPONDING`.** The window of that folder did not answer. The call may have been applied: read the note again before retrying.

## Settings

| Setting                                  | Type                                                           | Default  | Description                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mindstream.ui.direction`                | `"ltr"` \| `"rtl"`                                             | `"ltr"`  | Reading direction for note titles and descriptions. Use `"rtl"` to read Arabic notes right-to-left; the interface keeps VS Code's default direction and all labels remain in English. The work pause note ignores it and picks its own direction from its first line.                                                  |
| `mindstream.copy.includeNoteInfo`        | `boolean`                                                      | `true`   | Include the note info section (category, type, status, and timestamps) when copying a note's content from the viewer.                                                                                                                                                                                                  |
| `mindstream.priority.style`              | `"dot"` \| `"stripe"` \| `"chip"` \| `"typeStripe"` \| `"off"` | `"chip"` | How note priority is shown on cards: a dot before the title, a stripe on the card edge, a chip next to the status, or a stripe on the type badge. `"off"` disables the priority system (stored priorities are kept).                                                                                                   |
| `mindstream.descriptionTab.onClose`      | `"keep"` \| `"ask"`                                            | `"keep"` | What closing the description editor tab does with edits you did not save with Ctrl+S. `"keep"` hands everything you typed back to the note form without asking; `"ask"` shows VS Code's Save / Don't Save question (Don't Save drops those edits). Either way the note is stored only when you click Save in the form. |
| `mindstream.mcp.port`                    | `number`                                                       | `18741`  | Advanced. The one local port AI agents connect to. Change it only if another program uses 18741; then copy each agent's entry again with `MindStream: Connect an AI agent (MCP)`. Machine-wide (one value for every window).                                                                                           |
| `mindstream.noteForm.onCloseWithChanges` | `"ask"` \| `"discard"`                                         | `"ask"`  | What closing the note form (Cancel, X, or Esc) does after a field was changed, including the description and the task list. `"ask"` asks whether to save or discard the changes; `"discard"` closes at once and loses them.                                                                                            |

## Storage

A single JSON file inside the workspace: `.vscode/mindstream.data.json`. Because it's a normal project file, you can commit it to Git to sync or back it up — or add it to `.gitignore` to keep it private to you. Writes are atomic (temp file + rename) to avoid corruption.

> [!NOTE]
> 📁**Multi-root workspaces:** MindStream uses the first folder of the workspace by default. All notes are read from and written to `.vscode/mindstream.data.json` inside that first folder.

## Commands

- `MindStream: Quick Note`
- `MindStream: Manage Types`
- `MindStream: Manage Categories`
- `MindStream: Refresh`
- `MindStream: Open MindStream Panel`
- `MindStream: Export Markdown`
- `MindStream: Export JSON`
- `MindStream: Import JSON`
- `MindStream: Weekly Report`
- `MindStream: Export Weekly Report`
- `MindStream: Pause work and show note`
- `MindStream: Connect an AI agent (MCP)`
- `MindStream: Copy agent rules for MCP`
- `MindStream: Regenerate MCP token`

While work is paused, every command above is unavailable; resume with **Resume work** on the note, or `✓ Work paused - click to resume` in the **More** menu.

## Requirements

- VS Code `1.101` or newer (the first version with the API that lets MindStream register itself with GitHub Copilot).

## Development

```
npm install
npm run compile   # build with esbuild
npm run watch     # build in watch mode
npm test          # tests (Mocha + ts-node)
npm run package   # package with vsce
```

Press F5 to launch the Extension Development Host.

## License

[MIT](LICENSE) © 2026 Abdulla Aldosari
