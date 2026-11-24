# Contributing to MindStream

Thank you for helping improve MindStream. This guide explains how to build and
test the extension, the rules the code follows, and how to submit a change.
For what the extension does, see the [README](README.md).

## Contents

- [Reporting a problem or an idea](#reporting-a-problem-or-an-idea)
- [Prerequisites](#prerequisites)
- [Set up and run](#set-up-and-run)
- [Tests](#tests)
- [Quality checks](#quality-checks)
- [Project structure](#project-structure)
- [Code rules](#code-rules)
- [Pull requests](#pull-requests)
- [License](#license)

## Reporting a problem or an idea

Open an issue on [GitHub Issues](https://github.com/Abdulla-Aldosari/MindStream/issues).
For a bug, include:

- your VS Code version and operating system (and WSL or SSH if used),
- the steps to reproduce it, what you expected, and what happened,
- any MindStream message, word for word.

Check the [FAQ](docs/faqs.md) first: it may already answer the question.

> [!WARNING]
> Never attach your `.vscode/mindstream.data.json` to an issue.
> Reproduce the problem with a small sample project instead.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 (the version used by CI) and npm
- [VS Code](https://code.visualstudio.com/) 1.101 or newer
- Git

## Set up and run

```bash
git clone https://github.com/Abdulla-Aldosari/MindStream.git
cd MindStream
npm install
```

`npm install` also installs the Git hooks (see [Quality checks](#quality-checks)).

| Command           | What it does                                   |
| ----------------- | ---------------------------------------------- |
| `npm run compile` | Builds the extension into `dist/` with esbuild |
| `npm run watch`   | Rebuilds on every change                       |
| `npm run package` | Builds and packages a `.vsix` with vsce        |

Press `F5` in VS Code (**Run Extension (F5)**) to compile and open an
Extension Development Host window with your build. Open a folder in that window:
MindStream needs one.

## Tests

| Command            | What it runs                                                  |
| ------------------ | ------------------------------------------------------------- |
| `npm test`         | Builds, then runs the unit tests in `test/` (Mocha + ts-node) |
| `npm run test:e2e` | Builds, then runs the end-to-end tests in `e2e/` (Playwright) |

- **Unit tests** cover the logic without VS Code: fakes such as
  `InMemoryStorage` live in `test/helpers.ts`. Code that needs `vscode` gets it
  through dependency injection or a mock.
- **End-to-end tests** open a real VS Code window with a temporary workspace and
  drive the sidebar, the commands, and the editor. A window appears while they
  run. Shared helpers and selectors are in `e2e/helpers.ts`.
- **Optional window layout:** `npm run e2e:profile` opens a window, lets you
  place and size it and widen the sidebar, and saves that layout for later
  test runs once you close the window. Without it, windows use VS Code's
  defaults.

> [!IMPORTANT]
> Running the end-to-end tests from VS Code's integrated terminal fails with
> "Process failed to launch!", because the terminal inherits
> `ELECTRON_RUN_AS_NODE`. Unset it first, for example
> `env -u ELECTRON_RUN_AS_NODE npm run test:e2e` in Bash, or
> `Remove-Item Env:ELECTRON_RUN_AS_NODE; npm run test:e2e` in PowerShell.

## Quality checks

| Command                  | What it checks                           |
| ------------------------ | ---------------------------------------- |
| `npm run lint`           | ESLint                                   |
| `npm run typecheck`      | TypeScript, with no output               |
| `npm run prettier:check` | Formatting (`npm run prettier` fixes it) |

The Git hooks run them for you:

| Hook         | Runs                                       |
| ------------ | ------------------------------------------ |
| `pre-commit` | Prettier on the staged files, then ESLint  |
| `commit-msg` | commitlint                                 |
| `pre-push`   | ESLint, the type check, and the unit tests |

CI runs the type check, ESLint, the unit tests, and CodeQL on every push and
pull request to `main`, and `npm audit` on every push and once a week.

## Project structure

[docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md) describes every file, the data
flow, and the design rules in detail. In short:

| Folder   | What is in it                                                       |
| -------- | ------------------------------------------------------------------- |
| `src/`   | The extension host: storage, domain logic, commands, the MCP server |
| `media/` | The sidebar webview: scripts and styles                             |
| `test/`  | Unit tests                                                          |
| `e2e/`   | End-to-end tests                                                    |
| `docs/`  | Documentation                                                       |

## Code rules

### Data and writes

A write can come from the user (the sidebar, a command), from the extension
itself (code-link tracking), or from an AI agent through MCP. Every change to
notes, types, categories, or the Work Pause note therefore follows the same
rules:

- **One place for the rules.** The operation lives in a domain class that
  receives `IStorage` and has no `vscode` import (for example `NotesService`,
  `ItemsStore`, `WorkPauseStore`). The sidebar, the commands, and the MCP tools
  only call it.
- **A failed operation changes nothing:** no partial write, no file created, no
  change left in memory. Never catch and ignore a `StorageError` in a user
  action: its message already says why, that nothing was changed, and how to
  fix it.
- **No dialogs in the domain.** Confirmations belong to the caller
  (`SidebarUi`, `commands.ts`), which checks Work Pause and the storage state
  before asking anything.
- **Work Pause refuses every write**, from any caller. Only the user resumes.
- **Never lose what the user typed.** A webview form keeps its content until
  the host confirms the save.
- **Background writes stay silent.** Code that writes on its own (such as link
  tracking) drops a refused write without a message.

### Tests for every change

- Every change in `src/` comes with unit tests in `test/`.
- Test the refusal, not only the success: set `InMemoryStorage.problem` to
  `BLOCKED` and assert that the data and the file are unchanged.
- A change to what users see or do (the sidebar, a command, the editor, code
  links) also needs an end-to-end test in `e2e/`.
- When a change alters behavior described in
  [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md), the README, or the
  [docs](docs/), update them in the same pull request.

[CHANGELOG.md](CHANGELOG.md) is generated from the commit history with
git-cliff (`npm run changelog`); do not edit it by hand in a pull request.

## Pull requests

Before you open a pull request:

- [ ] `npm run lint`, `npm run typecheck`, and `npm test` pass.
- [ ] `npm run test:e2e` passes when the change is visible to users.
- [ ] New logic has unit tests, including the refusal cases.
- [ ] The documentation matches the new behavior.
- [ ] Commit messages follow the `commitlint.config.js`.

Keep a pull request to one topic, and describe what changed, why, and how you
tested it. For a visible change, a screenshot or a short GIF helps.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
