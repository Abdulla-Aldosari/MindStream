# MindStream Settings Reference

Every MindStream setting, what each value does, and an example.
[Back to README](../README.md)

## How to change a setting

- **Settings editor:** open **File → Preferences → Settings** (`Ctrl+,`, or
  `Cmd+,` on macOS) and search for `MindStream`.
- **settings.json:** run **Preferences: Open User Settings (JSON)** from the
  Command Palette and add the keys shown in the examples below.

Most settings can be set for you (**User**) or for one project
(**Workspace**); a Workspace value wins in that project. The
[MCP port](#mcp-port) is the exception: it applies to the whole machine.

Changes take effect at once; the panel does not need to be reopened.

## Contents

| Setting                                                                | Default | Scope              |
| ---------------------------------------------------------------------- | ------- | ------------------ |
| [`mindstream.ui.direction`](#text-direction)                           | `ltr`   | User and Workspace |
| [`mindstream.copy.includeNoteInfo`](#copy-note-info)                   | `false` | User and Workspace |
| [`mindstream.priority.style`](#priority-style)                         | `chip`  | User and Workspace |
| [`mindstream.descriptionTab.onClose`](#description-tab-close-behavior) | `keep`  | User and Workspace |
| [`mindstream.noteForm.onCloseWithChanges`](#note-form-close-behavior)  | `ask`   | User and Workspace |
| [`mindstream.mcp.port`](#mcp-port)                                     | `18741` | Machine            |

Also see [Preferences that are not settings](#preferences-that-are-not-settings).

## Text direction

`mindstream.ui.direction` · `"ltr"` | `"rtl"` · default `"ltr"`

The reading direction of note titles and descriptions.

| Value | Effect                                                               |
| ----- | -------------------------------------------------------------------- |
| `ltr` | Left-to-right, for English and most languages.                       |
| `rtl` | Right-to-left, for Arabic, Hebrew, Persian, and other RTL languages. |

- Only the note text changes direction. The interface keeps VS Code's layout,
  and its labels stay in English.
- The [Work Pause note](../README.md#work-pause-note) ignores this setting: it
  picks its own direction from its first line.

```json
{
  "mindstream.ui.direction": "rtl"
}
```

## Copy note info

`mindstream.copy.includeNoteInfo` · `boolean` · default `false`

What **Copy content**, in the note viewer's options menu, puts on the
clipboard.

| Value   | The copy contains                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------- |
| `false` | The title, the description, and the task list, as Markdown.                                               |
| `true`  | The same, followed by a **Note info** section: category, type, status, and the created and updated dates. |

```json
{
  "mindstream.copy.includeNoteInfo": true
}
```

## Priority style

`mindstream.priority.style` · `"dot"` | `"stripe"` | `"chip"` | `"typeStripe"` | `"off"` · default `"chip"`

How a note's priority is shown on its card, or `off` to turn priorities off.

<!-- asset: priority-styles.png -->

![The four priority display styles side by side](https://raw.githubusercontent.com/Abdulla-Aldosari/repo-assets/refs/heads/main/MindStream/coming-soon-image-pending.png)

| Value        | Effect                                              |
| ------------ | --------------------------------------------------- |
| `dot`        | A small colored dot before the title.               |
| `stripe`     | A colored stripe on the start edge of the card.     |
| `chip`       | A dot and the priority name next to the status.     |
| `typeStripe` | A colored stripe on the end edge of the type badge. |
| `off`        | Turns the priority system off (see below).          |

With `off`, priority disappears from the cards, from the note form, and from
the **View** menu (grouping, sorting, and hiding by priority), and new notes
get no priority.

> [!NOTE]
> `off` deletes nothing. Priorities already saved stay in the data file and
> come back when you choose a style again.

```json
{
  "mindstream.priority.style": "stripe"
}
```

## Description tab close behavior

`mindstream.descriptionTab.onClose` · `"keep"` | `"ask"` · default `"keep"`

What closing the
[description editor tab](../README.md#description-in-an-editor-tab) does with
edits you did not save there with `Ctrl+S`.

| Value  | Effect                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------- |
| `keep` | Everything you typed goes back to the note form, with no question. The tab is never marked as modified. |
| `ask`  | VS Code asks **Save** or **Don't Save**. **Don't Save** returns only the text last saved in the tab.    |

> [!IMPORTANT]
> Either way, the tab only updates the open note form. The note is stored when
> you click **Save** in the form.

```json
{
  "mindstream.descriptionTab.onClose": "ask"
}
```

## Note form close behavior

`mindstream.noteForm.onCloseWithChanges` · `"ask"` | `"discard"` · default `"ask"`

What closing the note form (**Cancel**, **X**, or `Esc`) does after you changed
a field, the description and the task list included.

| Value     | Effect                                                                     |
| --------- | -------------------------------------------------------------------------- |
| `ask`     | Asks **Save** or **Discard**. Dismissing the question keeps the form open. |
| `discard` | Closes at once and loses the changes.                                      |

The same question appears when you start a new note while a changed form is
open. A form you did not change always closes at once.

> [!WARNING]
> With `discard`, an accidental `Esc` loses what you typed. Keep `ask` unless
> you are sure.

```json
{
  "mindstream.noteForm.onCloseWithChanges": "discard"
}
```

## MCP port

`mindstream.mcp.port` · `integer` from 1024 to 65535 · default `18741` · Machine

Advanced. The one local port that AI agents connect to,
`http://127.0.0.1:<port>/mcp`. See
[Use MindStream with AI Agents (MCP)](../README.md#use-mindstream-with-ai-agents-mcp).

- Change it only when another program already uses port 18741; MindStream then
  shows `$(warning) MCP` in the status bar.
- It is a machine setting: one value for every VS Code window on the computer,
  so all windows agree on the same port. A remote machine (WSL, SSH) has its
  own value.

> [!IMPORTANT]
> After changing the port, run **MindStream: Connect an AI agent (MCP)** and
> paste the new entry into every agent: their entries still hold the old port.

```json
{
  "mindstream.mcp.port": 18800
}
```

## Preferences that are not settings

Some choices are remembered by VS Code instead of being settings. They are
never written to the project's data file, so committing it never shares them.

| Preference                                    | How you change it                                                       | Applies to    |
| --------------------------------------------- | ----------------------------------------------------------------------- | ------------- |
| Emoji list and recent emoji                   | Emoji picker → **Edit list**; **Restore original emoji list** resets it | Every project |
| Description field height                      | Drag the resize handle of the description field in the note form        | Every project |
| Grouping, sorting, and hidden priority levels | The **View** menu in the panel toolbar                                  | This project  |

---

More questions? See the [FAQ](faqs.md).
