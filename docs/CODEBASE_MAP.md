# MindStream — Codebase Map

A general guide to the project's source code: where things live, how the
pieces fit together, and the conventions to follow when adding new code. Keep
this file updated whenever a new pattern/convention is introduced.

---

## 1. OutputChannel usage (logging)

### Where it is created

The extension's single `vscode.OutputChannel` is created **once**, inside
`activate()` in `src/extension.ts`:

```ts
export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("MindStream");
  context.subscriptions.push(outputChannel); // auto-disposed on deactivate

  // ...
}
```

- `'MindStream'` is the name shown to the user in the **Output** panel's
  channel dropdown.
- Registering it in `context.subscriptions` means VS Code disposes it
  automatically when the extension deactivates — no manual cleanup needed in
  `deactivate()`.

### How to use it (dependency injection — no global variable)

We deliberately **do not** export the channel as a module-level global
(`export let outputChannel`). Instead, any class that needs to log receives
the channel through its constructor, exactly like the existing pattern used
for `IStorage` in `ItemsStore`, `TypesRegistry`, and `CategoriesRegistry`.

**Why not a global variable?** See the reasoning below (§1.1) — in short:
testability, explicit dependencies, and avoiding circular imports/undefined
values at module-load time.

#### Step 1 — accept it in the constructor

```ts
// src/sidebarProvider.ts
export class SidebarProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly items: ItemsStore,
    private readonly types: TypesRegistry,
    private readonly categories: CategoriesRegistry,
    private readonly output: vscode.OutputChannel // <-- new dependency
  ) {}

  private someMethod(): void {
    this.output.appendLine("MindStream: something happened");
  }
}
```

#### Step 2 — pass it in when constructing the instance

```ts
// src/extension.ts
const outputChannel = vscode.window.createOutputChannel("MindStream");
context.subscriptions.push(outputChannel);

// ...

sidebar = new SidebarProvider(context.extensionUri, items, types, categories, outputChannel);
```

#### Common API

```ts
output.appendLine("text"); // adds a line + newline
output.append("text"); // adds text without a newline
output.clear(); // clears all content
output.show(true); // opens/focuses the Output panel on this channel
// (true = do not steal editor focus)
output.hide(); // hides the panel
```

#### Suggested usage points

- Inside `catch` blocks, alongside the existing
  `vscode.window.showErrorMessage(...)` calls (e.g. in
  `sidebarProvider.ts#handleMessage`, `extension.ts#importJson`), to log the
  full error detail without cluttering the user-facing notification.
- Around storage read/write (`storage.ts`, `workspaceStorage.ts`) to trace
  when data is loaded/saved, useful when debugging a corrupted
  `.vscode/mindstream.data.json`.
- Import/export operations (`export.ts`, `extension.ts`) to record how many
  records were merged/replaced.

#### Testing

When a class takes an `OutputChannel` dependency, unit tests pass a fake
object instead of the real VS Code API (same spirit as `InMemoryStorage` in
`test/helpers.ts`):

```ts
const fakeOutput = {
  appendLine: () => {},
  append: () => {},
  clear: () => {},
  show: () => {},
  hide: () => {},
  dispose: () => {},
} as unknown as vscode.OutputChannel;

const provider = new SidebarProvider(uri, items, types, categories, fakeOutput);
```

### 1.1 Why dependency injection instead of a global export

| Concern               | Global (`export let outputChannel`)                                                                     | DI (constructor parameter)                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Init order            | Can be `undefined` if read before `activate()` runs                                                     | Guaranteed to exist (TypeScript enforces it via the type)             |
| Testability           | Requires mocking the whole module                                                                       | Just pass a fake object                                               |
| Circular imports      | Risk if other files import from `extension.ts` (the current "root" module that imports everything else) | No import needed at all                                               |
| Explicit dependencies | Hidden — must read the method body to know it's used                                                    | Visible in the constructor signature                                  |
| Flexibility           | One hardcoded instance everywhere                                                                       | Easy to swap implementation (e.g. a second channel, or a test double) |

For a project this size a global would still "work", but since
`itemsStore.ts`, `typesRegistry.ts`, and `categoriesRegistry.ts` already
follow the constructor-injection pattern for `IStorage`, staying consistent
with DI keeps the codebase uniform.

---

## 2. Project layout overview

```
src/
  extension.ts          Entry point: activate()/deactivate(), command registration,
                         wiring of all services, builds the injected CommandsDeps.
  models.ts              Core data types: MindStreamItem, MindStreamLink, MindStreamTypeDef,
                         MindStreamCategoryDef, MindStreamWorkPauseNote, MindStreamData,
                         statuses (MINDSTREAM_STATUSES, isStatus), constants.
  storage.ts              StorageService (IStorage impl): loads/saves the JSON file
                         safely (write to .tmp then rename), default data creation,
                         normalizeData() for incomplete or hand-edited data (a file
                         with no types gets the default types back),
                         reloadIfExternal() to pick up out-of-process changes, and
                         the save guard (StorageProblem, StorageError, getProblem()).
  workspaceStorage.ts     Thin helper: binds a StorageService to the open workspace
                         folder (.vscode/mindstream.data.json at the project root).
  workspaceFolder.ts      resolveWorkspaceFolder(): the one place that picks the workspace
                         folder (the first one). Used by activate(), the commands deps, and
                         the sidebar's linked-location opener; multi-root support changes
                         only this function. No vscode import.
  itemsStore.ts           ItemsStore: CRUD for notes, status changes (unknown statuses refused;
                         completedAt exists only while done, canceledAt only while canceled),
                         archiving independent of status, permanent deletion, and host-side code link
                         tracking (setLink, mapLinks with persist false, save). Archived notes are
                         read-only (ArchivedNoteError); see "Archived notes are read-only".
  typesRegistry.ts        TypesRegistry: manage user-defined note types (add/rename/
                         setIcon/remove/reassign/restoreDefaults), items reference typeId not label.
  categoriesRegistry.ts   CategoriesRegistry: manage categories, built-in "General"
                         category can be renamed but never deleted; each category
                         can carry an optional defaultTypeId (setDefaultType).
  emojiRegistry.ts       EmojiRegistry: global (per-user, all workspaces) emoji
                         palette + recent-usage tracking behind an EmojiMemento
                         adapter over context.globalState (testable without vscode).
  priority.ts             Note priority: PRIORITIES, DEFAULT_PRIORITY, labels, the
                         mindstream.priority.style setting values, and
                         priorityFeatures() (feature switches). See §7.
  linkResolver.ts         Pure rules for note code links: buildLink(), resolveLink()
                         (re-find code from its anchor), shiftLinkForEdits(),
                         renameLinkPath(), markLinkMissingForPath(), sanitizeLink().
                         See section 9.
  linkTracker.ts          LinkTracker: keeps links correct on edits, renames, deletes
                         and re-checks them against file contents (injected LinkFiles);
                         refreshAll skips archived notes.
  saveScheduler.ts        SaveScheduler: coalesces bursts into one delayed write (trailing delay
                         plus a maximum wait, flush/cancel, injectable clock).
  linkIntegration.ts      vscode wiring for links: the link of the cursor line/selection,
                         and the document/rename/delete/window-focus listeners.
  uiPrefs.ts              UiPrefsRegistry: global (per-user, all workspaces) UI
                         preferences (the note-editor description height) behind
                         a UiPrefsMemento adapter over context.globalState.
  workPause.ts             Pure Work Pause rules: normalizeWorkPauseNote(), the
                         context key name, the messages allowed while locked,
                         guardWhenWorkPaused(), and WorkPauseCopy (the snapshot
                         shown by the read-only editor tab). See §10.
  workPauseStore.ts        WorkPauseStore: reads/writes/clears the single Work Pause
                         note (data key workPauseNote) through IStorage. See §10.
  workPauseDocument.ts     WorkPauseDocument: the `vscode` layer of the note's
                         read-only editor tab (scheme `mindstream-pause`). See §10.
  notesService.ts          NotesService: the single entry point for every change to notes,
                         types, categories, and the Work Pause note, from any caller
                         (sidebar, command, automated caller). Work Pause lock, save guard,
                         input checks, NOT_FOUND, CONFLICT, onDidChange. See "NotesService".
  noteInput.ts             Pure input checks and limits for NotesService (cleanTitle,
                         cleanTasks, cleanLabel, cleanIcon, MAX_*), and the field comparison
                         used by conflict checks (sameFieldValue, changedSince).
  domainError.ts           DomainError and the stable refusal codes (ERROR_CODES,
                         errorCodeOf(), refusal(), noteNotFound(), WORK_PAUSED_MESSAGE).
  mcp/noteView.ts          Pure shaping of notes for an agent: toNoteSummary(), toNoteDetail()
                         (ids and labels side by side, task indexes, the link's location
                         and state, never its anchor text), toCodeExcerpt() (linked lines
                         plus context, capped). No vscode, no MCP SDK.
  mcp/notesQuery.ts        NotesQuery: everything an agent reads. listNotes(filter) (validated,
                         INVALID_INPUT on any bad field, ordered by priority then latest
                         change, paged), getNote() (re-finds the code link, then excerpts
                         it), listTypesAndCategories(), getWorkPauseNote(), projectSummary().
                         Reads never refuse while work is paused or saving is off.
  mcp/mcpTypes.ts         Shared types of the tool layer: ToolContext, ToolDefinition,
                         ToolResult (ok with a summary and data, or a refusal with a
                         code, a message, and the current value). No SDK, no vscode.
  mcp/toolKit.ts          defineTool(): builds a tool from a spec (plain JSON Schema that
                         always requires `workspace`, annotations, a handler that returns
                         a refusal as a result and refuses unknown arguments) and the
                         sentences every description carries (workspace, paused, data).
  mcp/toolErrors.ts       toToolError(): a refusal becomes { code, message, current };
                         `current` is shaped as a note, the Work Pause note, or an
                         existing entry. Any other error is rethrown (a bug).
  mcp/readTools.ts,       The 12 tools, each one call to NotesQuery (reads) or
  mcp/writeTools.ts,     NotesService (writes); they add no rule of their own.
  mcp/noteStateTools.ts,
  mcp/catalogTools.ts     No tool deletes, pauses or resumes work, writes the Work Pause
                         note, or edits a link. toolKit.ts holds the rule sentences the
                         tools, prompts, and rules share (WRITE_RULE, STATUS_RULE,
                         USER_FIRST_RULE, WORK_PAUSE_NOTE_RULE, TASKS_RULE, DATA_RULE).
  mcp/tools.ts            MCP_TOOLS (the one list a server registers) and findTool().
  mcp/httpGuard.ts        checkRequest(): loopback peer, no Origin header, Host naming this
                         server, then the bearer token in constant time. Pure.
  mcp/workspaceMatch.ts   Pure path matching for the `workspace` argument: normalizeFolder(),
                         isInside() (separator boundary only), matchWorkspace() (longest
                         folder wins), requireWorkspace(). The platform is passed in.
  mcp/routerRegistry.ts   RouterRegistry: one JSON file per window in a directory shared by
                         the windows of this machine, written atomically, never holding the
                         token. Dead, corrupt, and duplicate entries are ignored.
  mcp/innerCall.ts        The `POST /call` contract: parseCall(), sendJson(), readBody() with
                         a 1 MB limit, versionMismatch().
  mcp/innerServer.ts      InnerServer: a window's own server on 127.0.0.1 (port picked by the
                         system) that runs this window's tools; same guard and token.
  mcp/mcpRouter.ts        createDispatcher(): a call for this window's folder runs here, a
                         call for another open folder is forwarded (new connection, 10 s limit),
                         any other folder is WORKSPACE_NOT_OPEN. It never touches another
                         workspace's data file.
  mcp/mcpServerCore.ts    The only file that imports the MCP SDK: builds the server from
                         MCP_TOOLS (each handler calls the dispatcher) and the Node handler.
  mcp/mcpHttpServer.ts    McpHttpServer: the public endpoint on 127.0.0.1:<port>/mcp behind
                         the guard, plus the holder check (answers a nonce with a token proof).
  mcp/portHolder.ts       holdFixedPort(): takes the fixed port, retries while another window
                         holds it (router / follower / blocked), probePortHolder().
  mcp/clientList.ts       The AI clients the setup knows (Copilot first, "Automatic in VS Code").
  mcp/clientConfigs.ts    buildClientConfig(): the paste-ready text of each client (Copilot
                         CLI, Claude Code, Cursor, Cline, Codex, Zed, Gemini CLI, generic).
                         One global entry, the same for every project; refuses a token,
                         address, or name that could break out of a quoted value.
  mcp/mcpConnectFlow.ts   runConnect(): the "Connect an AI agent (MCP)" flow over small
                         interfaces: waits briefly for the token, picks a client, copies
                         its text, says where to paste it. Never writes a file; the token
                         is never in a message. The message after the copy has no button,
                         so nothing replaces the configuration on the clipboard.
  mcp/prompts.ts          The MCP prompts (continue_work, record_verification with a `topic`,
                         review_stale_links): instruction text that names only
                         existing tools and codes, asks for `workspace`, and says note text
                         is data, not instructions. Registered in mcpServerCore.ts.
  mcp/agentRules.ts       AGENT_RULES: the English Markdown snippet a user copies into the
                         agent's rules file, with an "If MindStream is not connected"
                         section. No token and no address. The command "Copy agent rules
                         for MCP" (More menu) copies it.
                         SERVER_INSTRUCTIONS: the MCP instructions sent on connect.
  mcp/mcpControllerLogic.ts  The controller's decisions as pure functions: port setting
                         validation (default 18741), token generation and who may create
                         it (only the router window, only while empty), the status bar
                         item (only while the port is blocked), the blocked and old-token
                         warnings, the regenerate texts, and what the Copilot
                         registration offers.
  mcp/mcpController.ts    The only file of src/mcp/ that imports vscode. Created in activate()
                         after NotesService, in every window with a folder (activation is
                         onStartupFinished): starts the inner server and the registry
                         entry, holds the fixed port, keeps the one token in SecretStorage
                         (key mindstream.mcp.token, re-read on secrets.onDidChange), shows
                         a status bar warning while the port is blocked, registers the server with Copilot
                         (mcpServerDefinitionProviders), and stops everything in deactivate().
  sidebarController.ts    SidebarController: sidebar message-handling logic, extracted
                         from the provider so it is unit-testable without vscode.
                         Writes only through NotesService and asks for confirmations via SidebarUi
                         (confirm dialogs and a type QuickPick via pickType). Holds the pending code
                         link set by the host (setPendingLink); addItem attaches it only when the
                         webview sends linked true, and updateItem never touches a link.
                         Answers every note editor Save through SidebarUi.answerNoteSave and
                         every Work Pause Save through SidebarUi.answerWorkPauseSave.
  descriptionDraft.ts     Pure rules of the description editor tab (§12): the one active
                          draft with its saved and live texts, draftFileName(), normalizeEol().
  descriptionEditor.ts    DescriptionEditor: the `vscode` layer of §12 (a FileSystemProvider
                          for the `mindstream-desc` scheme, tab opening/closing, change events).
  noteFormSettings.ts     Pure values and normalizers of the two close-with-changes settings
                          (`descriptionTab.onClose`, `noteForm.onCloseWithChanges`). See §12.
  sidebarProvider.ts      SidebarProvider (WebviewViewProvider): renders the sidebar
                         webview, posts state to the UI, updates the activity-bar
                         badge, implements SidebarUi for confirm dialogs and the
                         default-type QuickPick, and writes clipboard text for
                         copyToClipboard messages. Also opens the note form for a code link
                         (openAddNoteForLink), opens a linked file at its line (openLink),
                         skips posting while hidden, and waits for the view when first used.
  commands.ts             Command handlers (export/import Markdown/JSON, weekly report,
                         requireWorkspace) with an injected CommandsDeps I/O surface.
                         importJson does nothing while the Work Pause lock is on, and
                         rejects a file that is not a MindStream data file (error, no
                         Merge/Replace dialog, nothing changed).
  export.ts               Pure functions: buildMarkdownExport(), buildWeeklyReportText(),
                         validateImportData() (checks a parsed file has types, categories
                         and items lists with well-formed entries; one bad entry rejects
                         the whole file), mergeData() (merge imported JSON into current
                         data by id).
  report.ts                buildWeeklyReport(): computes weekly created/completed/
                         in-progress/archived counts and lists.
  util.ts                  newId() (crypto.randomUUID), nowIso(), debounce().
  tasks.ts                 sanitizeTasks(): cleans a note's task list (from the
                         webview or a hand-edited file). See §11.

media/
  sidebar/                The webview app: ES modules bundled by esbuild into
                          dist/media/sidebar.js (see "Webview app" below).
    main.js               Entry point: calls each module's init*() in a fixed
                          order, the Esc router, first render, "refresh".
    core.js               vscode API handle, `state`, persisted view choices,
                          `$`, main elements, persist(), typeOf(), esc().
    customSelect.js       renderCustomSelect/bindCustomSelect (see rule: no
                          native <select>), renderActionMenu/bindActionMenu,
                          menuCloseHandlers, closeAllDropdowns().
    overlays.js           closeAllModals(): one overlay open at a time.
    toolbar.js            Category/type filters, the View menu (DropdownMenu),
                          the archive toggle.
    list.js               Filtering, empty state, groups, FLIP animation.
    card.js               Note cards and their footer actions (archived cards:
                          no status cycle, no Edit). Status click: None → In
                          Progress → Done; Ctrl+Click skips; Ctrl+Shift+Click is
                          the only way into and out of Canceled (back to None).
    linkBadge.js          Code-link badge and its fit-to-width observer (§9).
    noteEditor.js         New/edit note modal, the Save round trip, and the
                          description editor tab link (§12).
    priorityControl.js    The editor's priority radiogroup (§7).
    noteViewer.js         Read-only viewer and its options menu (Copy ID /
                          Copy content, sent to the host as copyToClipboard).
                          Checks tasks of a task group; refreshView() keeps the
                          open viewer in line with each state (§11). Archived
                          notes: no Edit, read-only checklist.
    taskEditor.js         The note editor's task rows: add, remove, check,
                          drag and Alt+Up/Down reordering, Focus mode (§11).
    taskProgress.js       buildProgressBar() and the task checkbox, shared by
                          cards, the viewer, and the editor (§11).
    categoriesModal.js    "Manage Categories" modal.
    typesModal.js         "Manage Types" modal and the icons picker.
    weeklyReport.js       Weekly report modal.
    emojiPicker.js        Emoji picker, shortcuts, palette editor (§5).
    workPausePanel.js     Work Pause note panel (§10).
    messages.js           Host messages: state updates and open requests.
  sidebar.css             Webview styles (§4).
  tooltip.js              Reusable data-tooltip system (see §3 below),
                          loaded as a global before sidebar.js.
  iconClass.js            iconClass(): builds a safe codicon CSS class from
                          an icon name, loaded as a global before sidebar.js.
  defaultType.js          resolveCategoryDefaultTypeId(): resolves the type id to
                          pre-select for a category when adding a note, loaded as
                          a global before sidebar.js.
  emoji.js                splitEmojis(): splits a plain text sequence into
                          individual emoji (Intl.Segmenter grapheme clusters),
                          loaded as a global before sidebar.js.
  dropdown-menu.js/.css   DropdownMenu: standalone, dependency-free menu
                          component (radio groups, checkboxes, items, labels,
                          separators, disabled items, WAI-ARIA keyboard).
                          Reads no project globals, so it can move to a shared
                          library unchanged. See §8.
  linkPath.js             fitPath()/pathCandidates(): picks the longest form of a file path
                          that fits a width (pure, loaded as a global before sidebar.js).
                          See section 9.
  viewOptions.js          ViewOptions: group/sort/priority-filter rules and the
                          View menu entries (pure, no DOM). See §7.
  workPause.js             WorkPause: view/edit/cancel rules of the Work Pause note,
                          its age, the earlier-break choice, the editor hint, the
                          draft preview, and the formatting example note
                          (pure, no DOM, loaded as a global before sidebar.js).
                          See §10.
  noteForm.js              NoteForm: snapshot(), hasChanges(), closeAction(): whether closing the
                          note form would lose changes (pure, loaded as a global before
                          sidebar.js). See §12.
  taskList.js              TaskList: isTaskGroup(), progress(), move(),
                          focusAvailable() for task group notes (pure, loaded as
                          a global before sidebar.js).
                          See §11.
  dateFormat.js            DateFormat: formatDate() (dd/MM/yyyy) and formatDateTime()
                          (dd/MM/yyyy hh:mm:ss AM|PM, 12-hour; used for the Created /
                          Updated line of the note viewer and the Work Pause dates),
                          both in local time, "" for a missing or invalid value
                          (pure, loaded as a global before sidebar.js).



test/
  helpers.ts              InMemoryStorage: IStorage fake used across unit tests.
  *.test.ts                Mocha + ts-node unit tests per module (no vscode
                         dependency in the tested modules themselves).

e2e/
  helpers.ts              launchVscode(), the `launch` test fixture, and the sidebar
                         helpers. See "End-to-end tests" below.
  *.spec.ts                Playwright specs that drive a real VS Code window.

playwright.config.ts      Playwright config: testDir e2e, one worker, HTML report.
```

### Webview app (`media/sidebar/`)

- `esbuild.js` bundles `media/sidebar/main.js` into `dist/media/sidebar.js`
  (`format: "iife"`, `platform: "browser"`, a sourcemap outside
  `--production`); `--watch` rebuilds it too. `getHtml()` loads that one file
  after the global helper scripts. `copyMedia()` copies only top-level `media/`
  files, so the module sources never reach `dist/` or the VSIX.
- The modules use `import`/`export` (eslint `sourceType: "module"`, strict
  mode). They also read the globals of the classic `media/*.js` helpers
  (`iconClass`, `ViewOptions`, `WorkPause`, `DropdownMenu`, ...), listed in
  `eslint.config.js`.
- **A module only declares things at load.** Listeners, `DropdownMenu.create()`
  and other startup work go in the module's `init*()` function, and only
  `main.js` calls those, in a fixed order: the emoji picker's document
  listeners before the icons picker's, the View menu's close handler before
  the viewer menu's, and the Esc router last. Allowed at load: the `vscode`
  handle and saved state in `core.js`, element lookups, and the link-row
  `ResizeObserver` in `linkBadge.js`.
- **Mutable state stays in its module.** A `let` that another module needs is
  read or changed through a function (`takePendingFlashId()`,
  `isWorkPaused()`, `handleWorkPauseDiscardAnswer()`), never imported. Shared
  UI state lives in `state` (`core.js`).
- **Logic that needs unit tests goes in a classic `media/*.js` file** (one
  global plus a guarded `module.exports`, like `viewOptions.js`): Mocha runs
  the tests as CommonJS and cannot load the ES modules.
- Import paths are lowercase and relative (`./core.js`): two spellings of one
  path create two module instances, and `acquireVsCodeApi()` throws when it
  is called twice.

### End-to-end tests (`e2e/`)

`npm run test:e2e` compiles the extension, then runs Playwright specs against a
real VS Code window. `npm test` never runs them (Mocha's spec is
`test/**/*.test.ts`).

- `launchVscode()` starts Electron through Playwright's `_electron.launch` with
  the VS Code build cached in `~/.vscode-test` (resolved by
  `@vscode/test-electron`; `MINDSTREAM_E2E_VSCODE` overrides it for offline
  runs). Each window gets its own temp workspace, user-data dir, and
  extensions dir, loads this repo as `--extensionDevelopmentPath`, and runs
  with `--disable-extensions`, so the bundled Copilot and other extensions
  never interfere. No Playwright browsers are downloaded.
- `e2e/profile.ts` prepares every window's fresh user-data dir
  (`prepareUserData()`): a `User/settings.json` (`chat.disableAIFeatures` on,
  secondary side bar hidden) and, when a local profile exists, the window
  rectangle (written to `storage.json`) and the sidebar width (a copy of
  `state.vscdb`, where VS Code keeps `workbench.sideBar.size`). `window.zoomLevel`
  stays at its default (0).
- The local profile lives in `e2e/.profile/` (`window.json`, `state.vscdb`), is
  git-ignored, and is optional: without it every window opens with VS Code's
  defaults and no test depends on it. `npm run e2e:profile`
  (`e2e/capture-profile.ts`) opens a window, waits while you place, size, and
  widen the sidebar by hand, and saves the layout once you close the window
  (VS Code writes both only on close). Only the window rectangle is taken from
  `storage.json`, because the rest holds machine ids.
- The `launch` fixture (`test` from `e2e/helpers.ts`) closes every window and
  deletes its temp dirs, and attaches a screenshot when a test fails.
- A seeded data file is written before VS Code starts (`buildData()`, or
  `rawData` for a broken file); `readData()` / `waitForData()` read the file the
  extension writes.
- Code links: `files` writes workspace files before launch, `seedLink()` builds
  the link the editor command would store (with the real `buildLink()`), and
  `writeWorkspaceFile()` / `fs.rmSync` change or delete the file while the
  window is open to exercise `resolveLink()` (follow, `changed`, `missing`).
  To create a link through the UI, right-click the target line and wait for the
  status bar to show that line before choosing "Add note to this line": the
  command reads the cursor when it runs, which is a moment after the click.
- MCP specs (`mcp*.spec.ts`) give every window a free `mindstream.mcp.port`, so a test never
  touches 18741 on the developer's machine. `e2e/mcpAgent.ts` holds the helpers: `Agent`
  connects the official v2 client with the address and token that "Connect an AI agent
  (MCP)" put on the clipboard (the Generic client), so a spec drives MindStream the way a
  user's agent does. Two windows cannot share one user-data folder (the second VS Code
  process exits), so routing between windows is tested in `test/` (three windows in one
  process) and checked by hand (plan section 9.2).
- A step that asserts a command is hidden from the palette (work paused) uses
  `expectCommandHidden()`: it types the title, checks no entry matches, and
  always closes the palette, so it can never cover the sidebar's More button.
- The sidebar webview is a nested frame: `showSidebar()` opens the view and
  returns the frame whose URL is `fake.html` and that contains `#toolbar`.
- `runCommand()` uses the Command Palette by title. Commands hidden from the
  palette (resume work) are reached with `clickMoreMenuItem()`, which clicks
  the `More` action in `.part.sidebar .title-actions`.
- Run from VS Code's integrated terminal (or any process started by VS Code),
  the inherited `ELECTRON_RUN_AS_NODE` makes every launch fail with "Process
  failed to launch!". Unset it first (`env -u ELECTRON_RUN_AS_NODE npm run test:e2e`).
- A real window appears while tests run, and the workbench selectors
  (`.part.sidebar`, `.quick-input-widget`, `.notifications-toasts`) are
  VS Code internals: keep them in `e2e/helpers.ts`.

### Data flow (high level)

1. `activate()` builds a `StorageService` bound to the open workspace folder.
2. `ItemsStore` / `TypesRegistry` / `CategoriesRegistry` are constructed with
   that single `StorageService` (implementing `IStorage`), so all three
   share the same in-memory `MindStreamData` and persist to the same
   `.vscode/mindstream.data.json`.
3. `NotesService` is constructed over those registries, `WorkPauseStore`, and
   `LinkTracker`; every change to the data goes through it (see "NotesService").
   `SidebarProvider` renders the webview; it receives messages from the webview
   app (`media/sidebar/`) via `webview.onDidReceiveMessage`, delegates them to
   `SidebarController` (which writes through `NotesService` and asks for
   confirmations through `SidebarUi`), then calls `postState()` to push the
   updated state back to the webview. `NotesService.onDidChange` refreshes the
   view after a change stored by any other caller
   (`SidebarProvider.onDataChanged()`, skipped while a webview message is being
   handled, which refreshes once at its end).
4. Commands registered in `extension.ts` (Command Palette / view-title menu)
   call the `commands.ts` handlers (with an injected `CommandsDeps`), which
   in turn call into the registries/`SidebarProvider` methods or the
   `export.ts` / `report.ts` pure functions for Markdown/JSON/weekly-report
   export and JSON import.
5. `extension.ts`'s `watchDataFile()` registers a `vscode.FileSystemWatcher`
   on `.vscode/mindstream.data.json` inside the open workspace folder. Every
   `onDidChange`/`onDidCreate`/`onDidDelete` event goes through a `debounce()`-wrapped
   handler (200ms, `util.ts`) that calls `storage.reloadIfExternal()` and
   only calls `sidebar?.refresh()` when that returns `true`. This keeps the
   sidebar in sync when `mindstream.data.json` is edited outside this extension
   instance (manual edits, `git checkout`/`pull`, dev scripts, another VS
   Code window), without reacting to the extension's own writes (see
   "Safe writes / external-change detection" below). The `mindstream.refresh`
   command also calls `storage.reloadIfExternal()` before `sidebar?.refresh()`,
   so an explicit refresh never has to wait for the watcher.
6. `extension.ts` also subscribes to
   `vscode.workspace.onDidChangeConfiguration`; when
   `affectsConfiguration("mindstream")` reports a change, it calls
   `sidebar?.refresh()` so settings (e.g. UI direction, copy options) reach the
   webview immediately, without reopening the panel.
7. `SidebarProvider.refresh()` also publishes the Work Pause lock as the VS Code
   context key `mindstream.workPaused`, so the title-bar buttons and the
   More menu follow it (see §10).
8. An agent's request reaches the notes through `McpController` (see §13): the router
   window picks the window that owns the `workspace` folder, that window's tool handler
   calls `NotesService` (a write) or `NotesQuery` (a read), and `NotesService.onDidChange`
   refreshes the sidebar exactly as it does for a change made in the sidebar.

### Key conventions to keep in mind

- **Stable ids, not labels.** Items reference `typeId` / `categoryId`;
  renaming a type/category never breaks existing items.
- **No native `<select>` in the webview.** Always use
  `renderCustomSelect()` / `bindCustomSelect()` from `media/sidebar/customSelect.js` for a
  single-value select; use `DropdownMenu` (`media/dropdown-menu.js`, §8) for a
  menu of grouped options, toggles, or actions.
- **Priority is optional per note.** An absent `priority` key means
  "unassigned" and is never read as a default level. See §7.
- **Constructor injection over globals.** See §1 above — the same pattern
  used for `IStorage` should be followed for any new shared service
  (including the `OutputChannel`).
- **Safe writes / external-change detection.** `StorageService` always
  writes to a temp file then renames, to avoid corrupting
  `.vscode/mindstream.data.json` on crash. It also tracks the raw text of its own
  last load/save (`lastKnownText`). `reloadIfExternal()` re-reads the
  backend and only replaces the in-memory data (returning `true`) when the
  text differs from `lastKnownText` - a plain `===` comparison, not a
  timing-based flag, so it never misses or misfires regardless of how fast
  filesystem-watcher events arrive. When the text matches, it is either no
  change at all or an echo of this same instance's own write, and
  `reloadIfExternal()` returns `false` without touching `this.data`.
- **The data file is never overwritten when it cannot be trusted.** See
  "Save guard" below.

### Save guard (`storage.ts`)

Not every write comes from the user: background link tracking and, later,
automated callers write too. A refused or failed write therefore changes
nothing at all, and its message alone explains it.

- `parseDataText()`: no file, an empty file, or whitespace (a leading BOM is
  ignored) is a new project with default data. Invalid JSON or a value that is
  not an object (`null`, an array, a number) is a `StorageProblem` of kind
  `invalid`, never a reason to start over.
- `forDir()`'s `load()` returns `null` only for `ENOENT`; any other read error
  is thrown and becomes a problem of kind `unreadable`.
- While `getProblem()` returns a problem, the last good data stays in memory
  and `saveData()` throws `StorageError` (`code` `STORAGE_BLOCKED`) before any
  write, so no `.tmp` file is created. A write that fails throws `WRITE_FAILED`
  and removes the `.tmp` file. The final rename goes through `renameWithRetry()`,
  which retries `EPERM`/`EBUSY`/`EACCES` up to 5 times (20 ms growing pause)
  because on Windows another process (antivirus, indexer) can hold the target
  for a moment; any other error is thrown at once.
- Every failed `saveData()` restores the in-memory data from the last saved or
  loaded text (`committedText`), so a caller that mutated `getData()` in place
  leaves no change behind. `InMemoryStorage` (tests) mirrors this through its
  `problem` field; `BLOCKED` in `test/helpers.ts` is a ready-made problem.
- `StorageError.message` is complete: `Not saved: <reason> Nothing was changed.
<how to fix>` (`blockedSaveMessage()`, `writeFailedMessage()`).
- Recovery: the problem clears when the file becomes valid, returns to the last
  saved text (a lock released), or is deleted. A deleted file never wipes the
  data in memory; the next save writes it again.
- `extension.ts` calls `createStorageNotifier().check()` after activation, every
  watcher reload, `mindstream.refresh`, and window focus while a problem is set;
  `describeStorageTransition()` (compared by problem kind) decides whether to
  warn that saving is off or to say that it is back on.
- Callers: `SidebarProvider.handleMessage` and `resumeWork` show the
  error and refresh the view; `LinkTracker` drops refused background writes
  silently (`flush`, `applyRename`, `applyDelete`, `setLink` calls), and
  `resolveItem` still returns the resolved location; `importJson` reports the
  problem before opening any dialog and catches a save refused later.

### Archived notes are read-only (`itemsStore.ts`)

Archiving freezes a note. The rule lives in `ItemsStore`, so the sidebar and
any automated caller get the same answer.

| Operation on an archived note                   | Result                                    |
| ----------------------------------------------- | ----------------------------------------- |
| `update`, `changeStatus`, `setTaskCompleted`    | throws `ArchivedNoteError`, nothing saved |
| `setArchived` (archive / unarchive)             | allowed: unarchiving is the way back      |
| `delete`, `deleteByCategory`                    | allowed                                   |
| `setLink`, `mapLinks` (host-side link tracking) | allowed: not a user edit                  |
| Read, export, report, import/merge              | allowed                                   |

- `NotesService` checks it after the note is found (an unknown id is
  `NOT_FOUND`) and before any other check, so `changeStatus` to the same status
  is refused too: an automated caller never mistakes a refusal for success.
  `ItemsStore` keeps the same check for direct callers.
- `ArchivedNoteError` (`code` `NOTE_ARCHIVED`) has a complete message: `Not
saved: the note "<title>" is archived, and archived notes are read-only.
Nothing was changed. Unarchive it first, then try again.`
  `SidebarProvider.handleMessage` shows it and refreshes the view, like a
  `StorageError`.
- Work Pause is checked first, at the entry point.
- Webview: an archived card's status is a plain badge (no click, no tooltip,
  default cursor) and the card has no Edit button; View, Unarchive, and Delete
  stay. The viewer hides Edit and shows the checklist read-only (disabled
  checks, no row click) and a hint above the buttons (`#view-archived-hint`: "To edit
  this note, unarchive it first.") that explains the missing Edit button.
- A note archived elsewhere while its editor is open: Save is refused
  (`noteSaveResult` `ok: false`), the editor keeps what was typed, and only
  the user's Cancel closes it. The editor is never closed on the user's behalf.

### At least one type

A note cannot be saved without a type, so the data always holds one.

- `normalizeData()` restores the default types when `types` is missing or empty.
- `NotesService.restoreDefaultTypes()` (`TypesRegistry.restoreDefaults()`) adds
  every `DEFAULT_TYPES` entry whose label is missing (trimmed, case-insensitive),
  after the existing types and in one save. Existing types are never changed or
  reordered, a renamed default counts as missing, and nothing is written (or
  announced) when none is missing. It is reached by the "Restore default types"
  icon button beside the close button in the Manage Types modal header
  (`restoreDefaultTypes` message, no confirmation)
  and by the `mindstream.restoreDefaultTypes` command; both show an info message
  with the added labels, and both are refused while work is paused.
- `TypesRegistry.remove()` throws when asked to remove the last type.
  `NotesService.typeDeletionProblem()` states why a type cannot be deleted (the
  last one, or used by notes); the `deleteType` message shows it before any
  dialog, and `NotesService.deleteType()` refuses the same cases.
- `NotesService` refuses a note whose `typeId` (a missing one from the form
  included) or `categoryId` does not exist (`NOT_FOUND`); the editor gets
  `noteSaveResult` with `ok: false` and stays open with what was typed. A save
  is never answered as stored when nothing was written.

### NotesService (`notesService.ts`)

The single entry point for every change to notes, types, categories, and the
Work Pause note. The sidebar (`SidebarController`) calls it, and so will any
automated caller (an MCP server for an agent); rules live here once. It has no
`vscode` import and is tested with `InMemoryStorage` and `FakeFiles`.

Every write, in order:

1. `storage.reloadIfExternal()` picks up a change made outside this instance
   (and emits `onDidChange` when it did).
2. Refuses while work is paused (`WORK_PAUSED`) or the data file cannot be
   trusted (`STORAGE_BLOCKED`).
3. Checks ids (`NOT_FOUND`, never a silent no-op), archived notes
   (`NOTE_ARCHIVED`), and input (`INVALID_INPUT`, `DUPLICATE`,
   `LINK_INVALID`), with the limits in `noteInput.ts` (title 300, description
   50000, names 80, 200 tasks of 500). Input over a limit is refused, never cut.
4. Refuses content changed since the caller read it (`CONFLICT`, see below).
5. Writes once (a value that would not change anything writes nothing), then
   emits `onDidChange`.

Rules:

- A refused write changes nothing. Every message reads `Not saved: <reason>.
Nothing was changed. <fix>` (`refusal()`); `errorCodeOf()` returns the code,
  and `ERROR_CODES` lists them all.
- No dialogs: confirmations belong to the caller. `checkWritable()` lets the
  caller refuse (with the reason) before asking the user anything.
- While work is paused only `saveWorkPauseNote(text, { userEditWhilePaused:
true })` and `deleteWorkPauseNote(base)`, used by the sidebar's note panel,
  are allowed. `deleteWorkPauseNote` removes the note and so ends the pause;
  `checkWorkPauseNoteDeletable(base)` refuses before the confirmation (saving
  off, no note, or `CONFLICT` when the note on screen is no longer the stored
  one). No automated caller is offered either. Pausing and resuming
  otherwise happen only through the user's own clicks (§10).
- Defaults for a new note: the General category, the category's
  `defaultTypeId` (else the first type), `pending`, and `DEFAULT_PRIORITY`
  while priority is on. While `mindstream.priority.style` is `off`, no priority
  is written and a sent one is refused.
- `setArchived(id, false)` re-resolves the note's code link
  (`LinkTracker.resolveItem`), which is not re-checked while archived.
- `linkFor({ filePath, lineStart, lineEnd })` builds a link from the file's
  current content (`LinkFiles`, an open editor's unsaved text included) and
  refuses a path outside the workspace (`isSafeRelativePath`), a missing file,
  or lines the file does not have. Links are never edited.
- `deleteCategory` removes the category and its notes in one save
  (`CategoriesRegistry.removeWithNotes`); the General category is refused.
- Names of types and categories are unique, ignoring case (`DUPLICATE`
  carries the existing entry in `current`).

### Concurrency: content written elsewhere is never overwritten

Two kinds of writes:

| Kind                      | Examples                                                                          | Rule                                    |
| ------------------------- | --------------------------------------------------------------------------------- | --------------------------------------- |
| A command on one value    | status, archive, one task (`setTaskCompleted`), title, type, category, priority   | applied at once, no base needed         |
| A rewrite of content read | the note form's Save, replacing the description or the task list, Work Pause text | needs a base; changed since: `CONFLICT` |

- The note form sends `base`: the editable fields as they were when it opened
  (`NoteForm.baseOf`). Only a listed field that changed refuses
  (`changedSince`), so a status changed elsewhere never blocks it; line endings
  and blank tasks are not differences. The message names the changed fields,
  and the form stays open with what was typed. While the form is open, every
  `state` runs `checkOpenNoteChanged()`, which shows `#f-changed-notice` as
  soon as the stored note differs (or is gone), before Save.
- An automated caller passes `expectedUpdatedAt` (the note's `updatedAt` when
  it read it). Replacing the description or the tasks without a base is refused
  (`INVALID_INPUT`), so a stale copy can never overwrite. `CONFLICT` carries
  the current note in `current`, so the caller can redo its change.
  `appendDescription` adds a paragraph and needs no base.
- `setTaskCompleted` refuses (`CONFLICT`) when the task at `index` no longer
  has the expected title.
- The Work Pause panel sends the text it started editing as `base`; once a
  note exists, a save without a base is refused. The panel keeps the draft
  until the host answers `workPauseSaveResult { ok }`.

- **Category default types.** A category may carry an optional
  `defaultTypeId`. When the "New note" form opens (or the category changes
  there), `media/sidebar/noteEditor.js` pre-selects that type via
  `resolveCategoryDefaultTypeId()` in `media/defaultType.js`, which falls
  back to the active type filter and then to the first registered type
  ("General" by convention). The "Manage Categories" modal sets it through a
  `setCategoryDefaultType` message answered by a native QuickPick
  (`SidebarProvider.pickType`).
- **Emoji palette & recents are global, not workspace data.** They live in
  VS Code `globalState` (key `mindstream.emoji`), managed by `EmojiRegistry`
  behind an `EmojiMemento` adapter — never in `.vscode/mindstream.data.json`. See §5.
- **Note-editor description height is global, not workspace data.** It lives in
  VS Code `globalState` (key `mindstream.ui`), managed by `UiPrefsRegistry`
  behind a `UiPrefsMemento` adapter. See §6.
- **The Work Pause note is project data, kept beside the notes.** It is the
  `workPauseNote` key of `.vscode/mindstream.data.json`, never inside `items`, and
  while work is paused the whole UI is locked. See §10.

### `renderCustomSelect()` — Option Item Schema

All dropdowns use `renderCustomSelect()` + `bindCustomSelect()` from `media/sidebar/customSelect.js`.

Each element in the `options` array passed to `renderCustomSelect()` supports the following keys:

|     Key      |  Type  | Required | Description                                                                                                                                             |
| :----------: | :----: | :------: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   `value`    | string |    ✅    | The value stored and passed to `onChange`                                                                                                               |
|   `label`    | string |    ✅    | The display text shown in the button and menu                                                                                                           |
|  `tooltip`   | string | optional | Added as `data-tooltip` on the `.cs-item` element                                                                                                       |
| `badgeStart` | string | optional | Raw HTML string (e.g. an SVG icon) injected inside `.cs-item-badge`, fixed before the label                                                             |
|  `badgeEnd`  | string | optional | Raw HTML string (e.g. a count) injected inside `.cs-item-badge`, fixed after the label. Both `badgeStart` and `badgeEnd` may be set on the same option. |

The label and badges are always wrapped together inside `<span class="cs-item-label-group">`, keeping them visually grouped and separated from the checkmark which sits at the far right.

---

## 3. Tooltip system (`media/tooltip.js`)

A single, reusable data-tooltip system used everywhere in the webview UI.
Any element carrying a `data-tooltip` attribute automatically gets a themed
tooltip; no per-element JS wiring is required at the call site.

### Where it lives

`media/tooltip.js` is loaded as a global `<script>` before the webview app bundle (`dist/media/sidebar.js`)
(see `sidebarProvider.ts`'s `getHtml()`), the same pattern used for
`media/iconClass.js` and `media/defaultType.js`.

### Supported attributes

|       Attribute       | Required | Description                                                                              |
| :-------------------: | :------: | ---------------------------------------------------------------------------------------- |
|    `data-tooltip`     |    ✅    | Body text (bold). Injected via `innerHTML` - only trusted content, never raw user input. |
| `data-tooltip-header` | optional | Header text (small, muted), shown above the body.                                        |
| `data-tooltip-footer` | optional | Footer text (small, muted), shown below a divider.                                       |
|  `data-tooltip-pos`   | optional | `top` \| `bottom` (default) \| `left` \| `right`.                                        |

### How it works

- **Event delegation.** A single `mouseover`/`mouseout` listener pair on
  `document` uses `event.target.closest('[data-tooltip]')` to find the
  hovered element, guarded against flicker when the mouse moves between
  nested children of the same target (checked via `event.relatedTarget`).
- **Stationary-pointer suppression.** A `mousemove` listener records the
  last pointer position and its `timeStamp` (plain numeric writes, no DOM
  reads). The `mouseover` handler then ignores any hover whose coordinates
  match the last known position while the last `mousemove` is older than
  150ms, because browsers re-dispatch `mouseover` when a layout change
  (e.g. resizing the VS Code window) slides a different element under a
  stationary pointer - without this guard such synthetic hovers would show
  tooltips without any real mouse movement. The decision lives in the pure
  `isLayoutInducedHover()` helper.
- **Keyboard support.** `focusin`/`focusout` on `document` show/hide the
  tooltip when the element receives focus via Tab, matching VS Code's own
  hover behavior. Any focus counts, including `element.focus()` from a script,
  so never move focus programmatically onto an element that has a
  `data-tooltip` unless showing that tooltip is intended.
- **Show delay / instant hide.** Showing is delayed 500ms (mirrors VS Code's
  hover timing); hiding is immediate.
- **Dismissal.** The tooltip hides on any `pointerdown` anywhere (capture
  phase, including on its own target), on `Escape`, on `window` `scroll`
  (capture phase, since scroll doesn't bubble), and on `window` `blur`.
- **Live tracking.** While visible, a `requestAnimationFrame` loop
  recomputes the tooltip's position every frame and hides it immediately if
  the target element is removed from the DOM (e.g. a re-render) or has
  moved (e.g. a FLIP reorder animation), instead of relying on a
  one-time position calculated at show time.
- **Single reused element.** One `.tooltip` div is created once and reused
  (`ensureTooltip()`), shown/hidden purely via the `.visible` CSS class -
  never `el.remove()`/re-creation and never inline `style` (per the
  "No Inline Styles" rule; only `--arrow-x`/`--arrow-y` custom properties
  are set via `style.setProperty()`, since those are runtime-computed
  pixel offsets).
- **Menu-aware suppression.** `isSuppressedByOpenMenu(target)` detects any
  currently open menu generically via the standard `[role="menu"]:not([hidden])`
  ARIA selector (not a dropdown-specific class), and suppresses the tooltip
  for any target outside that menu. This is checked when a tooltip is about
  to start its show timer, right before it is actually revealed, and on
  every `requestAnimationFrame` tick while it stays visible - so a button
  that opens a menu right below itself (e.g. a dropdown's `.cs-btn`) never
  shows its own tooltip overlapping the first menu item, while tooltips for
  elements inside the open menu itself (e.g. a per-option `data-tooltip` on
  a `.cs-item`) are still allowed to show normally.

### Interaction with the custom-select component

`renderCustomSelect()` (see § 2's `renderCustomSelect()` Option Item Schema
above) generates this structure:

```
<div id="{wrapperId}" class="cs-wrap">
  <button id="{btnId}" class="cs-btn">...</button>   <!-- sibling of the menu -->
  <div id="{menuId}" class="cs-menu">                <!-- sibling of the button -->
    <div class="cs-menu-items-wrapper">
      <div class="cs-item" data-value="...">...</div>
      ...
    </div>
  </div>
</div>
```

The button and the menu are **siblings**, both wrapped by the same `.cs-wrap`
container. Because the tooltip system finds its target with
`event.target.closest('[data-tooltip]')`, putting `data-tooltip` on the
`.cs-wrap` container makes it a shared ancestor of every `.cs-item` in the
menu too - hovering any menu item then incorrectly picks up the wrapper's
tooltip instead of showing no tooltip (or the item's own).

Rule for where to put `data-tooltip` around a custom select:

| Want a tooltip on...                                | Put `data-tooltip` on...    | How                                                                                                                                                                                                              |
| --------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The dropdown as a whole (e.g. "Filter by category") | `#{btnId}` (`.cs-btn`) only | `document.getElementById(btnId).dataset.tooltip = '...'`, set right after calling `renderCustomSelect()`                                                                                                         |
| A specific option in the menu                       | The option's own `.cs-item` | Set `tooltip` (and optionally `tooltipFooter`) on that entry in the `options[]` array passed to `renderCustomSelect()` - it is rendered as `data-tooltip`/`data-tooltip-footer` on that `.cs-item` automatically |
| The `#{wrapperId}` container (`.cs-wrap`)           | Never                       | It is a shared ancestor of both the button and every menu item; `closest()` would pick it up while hovering menu items                                                                                           |

See `populateCategoryFilter()` and `populateTypeFilter()` in
`media/sidebar/toolbar.js` for the applied pattern (tooltip set on `#{btnId}` right
after `renderCustomSelect()` returns its HTML). `DropdownMenu` (§8) appends its
menu to `<body>`, so a `data-tooltip` on its trigger never wraps the menu items.

### Pure, testable core

`computeTooltipPosition()` (clamps to the viewport and flips to the opposite
side when there's no room), `buildTooltipHtml()` (assembles the
header/body/footer markup), and `isLayoutInducedHover()` (rejects hovers
where the pointer did not actually move, see "How it works" above) are
side-effect-free functions exported through a guarded `module.exports`
block, following the same pattern as `media/iconClass.js`. They are
unit-tested in `test/tooltip.test.ts` without any DOM/vscode stubbing. The
DOM-wiring part of the file only runs inside a real webview (guarded by
`typeof document !== 'undefined'`) and is not covered by unit tests,
consistent with the rest of the interactive code in `media/sidebar/`.

---

## 4. `media/sidebar.css` conventions

### Design tokens

`:root` defines shared tokens used throughout the file instead of repeating
magic numbers:

- `--radius-sm` (4px) / `--radius-md` (6px) / `--radius-lg` (8px) - all
  `border-radius` values in the file use one of these instead of a literal
  pixel value.
- `--gap` - shared spacing unit for flex gaps/padding.
- `--status-in-progress-color` / `--status-done-color` - resolve to
  `var(--vscode-charts-orange)` / `var(--vscode-charts-green)` (with a fixed
  hex fallback only for very old VS Code builds that predate those
  variables), so the pending/done status colors stay theme-aware instead of
  being hardcoded hex values that can fail contrast in some themes.
- `--ms-status-canceled-color` / `--ms-status-canceled-border-color` - the
  Canceled card title, card border, and status badge. They are defined on
  `body`, not `:root`, because they mix `--ms-blend-color` /
  `--ms-deep-color`, which exist only on `body.vscode-dark` /
  `body.vscode-light`; on `:root` they would always resolve to the fallback.
  The card keeps the focus-border color on hover.

### Hover vs. selected state colors (state-based, never theme-specific)

Two different state pairs exist in VS Code themes and must not be confused:

- **Plain hover** (`list.hoverBackground`, `toolbar.hoverBackground`) has no
  matching foreground variable. VS Code guarantees these backgrounds stay
  readable against the _default_ foreground (`--vscode-foreground`) in every
  theme, so a plain `:hover` rule must only change `background` and must
  never touch `color`. Changing `color` on hover forces every child's text
  to follow (via `color: inherit` or `currentColor`), which silently breaks
  any child that has its own independent background - e.g. `.type-icon-btn`
  keeps a fixed light `--vscode-input-background` with a dark icon on top;
  if the hovering ancestor's text turned white, the icon would vanish
  against that still-light background even though nothing else about the
  child changed.
- **Real selection state** (`list.activeSelectionBackground` +
  `list.activeSelectionForeground`, or `quickInputList.focusBackground` +
  `quickInputList.focusForeground`) is a background/foreground pair from the
  same semantic source, guaranteed readable together by VS Code's own theme
  contract in every theme including high-contrast ones. Only use this pair
  for an element representing an actual "selected/focused" item (e.g.
  `.cs-item[data-highlighted]`), and switch `color` together with
  `background` there - children that don't set their own color follow via
  `color: inherit`.

Never fix a theme-specific contrast bug by targeting
`body[data-vscode-theme-id="..."]` selectors. That only patches the named
themes and leaves every other theme (including any theme the user installs
later) with the same bug. Always fix the root cause by picking the correct
state pair above (plain hover = background only; real selection = paired
background + foreground), so it works in every theme without naming any of
them.

Applied examples in `media/sidebar.css`:

- `.cs-item[data-highlighted] .cs-item-badge { color: inherit; }` - a real
  selection state, so the badge follows the highlighted item's own color
  instead of keeping `--vscode-descriptionForeground` fixed.
- `.icon-pick.selected` marks the currently chosen icon in the icons picker
  (types management modal) and switches `background` and `color` together
  using the `quickInputList.focus*` pair, the same source as
  `.cs-item[data-highlighted]`.
- `.mgmt-row:hover` and `.icon-pick:hover` are plain hover: they change only
  `background`, leaving `color` untouched on the row/button and every child
  (including `.type-icon-btn`'s independent background/icon).

### Shared Categories/Types management-row classes

The Categories and Types management modals render structurally identical
rows, so they share one set of CSS classes (`.mgmt-*`) instead of
duplicating rules under `.category-*`/`.type-*` names:

| Class                | Used by                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `.mgmt-row`          | The row container in both modals                                                                   |
| `.mgmt-label`        | The category/type name                                                                             |
| `.mgmt-count`        | The item-count badge                                                                               |
| `.mgmt-new-badge`    | The transient "New" badge shown after adding an entry (`@keyframes mgmt-added` / `mgmt-badge-out`) |
| `.mgmt-form`         | The "add new" input row at the bottom of each modal                                                |
| `.mgmt-rename-input` | The inline rename `<input>` that replaces `.mgmt-label`                                            |

`.category-default-badge` stays category-only (Types has no "Default"
concept). `.type-icon-btn` stays type-only (the change-icon button embedded
in the row). Both are layered on top of `.mgmt-row` rather than duplicated.

`renderCategories()`/`startRenameCategory()` (`media/sidebar/categoriesModal.js`)
and `renderTypes()`/`startRenameType()` (`media/sidebar/typesModal.js`) assign these shared class names
when building each row.

---

## 5. Emoji picker (global, shared across all workspaces)

### Where the state lives

The emoji palette (the curated, user-editable list) and the recent-usage
history are **global** — shared by every project — so they are stored in
VS Code `globalState` under the key `mindstream.emoji`, not in the
workspace's `.vscode/mindstream.data.json`.

`src/emojiRegistry.ts` exposes `EmojiRegistry` with:

- `palette()` / `recents()` — read access.
- `recordUse(emoji)` — moves an emoji to the front of `recents`, dedupes,
  and caps the list at `MAX_EMOJI_RECENTS` (12).
- `setPalette(list)` — normalizes (trim, drop empty, dedupe preserving
  order) and replaces the palette.

It also exports `DEFAULT_EMOJI_PALETTE`, `MAX_EMOJI_RECENTS`,
`normalizePalette()`, and the `EmojiMemento` interface. The registry takes an
`EmojiMemento` (just `get`/`update`), never `vscode` directly, so it is
unit-tested with a fake memento. `extension.ts` adapts `context.globalState`
into an `EmojiMemento` and passes the registry into `SidebarProvider` →
`SidebarController`.

### Default palette curation

`DEFAULT_EMOJI_PALETTE` holds the picker default and the list restored by
"Restore original emoji list": colors/shapes, books/documents, status and
action marks, alerts, development tools, communication, time/scheduling,
flow/arrows, a small deliberate face set, objects/weather/finance, keycaps, a
flag, and a heart.

### Webview flow

- Shortcuts in the note editor's title (`#f-title`), description (`#f-desc`),
  and task title (`input.task-title-input`) fields:
  - `Ctrl+Shift+/` (`Cmd+Shift+/` on macOS) opens the emoji picker.
  - `Ctrl+/` (`Cmd+/` on macOS) inserts the most-recent emoji directly (no popup).
- `media/sidebar/emojiPicker.js` matches these via a document-level `keydown`
  listener using `e.code === "Slash"` (layout-independent) with a Ctrl/Cmd
  modifier, then inserts at the caret (`selectionStart`/`setSelectionRange`) and
  records the use. The listener and the focus tracking are delegated to the
  document (`isEmojiField()` matches `#f-title`, `#f-desc`, or a
  `task-title-input`), so dynamically created task title inputs participate
  without per-row bindings. The programmatic insert also dispatches an `input`
  event, because the task editor copies a title into its form model only on
  that event (a plain `.value` assignment would show the emoji but drop it on
  save).
- A compact `#emoji-hint` hint in the editor's action bar (`.emoji-hint`)
  reads `💡 Ctrl+Shift+/ inserts an emoji` (⌘⇧/ on macOS). Clicking it opens the picker
  anchored to the last focused title/description/task-title field.
- The picker (`#emoji-picker`) is a fixed-position popup positioned with
  `--picker-top`/`--picker-left`/`--picker-width` custom properties computed
  in JS (the sanctioned `style.setProperty` use). While it is open, a
  `window` `resize` listener re-runs the positioning so the popup keeps
  tracking its field when the window is resized. It shows a "Recent" row
  (hidden when empty) above the full palette grid.
- The "Edit list" button opens `#emoji-edit-modal`, a plain `<textarea>`
  (`#f-emoji-list`) holding the emoji as a concatenated sequence. Pasting is
  intercepted and validated per emoji: plain text is silently dropped, and a
  duplicate shows a transient red "Already exists" notice (3 seconds,
  debounced) next to the Cancel button instead of inserting. Saving sends
  `updateEmojiPalette` with the emoji-only array produced by `splitEmojis()`.
  A "Restore original emoji list" link (`.link-btn`) sits on the field's
  label row and posts `restoreEmojiPalette`; after a native confirmation the
  palette is reset to `DEFAULT_EMOJI_PALETTE`, and the returned `state`
  re-syncs the open textarea and preview.

### `media/emoji.js` — `splitEmojis()` and `isEmoji()`

Two side-effect-free helpers (loaded as globals before the webview app bundle, and
required directly by Mocha tests):

- `splitEmojis(text)` splits a plain string into individual emoji using
  `Intl.Segmenter` with `granularity: "grapheme"`, discarding whitespace.
  Grapheme clustering keeps multi-codepoint sequences (ZWJ families, flags,
  variation selectors) intact.
- `isEmoji(grapheme)` returns whether a single grapheme is a rendered emoji
  rather than plain text. It matches `Extended_Pictographic`,
  `Emoji_Presentation`, regional indicators and keycap/variation markers, but
  excludes the bare keycap bases (digits, `#`, `*`) that also carry the
  `Emoji` property.

### Messages

Three `WebviewMessage` types flow through `SidebarController`:

- `recordEmojiUse` (`emoji: string`) → `EmojiRegistry.recordUse`.
- `updateEmojiPalette` (`palette: string[]`) → `EmojiRegistry.setPalette`.
- `restoreEmojiPalette` → asks the host via
  `SidebarUi.confirmRestoreEmojiPalette` and, on confirmation, calls
  `EmojiRegistry.setPalette(DEFAULT_EMOJI_PALETTE)`.

`postState()` includes `emojiPalette` and `emojiRecents`; the webview stores
them in `state.emojiPalette`/`state.emojiRecents` and updates recents
optimistically on pick/insert.

## 6. Note-editor description height (global)

### Where the state lives

The description textarea (`#f-desc`) height is a per-user UI preference, shared
across every workspace and stored in VS Code `globalState` under the key
`mindstream.ui` — never in `.vscode/mindstream.data.json`.

`src/uiPrefs.ts` exposes `UiPrefsRegistry` with `descriptionHeight()` (read) and
`setDescriptionHeight(height)` (write), plus `clampDescriptionHeight()`. The
clamp coerces any raw value into an integer within `MIN_DESCRIPTION_HEIGHT`
(55) and `MAX_DESCRIPTION_HEIGHT` (600), falling back to
`DEFAULT_DESCRIPTION_HEIGHT` (128) on invalid input. Like `EmojiRegistry`, it
depends only on a `UiPrefsMemento` (`get`/`update`), so it is unit-tested with
a fake memento; `extension.ts` adapts `context.globalState` into it and passes
the registry into `SidebarProvider` → `SidebarController`.

### Webview flow

- `postState()` includes `descriptionHeight`; `media/sidebar/messages.js` stores it in
  `state.descriptionHeight`.
- `applyDescHeight()` runs when the note editor opens (`openAdd`/`openEdit`) and
  again on window resize while it is open, and sets a `--desc-height` CSS custom
  property consumed by `#f-desc { height: var(--desc-height, 128px); }`. It
  clamps the persisted height so the `.modal-card` never overflows the current
  viewport: it measures the card with the textarea collapsed to its minimum,
  then caps the height at `viewport - gutter - cardAtMin`. The same ceiling is
  also applied as the textarea's `max-height`, so a manual drag cannot push the
  card outside the window. A tall height saved while the sidebar was large is
  therefore shown clipped (not persisted smaller) when reopened small.
- A `ResizeObserver` on `#f-desc` posts `setDescriptionHeight` only when the
  user drags the resize handle — it ignores the programmatic apply via the
  `appliedDescHeight` marker, and only runs while the modal is open.

### Messages

- `setDescriptionHeight` (`height: number`) → `UiPrefsRegistry.setDescriptionHeight`.

## 7. Note priority and the View menu

### Data

- `MindStreamItem.priority?` is one of `critical | high | medium | low`
  (`src/priority.ts` `PRIORITIES`, highest first). An absent key means
  "unassigned": it is never read as a default level, never drawn on a card,
  and sorts after Low.
- `normalizeData()` drops an unknown priority value and never adds the key.
- `DEFAULT_PRIORITY` (`"low"`) is the single source of the default level. The
  host posts it to the webview (`priority.defaultValue`); `media/*.js` never
  hard-codes a level.

### Setting and feature switches

- `mindstream.priority.style`: `dot | stripe | chip | typeStripe | off`
  (default `chip`), read by `SidebarProvider.getPriorityStyle()` through
  `normalizePriorityStyle()` (unknown values fall back to the default).
- `priorityFeatures(style)` returns `{ enabled, editor, group, sort, filter,
cardIndicator }`. `postState()` sends it as `priority`, together with
  `levels`, `labels`, and `defaultValue`. The webview checks these flags, never
  the style string, so each part can be switched off independently.
- `"off"` disables every flag: no card indicator, no editor control, and no
  priority entries in the View menu. Stored priorities stay in the file.

### Save rules (`SidebarController` and `NotesService`)

Both receive a `priorityEnabled()` callback (the live setting). `NotesService`
refuses a priority sent while the system is off; the controller sends only a
valid level, and only while it is on.

| Message      | Enabled                                                                                 | Disabled                          |
| ------------ | --------------------------------------------------------------------------------------- | --------------------------------- |
| `addItem`    | stores the sent level, or `DEFAULT_PRIORITY` when none/invalid                          | never writes the key              |
| `updateItem` | stores a valid sent level; otherwise leaves the stored value (or its absence) untouched | leaves the stored value untouched |

### Webview

- Note editor: `#f-priority` is a segmented radiogroup built by
  `fillPriorityControl()` (roving tabindex, arrows/Home/End, mirrored arrows
  in RTL). New notes open on `defaultValue`. A note without a priority opens
  with nothing selected and the `#f-priority-hint` text "No priority assigned
  - Select one."; `saveModal()` sends `priority` only when a level is selected.
- Saving: `saveModal()` sends `addItem`/`updateItem` with a `saveId`, disables
  `#modal-save`, and keeps the editor open. The host answers with
  `noteSaveResult` (`saveId`, `ok`); the editor closes only when `ok` is true,
  so a refused save (storage problem, work paused, a note changed elsewhere)
  keeps everything typed. An edit Save also sends `base` (see "Concurrency"). A
  refused `addItem` keeps the host's pending code link for the retry. Closing
  or reopening the editor forgets a Save still waiting, so a late answer never
  closes a newer form.
- Cards: `buildCardBase()` adds `prio-<level>` and `prio-ind-<style>` and the
  matching element (title dot, footer chip, or a stripe via CSS). Color-only
  stripes also get an `.sr-only` "(Priority: X)" text.
- Colors: `--priority-critical/high/medium/low` in `media/sidebar.css`;
  `.prio-<level>` sets `--prio` (and `--dm-marker-color` for menu dots).

### View menu (`media/viewOptions.js`)

The toolbar `#view-options-btn` opens a `DropdownMenu` built from
`ViewOptions.menuEntries()`; `ViewOptions.applySelection()` turns a selection
into the next view. The view `{ groupBy, sortBy, hiddenPriorities }` is
persisted with `vscode.setState` (default `status` + `priority`).

- `groupBy`: `none | status | priority`. None, In Progress, and Done groups
  are always listed; Canceled (ranked last) only when it has notes;
  priority groups list every visible level (even empty) plus `Unassigned` only
  when it has notes. Group keys are scoped (`status:done`, `priority:high`),
  and collapse state is stored per key.
- `sortBy` is a comparator chain; the grouped key (and `priority` while
  disabled) is removed from it. Ties keep the file order.

| sortBy     | Chain                    |
| ---------- | ------------------------ |
| `date`     | `updatedAt` newest first |
| `fixed`    | none (file order)        |
| `status`   | status → priority → date |
| `priority` | priority → status → date |

- The sort option equal to the group key is disabled with a hint and `date`
  applies instead; the saved choice is kept and returns when valid again. The
  same rule keeps priority group/sort saved while the system is disabled.
- `hiddenPriorities` hides levels; unassigned notes are never hidden. When
  everything visible is filtered out, the empty state offers "Show all
  priorities".

## 8. `DropdownMenu` component (`media/dropdown-menu.js` / `.css`)

A self-contained menu component kept free of MindStream code so it can move
to a shared library unchanged: it uses only the trigger's own
`document`/`window`, and every style is a `--dm-*` custom property that falls
back to VS Code theme colors (`--vscode-menu-*`).

- `DropdownMenu.create({ trigger, entries, onSelect, label?, align?,
className?, hintAttribute?, onOpenChange? })` returns `{ element, open,
close, toggle, isOpen, setEntries, destroy }`. The menu element is appended
  to `<body>` and positioned with `position: fixed` via `--dm-left`/`--dm-top`/
  `--dm-max-height` (`style.setProperty`, no inline declarations).
- Entries: `item`, `checkbox`, `radio-group`, `group` (with optional label),
  `separator`; any entry accepts `hidden: true`. Hidden entries, empty groups,
  and redundant separators are dropped.
- Controlled: it never changes `checked`/`value` itself. Update state in
  `onSelect`, then call `setEntries()`; the highlighted entry is restored.
- Checkbox and radio items keep the menu open; plain items close it
  (`closeOnSelect` overrides).
- Keyboard follows the WAI-ARIA menu button pattern (arrows wrap, Home/End,
  typeahead, Enter/Space, Escape/Tab return focus to the trigger). Disabled
  items stay focusable (`aria-disabled`) so their `hint` is reachable.
- `hint` is written to `hintAttribute` (default `data-tooltip`); text is
  written with `textContent`. Pure helpers are exported on `DropdownMenu.utils`
  and tested in `test/dropdownMenu.test.ts`.

## 9. Notes linked to code

A note may carry `link` (`MindStreamLink`): a workspace-relative `filePath`
(posix separators), `lineStart`, optional `lineEnd`, an `anchor` snapshot, and a
`state` (`ok | changed | missing`).

### Creation and immutability

- Only the editor context command `mindstream.addNoteToLine` ("Add note to this
  line", hidden from the Command Palette) creates a link. It uses the cursor
  line, or the selected lines, of a `file:` editor inside the workspace folder.
- The link stays in the host: `SidebarProvider.openAddNoteForLink()` offers it to
  the controller (`offerLink()`) and posts it to the webview for display only.
  Once the webview opens the new form it sends `newNoteFormOpened`, and the link
  becomes the controller's pending link (see "Opening a new note while a form is
  open"). The webview sends `addItem` with `linked: true`, and the controller
  attaches the pending link. A link sent by the webview is never read, and
  `updateItem` / `UpdateItemInput` have no link, so it cannot be edited, added,
  or removed from the note editor.
- The note editor, the viewer, and cards show a read-only badge
  (`path:line`); clicking it sends `openLink`, which re-resolves the link then
  opens the file at the line.

### Keeping the link correct

| Event                                                       | Handling                                                                                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Lines added/removed above the range                         | `onDidChangeTextDocument` shifts `lineStart` and `lineEnd` (`shiftLinkForEdits`)                                                             |
| Lines added/removed inside the range (after its first line) | only `lineEnd` moves; edits on the first line or crossing the end are left to `resolveLink`                                                  |
| Change outside the editor (git, terminal)                   | `refreshAll()` on startup and window focus (active notes only), and `resolveItem()` on open and on unarchive, re-find the code from `anchor` |
| Same code at another line                                   | link moves there (best before/after context, then nearest)                                                                                   |
| Range grew or shrank outside the editor                     | a range longer than 5 lines also stores its tail (`anchor.endText`); `resolveLink` re-finds head and tail together and updates `lineEnd`     |
| Code edited or removed                                      | state `changed`: position kept, badge warns, nothing is guessed                                                                              |
| File renamed or moved (file or folder)                      | `onDidRenameFiles` rewrites `filePath`                                                                                                       |
| File deleted, or moved out of the workspace                 | state `missing`: badge is struck through, the note is kept                                                                                   |
| File restored, or code back                                 | next re-check returns the state to `ok`                                                                                                      |

Live shifts are cheap: `applyEdits()` returns at once for edits that keep the line
count, changes memory only (`mapLinks(fn, false)`), and `flush()` writes them. A
`SaveScheduler` (3 s quiet, 20 s maximum wait) triggers the write, and it is also
flushed on file save, window blur, and shutdown. A lost shift is harmless: the
next `refreshAll()`/`resolveItem()` re-finds the code. While the sidebar is hidden
`postState()` is skipped, and the state is posted when it becomes visible again.

Archived notes still follow live edits, renames, and deletes, but `refreshAll()`
skips them, so their files are not read on every startup and window focus. Any
path that unarchives a note must re-resolve its link: `NotesService.setArchived()`
awaits `LinkTracker.resolveItem()` after a real unarchive, before the view
refreshes, so the sidebar and any automated caller get the same behavior. Until then an archived note's badge may show its last
known location; opening the link always re-resolves it first.

### Showing the path

The badge always keeps the file name visible. `fitLinkRow()` (in `media/sidebar/linkBadge.js`)
runs from one `ResizeObserver` over every link row (card, viewer, editor) and asks
`fitPath()` (`media/linkPath.js`) for the longest candidate whose canvas-measured
width fits the row: the full path when there is room, then the first folder plus
the last folders around a single `…`, then fewer folders, and finally the bare
file name. Folders are only ever dropped from the middle; the CSS ellipsis is a
last resort for a file name wider than the row. The tooltip and `aria-label`
carry the full location. The line range is measured together with the path.

Tracking never changes a note's `updatedAt`. `normalizeData()` runs every link
through `sanitizeLink()`: paths that are absolute, contain `..`, `\`, or empty
segments are dropped (the note is kept).

## 10. Work Pause note

The user's own note, written before stepping away from the project for a long
time ("where I stopped, what is next"). It is not a regular note: while work is
**paused** the whole UI is locked and the sidebar shows nothing but this note, so
the user is sure to read it when they come back. Only the user writes it (the
sidebar's note panel); it is not a record of agent sessions, and no MCP tool
writes it.

### Data

`MindStreamData.workPauseNote?: { text, updatedAt, paused }` is the last key of
`.vscode/mindstream.data.json`. It is absent until the first save and is never
added by `normalizeData()`; it is not part of `items`, so it never appears in a
note list, filter, or Markdown export.

- `text` is trimmed and capped at `MAX_WORK_PAUSE_TEXT` (10000 characters).
  `updatedAt` only moves when the text changes; the note shows it as
  `Updated: <dd/MM/yyyy hh:mm:ss AM|PM> (<age>)` at the bottom (`today`, `yesterday`, `N days ago`,
  counted in calendar days by `WorkPause.daysSince()`).
- `normalizeWorkPauseNote()` drops a value that is not a plain object and falls
  back to empty values for wrong field types. Work is never paused without
  text, so a hand-edited file cannot lock the user in with an empty note.
- `WorkPauseStore` (`src/workPauseStore.ts`) is the only writer: `save(text,
pause?)`, `pause()` (refuses without text), `resume()` (keeps the text),
  `clear()` (deletes the key, which also ends the pause), `isPaused()`. It uses
  `IStorage`, so it follows the same external-change reload as the notes.

### Turning it on and off

Only the user changes the lock, from the More menu (`...` in the view title) or
the note card:

| State | More shows                                               | Command                       |
| ----- | -------------------------------------------------------- | ----------------------------- |
| off   | `Pause work and show note` (and the export/import items) | `mindstream.workPause.pause`  |
| on    | `✓ Work paused - click to resume` only                   | `mindstream.workPause.resume` |

VS Code has no checked state for a contributed command, so the pair of commands
with opposite `when` clauses on the context key `mindstream.workPaused`
provides the check mark. The titles state the action and the way out in plain
words.

- **Pausing always opens the editor first.** `SidebarProvider.pauseWork()`
  reveals the view and posts `openWorkPauseEditor { note }` (the stored note
  travels with the request, so a page created by the reveal has it). The lock
  turns on only when the user saves (`saveWorkPauseNote` with `pause: true`).
  Saving the same text pauses without moving `updatedAt`.
- **A note from an earlier break is never locked in unread.** When a note is
  saved (`WorkPause.needsFreshStartChoice()`), the editor shows it with a
  `#work-pause-earlier` bar: its date and age, `Start a new note` (empties the
  textarea only; nothing is stored until Save) and `Keep it` (hides the bar;
  typing does the same). Cancel always leaves the stored note as it was; a
  blank draft leaves at once without asking.
- **On the locked card:** `Resume work` (`resumeWork`, the same as the More
  item; the note is kept) and `Delete & resume` (`deleteWorkPauseNote` with
  `base`, the text on screen). The host checks first
  (`checkWorkPauseNoteDeletable`: saving off, `CONFLICT`), then asks with a
  modal (`Delete and Resume`), then `NotesService.deleteWorkPauseNote()`
  removes the key in one write.

### Read-only editor tab and copy

Two header buttons work in view mode, locked or not: `Copy note` and `Open in
editor`. Both send no text: the controller reads the stored note.

- `copyWorkPauseNote` → `vscode.env.clipboard` and a status-bar message.
- `openWorkPauseNoteInEditor` → `WorkPauseDocument.open()`
  (`src/workPauseDocument.ts`): a `TextDocumentContentProvider` for the scheme
  `mindstream-pause` and the single URI `mindstream-pause:/Work Pause note.md`.
  - A content-provider document is read-only, so it is never dirty and closing
    never asks to save. No file is created, nothing is written.
  - The text is a snapshot (`WorkPauseCopy` in `src/workPause.ts`): it changes
    only when the user opens it again, never when the note is edited, saved, or
    deleted. Before the first snapshot of a session (a tab restored by a
    window reload) it shows the stored note.
  - One tab only: one URI opens one document; `open()` fires `onDidChange`, then
    shows the document in the editor group where its tab already is.
  - The tab stays open after resuming, so a long note stays at hand while working.

### The lock (two layers)

1. **UI.** `SidebarProvider.refresh()` sets the context key from
   `WorkPauseStore.isPaused()` (also at startup and after any external file
   change). `package.json` adds `!mindstream.workPaused` to the `when` of
   every title-bar button, every More item except the two Work Pause commands,
   the editor context item, the Command Palette entries, and the
   `Ctrl+Alt+M` keybinding. `mindstream.showSidebar` stays available so the
   note can be reached.
2. **Code.** Commands run through `guardWhenWorkPaused()` and do nothing
   while locked, so running one by id has no effect either. `importJson`
   checks the lock itself. Webview messages go through
   `isAllowedDuringWorkPause()` in both `SidebarProvider.handleMessage()` and
   `SidebarController.handleMessage()`: only `refresh`, `saveWorkPauseNote`,
   `confirmDiscardWorkPauseDraft`, and the card's buttons (`copyWorkPauseNote`,
   `openWorkPauseNoteInEditor`, `resumeWork`, `deleteWorkPauseNote`) are processed.

`importJson` never imports a paused state: `Replace` takes the file's note
(not paused) and `Merge` keeps the current note.

### Webview

- While locked, `postState()` sends only `{ workPause }`: nothing else is drawn.
  `body.work-pause-locked` also hides every other top-level element, and the
  webview ignores every message except `state` and the two Work Pause answers.
- `#work-pause` is the solid overlay (the sidebar background) with the card; it
  uses `--work-pause-*` variables (the accent is a fixed `#8189a9`).
- The card's drop shadow is a separate `.work-pause-shadow` element (a copy of
  the sheet shape), never a `filter` on `.work-pause-card`: a filter on the
  tilted card makes the note text blurry.
- **Text direction is automatic** and ignores `mindstream.ui.direction`.
  `WorkPause.directionFor()` returns `rtl` when the first non-empty line of the
  saved text contains an Arabic letter (digits and Arabic punctuation do not
  count), otherwise `ltr`. It sets `dir` on the note text and the editor only,
  and only while the note is shown: it changes when the note is saved, never
  while typing. The header, buttons, and date never flip.
- The edit button keeps its `data-tooltip`. Focus is not moved back to it after
  Save/Cancel, because `tooltip.js` shows the tooltip of any element that
  receives focus, even from a script.
- **View mode applies light formatting** through `WorkPause.renderNoteHtml()` (in
  `media/workPause.js`). The processed HTML is set via `innerHTML`; plain text
  would escape every character, so each line is escaped first. Three patterns
  are recognized at the start of a line only:
  - `[x]` / `[ ]` (with optional `- ` / `* ` prefix and leading whitespace): a
    display-only checkbox (`span.work-pause-check`) coloured with
    `--vscode-checkbox-*` tokens.
  - `# ` followed by text (one hash, a space, then the rest): a heading
    (`span.work-pause-h1`) — larger, bold, tinted with the theme link color.
    `##` is never treated as a heading.
  - `---` (exactly three dashes, nothing else on the line): a light dashed
    divider (`span.work-pause-divider`).
  - `` `code` `` inside any line (plain text, checkbox text, heading) becomes inline
    code (`code.work-pause-code`: editor font, the ink mixed into the paper for its
    background). It is applied after
    escaping, so the span content is escaped too; an unclosed pair stays literal and a
    span never crosses lines.
  - The heading and the divider are block elements that fill their own line, so no
    `\n` is emitted after them; inside `pre-wrap` that newline would render as an
    extra blank line. A blank line the user typed after them is kept.
  - A group is a run of consecutive checkbox lines. Its first line is wrapped in
    `span.work-pause-list-start` (a block with a 10px top margin) so the group is
    spaced from the line above; like the heading, it gets no trailing `\n`. The very
    first line of the note and a line right after a blank line are not wrapped.
- View mode shows the text and the header buttons (copy, open in editor, edit);
  while locked the footer also shows `Delete & resume` and `Resume work`. Edit
  mode hides them and shows a textarea with Cancel/Save; Save is disabled for
  blank text.
- **Preview while editing.** Edit mode replaces the view-mode header buttons
  with `#work-pause-edit-tools`: `Preview formatting` and `Formatting example`.
  The preview toggle (`aria-pressed`; its icon, label, and tooltip name what the
  next click does) swaps the textarea for `#work-pause-preview`, rendered by
  `WorkPause.previewHtml()`: the draft trimmed, then `renderNoteHtml()`, so it
  looks exactly as Save will show it (direction included), or an empty-state
  line for a blank draft. Nothing is saved or sent; the draft stays in the
  textarea, and Save and Cancel work from the preview. Every way into or out
  of edit mode turns the preview off.
- **Formatting example.** `#work-pause-example` is a page of its own over the
  whole sidebar (`position: fixed; inset: 0`, above the Work Pause overlay,
  below tooltips; `body.work-pause-locked` keeps it visible). It shows
  `WorkPause.EXAMPLE_NOTE` (a realistic note that uses every pattern) rendered
  by `renderNoteHtml()` on the note's paper, a `Show source` toggle to the raw
  text, and a legend. While it is open the editor underneath is `inert`. The
  close button and `Esc` (`handleWorkPauseEscape()`: the example first, then
  the editor's Cancel) return to the editor with the draft untouched; leaving
  edit mode closes it.
- **Hints in edit mode.** The placeholder lists the questions to answer (where
  you stopped, what is half-done, the next step, what not to forget). Under the
  textarea, `#work-pause-hint` (`WorkPause.editHint()`) says what Save does
  (opened by "Pause work": it locks; while paused: there is one note and saving
  replaces it) and the formatting the view understands.
- Cancel and `Esc` share one path (`requestWorkPauseCancel`): `WorkPause.cancelAction()`
  returns `leave` when the draft equals the saved text or is blank, otherwise `confirm`, which
  sends `confirmDiscardWorkPauseDraft`. The host asks with a modal
  `showWarningMessage` (`SidebarUi.confirmDiscardWorkPauseDraft`) and answers with
  `workPauseDiscardAnswer { discard }`.
- A `state` message that arrives while editing (an external file change) never
  replaces the draft (`WorkPause.shouldReplaceDraft`); the saved text and date are
  refreshed underneath.

### Messages

- `saveWorkPauseNote` (`text`, `pause?`, `base`) → `NotesService.saveWorkPauseNote`
  (allowed while paused), answered by `workPauseSaveResult { ok }`. The draft stays
  open until `ok`; a note changed elsewhere since editing started is refused
  (`CONFLICT`) and the draft is kept.
- `confirmDiscardWorkPauseDraft` → host confirmation, answered by `workPauseDiscardAnswer`.
- `copyWorkPauseNote`, `openWorkPauseNoteInEditor` → the stored text to the
  clipboard / the read-only tab (`SidebarUi.copyWorkPauseNote`, `openWorkPauseNoteInEditor`).
- `resumeWork` → `WorkPauseStore.resume()`.
- `deleteWorkPauseNote` (`base`) → `checkWorkPauseNoteDeletable`, then
  `SidebarUi.confirmDeleteWorkPauseNote`, then `NotesService.deleteWorkPauseNote`.
- Host → webview: `openWorkPauseEditor { note }`, `workPauseDiscardAnswer`, `workPauseSaveResult`, and `state.workPause`.

The discard question is a modal `showWarningMessage` ("Discard your unsaved changes to the note?").
The delete question is a modal with the detail that the note is deleted for good and can be
opened in the editor or copied first; its button is `Delete and Resume`.

## 11. Task groups

A note with at least one task is a **task group**: an ordered checklist under
its description, with a progress bar on its card and in the viewer. There is no
separate type or flag: the tasks themselves make the difference.

### Data

`MindStreamItem.tasks?: { title, completed }[]`. The order is the array index
(there is no `order` field), and the list lives inside the note, so archive,
delete, Markdown export, and JSON import/merge need nothing extra.

- The key is written only with at least one task; an empty list deletes it, so
  a regular note keeps its exact shape.
- `sanitizeTasks()` (`src/tasks.ts`) is the single cleaner: it keeps entries
  whose `title` is a string, trims it and folds line breaks into spaces (a title
  is one line), drops empty titles, caps it at `MAX_TASK_TITLE` (500), reads
  `completed` as true only when it is exactly `true`, and returns `undefined`
  when nothing is left. `normalizeData()` uses it, and `NotesService` (through
  `cleanTasks`) uses it after refusing a title over 500 characters.
- A note holds at most `MAX_TASKS` (200) tasks; a longer list is refused.

### Rules

- Progress is completed / total. Tasks may be completed in any order.
- Checking a task never changes the note's `status`; it does update
  `updatedAt` (so `Sort by date` moves the card up).
- The progress bar is shown on cards (including weekly-report cards) and in the
  viewer, never in the editor.

### Messages

| Message            | Fields                              | Handling                                                                                                   |
| ------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `addItem`          | `tasks` (raw)                       | stored through `sanitizeTasks()`; no key without tasks                                                     |
| `updateItem`       | `tasks` (raw)                       | a sent array replaces the list (empty after cleaning removes the key); no array leaves the tasks untouched |
| `setTaskCompleted` | `id`, `index`, `title`, `completed` | `ItemsStore.setTaskCompleted()`                                                                            |

`setTaskCompleted` carries the explicit value (not a toggle), so a repeated
message changes nothing more. It is ignored unless the task at `index` still
has that `title`, so a list changed meanwhile (an external file edit) is never
updated at the wrong position. Work Pause blocks it like every other mutation.

### Webview

- `media/taskList.js` (global `TaskList`, unit-tested): `isTaskGroup()`,
  `progress()` (`{ done, total, percent }`), `move()` (returns a new array), and
  `focusAvailable(count)` (true above `FOCUS_MIN_TASKS`, 5).
- `buildProgressBar()` (`media/sidebar/taskProgress.js`): a `role="progressbar"`
  row with a checklist icon, the bar (fill width from the `--task-progress`
  custom property), and a `done/total` label. It turns green when complete.
- **Viewer**: `#view-tasks` sits under the description. Clicking anywhere in
  a task row toggles its checkbox (rows are not text-selectable and show a
  pointer cursor). Each toggle updates the row and the bar at once, then posts
  `setTaskCompleted`. Each
  `state` message calls `refreshView()`, which re-reads the note (closing the
  viewer if it was deleted). Rows are rebuilt only when the titles or the
  archived state change; otherwise they are updated in place, so the focused
  checkbox keeps its focus (moving focus by script would show its tooltip).
  For an archived note the list is read-only: checks are disabled, rows do not
  toggle, and `ItemsStore.setTaskCompleted()` refuses the write as well.
- **Editor**: `#f-tasks` holds the form's own copy of the list
  (`setFormTasks()` / `getFormTasks()` in `taskEditor.js`). Each row is:
  the sequence number (a `<button class="task-seq">` that is also the drag
  handle, with a grab cursor), a one-line `<input>` (a title is never
  multi-line while editing), the completed checkbox, and a remove button. Enter
  adds a task below; Backspace in an empty title removes it; Alt+Up/Down (on the
  title or the sequence button) reorders it; Ctrl+Up/Down (Cmd on macOS) moves
  focus to the previous/next title without reordering. An info button
  (`#f-tasks-info`, a `codicon-info` icon) sits beside the "Tasks (optional)"
  label and, only with more than one task, lists every shortcut in its
  `data-tooltip`. Dragging uses pointer events with
  pointer capture on the sequence button, never HTML5 drag-and-drop (VS Code
  webviews intercept drags for file drops). The dragged row never leaves the
  DOM; its neighbours move around it, so the capture is never lost. The
  sequence button has no `data-tooltip`, because focus returns to it by script
  after a keyboard move. The list scrolls on its own (`max-height`), so Save
  stays on screen. Save always sends the full list.
- **Row height**: an editor row is exactly 34px (title input and remove button
  26px). With the list's 2px gap the row pitch is 36px, a whole number of
  device pixels at 125%-200% display scaling, so rows and gaps look identical.
  Content-sized rows (a 33.2px row at 125%) snap to 41 or 42 device pixels
  unevenly.
- **Narrow rows**: each editor row is an inline-size container; when its width
  is under 230px the checkbox is hidden (the completed state is kept). The
  viewer is unaffected, and its titles wrap.
- **Focus mode**: `#f-tasks-focus` (an icon toggle beside "+ Add task", shown
  only while `TaskList.focusAvailable(count)`, i.e. more than 5 tasks) folds the
  description (`#f-desc-field`) away through the `tasks-focus` class on the
  card, and sets the list's `max-height` to the viewport room that leaves.
  `taskEditor.js` measures the card's chrome once (everything but the
  description and the list) when the mode turns on, then sets `--focus-max`
  (the list's own max-height) to the modal height minus that chrome and
  re-measures it on resize. It is manual, never saved, and off in every newly
  opened editor. When the list drops to 5 tasks or fewer the button hides and
  the mode ends. While it is on, the description height observer saves nothing
  (a folded field measures 0), and an emoji picker anchored to the description
  closes.

## 12. Description in an editor tab

A long description is edited in a normal VS Code editor tab instead of the
narrow textarea. The note form stays the only owner of the text: the tab is a
second way to edit it, and nothing reaches the data file until the form's own
Save.

### Where the state lives

- `DescriptionDraft` (`src/descriptionDraft.ts`, no `vscode`) holds at most one
  draft, started by `open(title, text)`. It keeps two texts: `saved` (the
  virtual file's content, changed only when the tab is saved, so VS Code never
  sees the file change under a dirty editor) and `live` (what the form uses,
  updated on every edit, line breaks normalized to LF). Every draft gets a new
  path, `/<id>/<note title>.md` (`draftFileName()` makes the title safe, falls
  back to `Note description`, caps it at 60 characters).
- `DescriptionEditor` (`src/descriptionEditor.ts`) is the `vscode` layer: a
  `FileSystemProvider` for the `mindstream-desc` scheme (one file, every other
  operation refused), plus the tab handling. A virtual file is used so Ctrl+S
  saves without a Save As dialog. The files are Markdown, which VS Code wraps by
  default. It exposes `onDidChangeText` (every edit or save) and
  `onDidCloseByUser` (the final text when the user closes the tab). It reads
  `mindstream.descriptionTab.onClose` through an injected function.
- `DescriptionDraft.finalText(keepEdits)` is the text handed back on a user
  close: every edit (`live`) when `keepEdits`, otherwise only what the tab saved.
- `noteFormSettings.ts` (no `vscode`) holds the two setting types and their
  normalizers: an unknown `descriptionTab.onClose` means `keep`, an unknown
  `noteForm.onCloseWithChanges` means `ask`, so a bad value never loses text.
- `SidebarProvider` receives the `DescriptionEditor` through its constructor,
  forwards both events to the webview, and implements
  `SidebarUi.openDescriptionEditor` / `closeDescriptionEditor`.

### Settings

| Setting                                  | Values             | Default | Effect                                                                                                                                                                |
| ---------------------------------------- | ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mindstream.descriptionTab.onClose`      | `keep` \| `ask`    | `keep`  | `keep`: the tab saves itself 150 ms after every edit (so it is never "modified" and VS Code never asks); `ask`: VS Code's Save / Don't Save / Cancel question appears |
| `mindstream.noteForm.onCloseWithChanges` | `ask` \| `discard` | `ask`   | `ask`: closing the form (Cancel, X, Esc) after any field changed asks Save / Discard / Cancel; `discard`: closes at once                                              |

Neither setting writes the data file: the tab only updates the form, and the
form's own Save stores the note. The second setting reaches the webview as
`state.noteFormCloseBehavior` (`state` message field `noteFormCloseBehavior`).

### Behavior

| Situation                                                  | Result                                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Click `#f-desc-external`                                   | the tab opens with the form's description; the button stays active (blue icon) and further clicks only reveal the tab                    |
| Edit in the tab                                            | the form's textarea follows at once                                                                                                      |
| Ctrl+S in the tab                                          | updates the form only (the data file is not written); with `ask` it shows a status bar message                                           |
| Description field while the tab is open                    | read-only and mirrored from the tab; the button stays active and an "Editor tab..." hint ripples beside it; no emoji is inserted into it |
| Form closed after a save succeeded, or another note opened | the tab closes without a Save prompt                                                                                                     |
| Cancel, X or Esc with no field changed                     | the form closes at once                                                                                                                  |
| Cancel, X or Esc with a changed field (`ask`)              | a modal asks Save / Discard / Cancel before anything closes (see "Closing the form" below)                                               |
| Cancel, X or Esc with a changed field (`discard`)          | the form and the tab close at once; the changes are lost                                                                                 |
| Save refused (storage problem, work paused)                | the form and the tab stay open, nothing is lost                                                                                          |
| The user closes the tab (`keep`)                           | the textarea is editable again with the latest text, with no question                                                                    |
| The user closes the tab with unsaved edits (`ask`)         | VS Code asks; Save and Don't Save both end the draft, Don't Save returns only the text saved in the tab                                  |
| Work is paused                                             | the tab closes (`SidebarProvider.syncWorkPauseContext()`); the open message is refused like any write                                    |
| Sidebar page rebuilt, or window reloaded                   | leftover `mindstream-desc` tabs are closed (`resolveWebviewView()` and the `DescriptionEditor` constructor)                              |

### Messages

- Webview → host: `openDescriptionEditor` (`title`, `description`),
  `closeDescriptionEditor`, and `confirmCloseNoteForm`. All are blocked while
  work is paused.
- `confirmCloseNoteForm` only asks: `SidebarUi.confirmCloseNoteForm()` shows a
  modal `showWarningMessage` ("Save your changes to the note?", Save / Discard,
  Esc = cancel) and `answerCloseNoteForm()` replies `noteCloseAnswer { choice }`
  with `save`, `discard`, or `cancel`. The host never reads or writes a note here.
- Host → webview: `descriptionEditorOpened` (`text`: the draft's text, which may
  be newer than the form's when the tab was already open),
  `descriptionEditorText` (`text`), `descriptionEditorClosed` (`text`), and
  `noteCloseAnswer` (`choice`).

### Closing the form

`noteEditor.js` takes `NoteForm.snapshot()` of the title, description, type,
category, priority (only while the priority system is on), and the task list
when the form opens (`rememberInitialForm()`). X (`#modal-close`), Cancel
(`#modal-cancel`), and Esc all call `requestCloseModal()`, which compares the
current fields with that snapshot through `NoteForm.closeAction()`:

- `close`: nothing changed, or the setting is `discard`: `closeModal()` runs.
- `confirm`: the form posts `confirmCloseNoteForm` and stays open
  (`closeConfirming` blocks a second question). The answer `save` runs the
  form's own `saveModal()`, so the form closes only once the host confirms the
  note was stored and a refused save keeps everything; `discard` runs
  `closeModal()`; `cancel` keeps the form.

### Opening a new note while a form is open

`mindstream.addNote` (Ctrl+Alt+M) and `mindstream.addNoteToLine` are async: both
go through `SidebarProvider.revealView()` (runs `workbench.view.extension.mindstream`
and waits, bounded, for a never-opened view), so the sidebar always shows. The
host posts `openAddNote`, and the webview calls `requestOpenAdd(link)` instead
of `openAdd()` directly:

- Form hidden, or unchanged (`NoteForm.closeAction()` is `close`): the new form
  opens at once (an open description tab ends with the old form).
- Changed and the setting is `ask`: the same Save / Discard / Cancel question as
  closing (`confirmCloseNoteForm`). `save` opens the new form only after the host
  confirms the note was stored (`openAfterSave`); `discard` opens it; `cancel`
  keeps the current form and its text.
- A Save in flight or an open question ignores the request.

The code link of the request is held by the controller (`offerLink()`) and
becomes the pending link only when the webview sends `newNoteFormOpened`
(`linked: true` for a code link), so a cancelled request never changes the link
of the form that stays open.

The comparison ignores what Save drops anyway (title padding, tasks with a blank
title) and treats CRLF and LF as the same, because the description tab may use
CRLF. The text typed in the description tab counts as a change because it flows
into `#f-desc` while the tab is open.

### Webview

`noteEditor.js` keeps `descExternal`. `setDescExternal()` toggles the textarea's
`readOnly`, the `#f-desc-external-hint` note (`Editor tab...`), and the button's
`active` class / `aria-pressed`. `openAdd()`, `openEdit()`, and `closeModal()`
end the draft first. A `descriptionEditorOpened` answer that arrives after the
form closed sends `closeDescriptionEditor`, so no tab is left without an owner.
Focus mode hides the whole description field, button included.

## 13. MCP server (`src/mcp/`)

An AI agent reads and writes the notes through the Model Context Protocol. The server
runs inside the extension host, in every window that has a workspace folder, with no
user action (activation is `onStartupFinished`). It adds no write rule of its own: every
write is a call to `NotesService`, every read a call to `NotesQuery`.

### Architecture and the dependency rule

```
mcpController (vscode) -> mcpHttpServer -> mcpServerCore (SDK) -> mcpRouter -> tools/prompts -> NotesService / NotesQuery
                       |-> innerServer ------------------------------------------------------> tools
                       |-> routerRegistry, portHolder                mcpRouter -> routerRegistry, workspaceMatch
                       `-> clientConfigs, mcpConnectFlow (pure)      mcpHttpServer, innerServer -> httpGuard
```

- Only `mcpServerCore.ts` imports `@modelcontextprotocol/*` (SDK v2, bundled by esbuild
  as CJS). Only `mcpController.ts` imports `vscode`. `test/mcpImports.test.ts` enforces
  both, and that the tool layer imports no transport.
- The SDK is `@modelcontextprotocol/server` and `/node` (dependencies) and `/client`
  (a devDependency, tests only). The server is stateless: a server instance per request
  (`createMcpHandler`), no session store. A client of the 2025 protocol is served too.

### One endpoint for every workspace

A client keeps one global entry (`http://127.0.0.1:18741/mcp`, one token) while every
window serves its own folder.

- **Inner server** (`innerServer.ts`): every window listens on `127.0.0.1` on a port the
  system picks and serves `POST /call` for its own workspace only. It is the only writer
  of its data file.
- **Registry** (`routerRegistry.ts`): every window writes `window-<pid>.json` (protocol,
  folder, inner port, pid, start time; never the token) into `globalStorageUri/router`,
  atomically, and deletes it on deactivate. Dead, corrupt, and duplicate entries are
  ignored (the newest live entry of a folder wins).
- **Fixed port** (`portHolder.ts`): every window tries to listen on `mindstream.mcp.port`
  (default 18741, machine scope). The operating system lets one succeed: that window is
  the router. The others retry every 3 s, so one takes over within seconds after the
  router closes. A port held by a program that is not MindStream is `blocked`.
- **Routing** (`mcpRouter.ts`): every tool takes a required `workspace` (the absolute
  path of the agent's project root). The router picks the registered folder that is the
  longest prefix of it on a separator boundary (`workspaceMatch.ts`; case-insensitive on
  Windows only). Its own folder runs locally; another window's is forwarded to that
  window's inner server (a new connection per call, 10 s limit); no match is
  `WORKSPACE_NOT_OPEN` with the open folders. Only a refused connection (`ECONNREFUSED`)
  proves that nothing ran: that entry is dropped and answered as not open. Any other
  failure (a reset, a timeout, a non-200 answer) is `WORKSPACE_NOT_RESPONDING`, keeps the
  entry, and is never retried: it is the one refusal that cannot promise "Nothing was
  changed". Calls are not pooled because a reset of an idle pooled socket cannot be told
  apart from a reset after the call ran.
  A protocol version mismatch is `WORKSPACE_NOT_RESPONDING` with "reload the windows".
  The router never reads or writes another workspace's data file. Every success carries
  `workspace` (the matched folder) in its data.

### Security (`httpGuard.ts`)

Every listener (public and inner) checks, in order: the peer is loopback; no `Origin`
header (a browser always sends one, an agent never does); the `Host` header names this
server (`127.0.0.1:<port>` or `localhost:<port>`, against DNS rebinding); the bearer
token, compared in constant time. A server with an empty token refuses everything. A
refusal is logged as status and reason only, never the token or the body.

The holder check (`GET /mindstream-health?nonce=<32 hex>`) never carries the token,
because whatever holds the port may be another program. It passes the peer checks
(`checkPeer`: loopback, no `Origin`, `Host`) but not the token check. The holder answers
`{ protocol, proof }`, where `proof = holderProof(token, nonce)` (HMAC-SHA256 keyed by the
token). The prober (`probePortHolder`) sends a fresh random nonce and calls the holder
MindStream only when `verifyHolderProof` succeeds; with no token it sends nothing. A
holder with no token yet answers 503.

### Token and port

One token per user in `SecretStorage` (key `mindstream.mcp.token`): 32 random bytes,
base64url. Only the window that holds the port creates it, and only while it is empty;
the others re-read it every 500 ms and on `secrets.onDidChange`. "Regenerate MCP token"
stores a new one after a confirmation, then confirms with a "Connect an AI agent" button
that runs the connect command. The token is never in a setting, a project file, the
registry, a log line, or a message. `SecretStorage` keeps secrets on the client, so every
window (local, WSL, SSH) reads the same token: one regenerate changes it in all of them,
and both texts say that every agent entry, WSL and SSH included, must be copied again.
Each machine still has its own registry and port.

A request refused with a well-formed bearer token (43 base64url characters) that is not
the current one sets `wrongToken` on the guard result; the public server calls
`onWrongToken`, and the controller warns once per session that an agent uses an old
token, with the same button. A missing or malformed header never warns. The warning is
skipped for the rest of the session after "Regenerate MCP token", whose confirmation
already says it.

### Tools, prompts, and the rules snippet

- 12 tools (`tools.ts`: `MCP_TOOLS`): five read (`project_summary`, `list_notes`,
  `get_note`, `list_types_and_categories`, `get_work_pause_note`) and seven write
  (`add_note`, `update_note`, `set_note_status`, `set_task_completed`,
  `set_note_archived`, `add_category`, `add_type`). Every input schema is plain JSON
  Schema (`toolKit.ts`) with a required `workspace`; an argument the tool does not take
  is refused, and so is an unknown tool name. No tool deletes, pauses or resumes work,
  writes the Work Pause note, edits a code link, imports, exports, or changes settings.
- The Work Pause note is the user's own note for a long absence (section 10).
  `WORK_PAUSE_NOTE_RULE` says so in `get_work_pause_note`, the rules snippet, and the
  server instructions: an agent reads it only when the user asks, it is not a record of
  agent sessions, and no tool writes it. No tool, prompt, or rule tells an agent to read
  it at the start of a session or to write it at the end.
- Statuses follow the user (`STATUS_RULE`, in `set_note_status`, the prompts
  `continue_work` and `review_stale_links`, the rules snippet, and the server
  instructions): when the user asks to carry out a note, in any words, the agent moves
  it from pending to in-progress before changing anything for it, one note at a time as
  it starts each; reading, explaining, evaluating, or planning a note leaves its status
  as it is; a note that is not pending is not moved; a done note is never changed
  unless the user asks; an agent never marks a note
  done or canceled on its own, but asks when the work seems finished and leaves it
  in-progress otherwise; asked whether everything is finished, it lists the notes still
  in progress.
- `USER_FIRST_RULE` (rules snippet and server instructions): these are defaults, and the
  user's own instructions and rules always take precedence. `WRITE_RULE` (every write
  tool) and the prompts tell the agent never to ask the user to resume work so that it
  can write.
- A refusal is a result, not an exception (`toolErrors.ts`): `{ ok: false, code, message,
current? }`, sent to the client as `isError` with that object as the JSON of its text.
  `current` is the note as it is now (`CONFLICT`) or the existing entry (`DUPLICATE`).
  Anything that is not a refusal is a bug and is rethrown.
- Every result (`toCallToolResult`) is one text block: the sentence (the summary, or the
  refusal message), `RESULT_JSON_SEPARATOR` (a blank line), then the data as JSON. There
  is no `structuredContent` and no `outputSchema`: clients differ in what they give the
  model (VS Code and Claude Code give only `structuredContent` when it is present, so
  the sentence is lost; Cline gives both, so the data arrives twice), while every client
  gives it the text. This text shape is a contract for any caller that parses it.
- The task list is optional: `TASKS_RULE` says an empty list says nothing about the work,
  in the descriptions of `get_note`, `add_note`, and `update_note`, the prompts
  `continue_work` and `review_stale_links`, the rules snippet, and the server instructions.
  `get_note`'s summary ends with `tasksLine()`: the done count, or, with no tasks, that any
  plan is in the description (with its length).
- The server sends `SERVER_INSTRUCTIONS` (`agentRules.ts`) as the MCP `instructions` on
  connect: the user's instructions first, `workspace`, optional tasks, the status rule,
  `WORK_PAUSED`, the Work Pause note rule, and that note text is data.
- Reads (`notesQuery.ts`, `noteView.ts`) never refuse while work is paused or saving is
  off. `get_note` re-finds the code link first, then returns an excerpt of the linked
  code (capped). Note text is data, not instructions: the read tools, the prompts, and
  the rules snippet say so.
- Three prompts (`prompts.ts`) and the rules snippet (`agentRules.ts`).

### Extension integration and setup

`McpController` starts in `activate()`, shows a status bar item only while another
program holds the port (`$(warning) MCP`, hidden otherwise; the connect command is in
the More menu), registers the server with Copilot
(`mcpServerDefinitionProviders`, `registerMcpServerDefinitionProvider`; the URL goes
through `asExternalUri`, the headers carry the literal token), and stops in
`deactivate()`. Its decisions are in `mcpControllerLogic.ts`.

Commands: "Connect an AI agent (MCP)" (a QuickPick of clients; copies that client's
configuration text and says where to paste it; never writes a file; not locked by Work
Pause), "Copy agent rules for MCP", "Regenerate MCP token". The configuration is one global
entry, never a project-scoped file, because such a file can be committed with the token.

### Tests

- `test/`: the guard, path matching, the registry, the tools (every refusal leaves the
  data and the save count unchanged), the router with three windows in one process, the
  inner server, the public endpoint with the official v2 client and with raw 2025-era
  requests, port takeover, the client texts, the connect flow, the prompts, the import
  rule. `test/mcpWindow.ts` and `test/mcpEndpoint.ts` build simulated windows.
- `e2e/mcp*.spec.ts`: a real window with an agent connected through what the connect
  command copied. Two real windows cannot share one user-data folder, so routing between
  windows is covered in `test/` and checked by hand.
