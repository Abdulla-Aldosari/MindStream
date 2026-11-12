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
                         status enum, constants.
  storage.ts              StorageService (IStorage impl): loads/saves the JSON file
                         safely (write to .tmp then rename), default data creation,
                         normalizeData() for legacy/incomplete data,
                         reloadIfExternal() to pick up out-of-process changes.
  workspaceStorage.ts     Thin helper: binds a StorageService to the open workspace
                         folder (.vscode/mindstream.data.json at the project root).
  itemsStore.ts           ItemsStore: CRUD for notes, status history (append-only),
                         archiving independent of status, permanent deletion, and host-side code link
                         tracking (setLink, mapLinks with persist false, save).
  typesRegistry.ts        TypesRegistry: manage user-defined note types (add/rename/
                         setIcon/remove/reassign), items reference typeId not label.
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
                         and re-checks them against file contents (injected LinkFiles).
  saveScheduler.ts        SaveScheduler: coalesces bursts into one delayed write (trailing delay
                         plus a maximum wait, flush/cancel, injectable clock).
  linkIntegration.ts      vscode wiring for links: the link of the cursor line/selection,
                         and the document/rename/delete/window-focus listeners.
  uiPrefs.ts              UiPrefsRegistry: global (per-user, all workspaces) UI
                         preferences (the note-editor description height) behind
                         a UiPrefsMemento adapter over context.globalState.
  workPause.ts             Pure Work Pause rules: normalizeWorkPauseNote(), the
                         context key name, the messages allowed while locked,
                         and guardWhenWorkPaused(). See §10.
  workPauseStore.ts        WorkPauseStore: reads/writes the single Work Pause note
                         (data key workPauseNote) through IStorage. See §10.
  sidebarController.ts    SidebarController: sidebar message-handling logic, extracted
                         from the provider so it is unit-testable without vscode.
                         Mutates data and asks for confirmations via SidebarUi
                         (confirm dialogs and a type QuickPick via pickType). Holds the pending code
                         link set by the host (setPendingLink); addItem attaches it only when the
                         webview sends linked true, and updateItem never touches a link.
  sidebarProvider.ts      SidebarProvider (WebviewViewProvider): renders the sidebar
                         webview, posts state to the UI, updates the activity-bar
                         badge, implements SidebarUi for confirm dialogs and the
                         default-type QuickPick, and writes clipboard text for
                         copyToClipboard messages. Also opens the note form for a code link
                         (openAddNoteForLink), opens a linked file at its line (openLink),
                         skips posting while hidden, and waits for the view when first used.
  commands.ts             Command handlers (export/import Markdown/JSON, weekly report,
                         requireWorkspace) with an injected CommandsDeps I/O surface.
                         importJson does nothing while the Work Pause lock is on.
  export.ts               Pure functions: buildMarkdownExport(), buildWeeklyReportText(),
                         mergeData() (merge imported JSON into current data by id).
  report.ts                buildWeeklyReport(): computes weekly created/completed/
                         in-progress/archived counts and lists.
  util.ts                  newId() (crypto.randomUUID), nowIso(), debounce().

media/
  sidebar.js / *.css     Webview UI: custom select/dropdown system
                         (renderCustomSelect/bindCustomSelect — see rule:
                         no native <select>), a reusable action menu
                         (renderActionMenu/bindActionMenu), modals, note
                         cards, and the viewer options menu (Copy ID /
                         Copy content, sent to the host as copyToClipboard).
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
  workPause.js             WorkPause: view/edit/cancel rules of the Work Pause note
                          (pure, no DOM, loaded as a global before sidebar.js).
                          See §10.



test/
  helpers.ts              InMemoryStorage: IStorage fake used across unit tests.
  *.test.ts                Mocha + ts-node unit tests per module (no vscode
                         dependency in the tested modules themselves).
```

### Data flow (high level)

1. `activate()` builds a `StorageService` bound to the open workspace folder.
2. `ItemsStore` / `TypesRegistry` / `CategoriesRegistry` are constructed with
   that single `StorageService` (implementing `IStorage`), so all three
   share the same in-memory `MindStreamData` and persist to the same
   `.vscode/mindstream.data.json`.
3. `SidebarProvider` is constructed with those three registries and renders
   the webview; it receives messages from `media/sidebar.js` via
   `webview.onDidReceiveMessage`, delegates data mutations to
   `SidebarController` (which asks for confirmations through `SidebarUi`),
   then calls `postState()` to push the updated state back to the webview.
4. Commands registered in `extension.ts` (Command Palette / view-title menu)
   call the `commands.ts` handlers (with an injected `CommandsDeps`), which
   in turn call into the registries/`SidebarProvider` methods or the
   `export.ts` / `report.ts` pure functions for Markdown/JSON/weekly-report
   export and JSON import.
5. `extension.ts`'s `watchDataFile()` registers a `vscode.FileSystemWatcher`
   on `.vscode/mindstream.data.json` inside the open workspace folder. Every
   `onDidChange`/`onDidCreate` event goes through a `debounce()`-wrapped
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

### Key conventions to keep in mind

- **Stable ids, not labels.** Items reference `typeId` / `categoryId`;
  renaming a type/category never breaks existing items.
- **No native `<select>` in the webview.** Always use
  `renderCustomSelect()` / `bindCustomSelect()` from `media/sidebar.js` for a
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

- **Category default types.** A category may carry an optional
  `defaultTypeId`. When the "New note" form opens (or the category changes
  there), `media/sidebar.js` pre-selects that type via
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

All dropdowns use `renderCustomSelect()` + `bindCustomSelect()` from `media/sidebar.js`.

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

`media/tooltip.js` is loaded as a global `<script>` before `media/sidebar.js`
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
`media/sidebar.js` for the applied pattern (tooltip set on `#{btnId}` right
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
consistent with the rest of the interactive code in `media/sidebar.js`.

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

`media/sidebar.js`'s `renderCategories()`/`renderTypes()` and
`startRenameCategory()`/`startRenameType()` assign these shared class names
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

- Shortcuts in the note editor's title (`#f-title`) and description
  (`#f-desc`) fields:
  - `Ctrl+Shift+/` (`Cmd+Shift+/` on macOS) opens the emoji picker.
  - `Ctrl+/` (`Cmd+/` on macOS) inserts the most-recent emoji directly (no popup).
- `media/sidebar.js` matches these via a `keydown` listener using
  `e.code === "Slash"` (layout-independent) with a Ctrl/Cmd modifier, then
  inserts at the caret (`selectionStart`/`setSelectionRange`) and records the
  use.
- A compact `#emoji-hint` hint in the editor's action bar (`.emoji-hint`)
  reads `💡 Ctrl+Shift+/ inserts an emoji` (⌘⇧/ on macOS). Clicking it opens the picker
  anchored to the last focused title/description field.
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

Two side-effect-free helpers (loaded as globals before `sidebar.js`, and
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

- `postState()` includes `descriptionHeight`; `media/sidebar.js` stores it in
  `state.descriptionHeight`.
- When the note editor opens (`openAdd`/`openEdit`), `applyDescHeight()` sets a
  `--desc-height` CSS custom property consumed by `#f-desc { height:
var(--desc-height, 128px); }`. It clamps the persisted height so the
  `.modal-card` never overflows the current viewport: it measures the card with
  the textarea collapsed to its minimum, then caps the height at
  `viewport - gutter - cardAtMin`. A tall height saved while the sidebar was
  large is therefore shown clipped (not persisted smaller) when reopened small.
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

### Save rules (`SidebarController`)

`SidebarController` receives a `priorityEnabled()` callback (the live setting).

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

- `groupBy`: `none | status | priority`. Status groups are always three;
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
- The link stays in the host: `SidebarProvider.openAddNoteForLink()` stores it as
  the controller's pending link and posts it to the webview for display only.
  The webview sends `addItem` with `linked: true`, and the controller attaches
  the pending link. A link sent by the webview is never read, and
  `updateItem` / `UpdateItemInput` have no link, so it cannot be edited, added,
  or removed from the note editor.
- The note editor, the viewer, and cards show a read-only badge
  (`path:line`); clicking it sends `openLink`, which re-resolves the link then
  opens the file at the line.

### Keeping the link correct

| Event                                                       | Handling                                                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Lines added/removed above the range                         | `onDidChangeTextDocument` shifts `lineStart` and `lineEnd` (`shiftLinkForEdits`)                                                         |
| Lines added/removed inside the range (after its first line) | only `lineEnd` moves; edits on the first line or crossing the end are left to `resolveLink`                                              |
| Change outside the editor (git, terminal)                   | `refreshAll()` on startup and window focus, and `resolveItem()` on open, re-find the code from `anchor`                                  |
| Same code at another line                                   | link moves there (best before/after context, then nearest)                                                                               |
| Range grew or shrank outside the editor                     | a range longer than 5 lines also stores its tail (`anchor.endText`); `resolveLink` re-finds head and tail together and updates `lineEnd` |
| Code edited or removed                                      | state `changed`: position kept, badge warns, nothing is guessed                                                                          |
| File renamed or moved (file or folder)                      | `onDidRenameFiles` rewrites `filePath`                                                                                                   |
| File deleted, or moved out of the workspace                 | state `missing`: badge is struck through, the note is kept                                                                               |
| File restored, or code back                                 | next re-check returns the state to `ok`                                                                                                  |

Live shifts are cheap: `applyEdits()` returns at once for edits that keep the line
count, changes memory only (`mapLinks(fn, false)`), and `flush()` writes them. A
`SaveScheduler` (3 s quiet, 20 s maximum wait) triggers the write, and it is also
flushed on file save, window blur, and shutdown. A lost shift is harmless: the
next `refreshAll()`/`resolveItem()` re-finds the code. While the sidebar is hidden
`postState()` is skipped, and the state is posted when it becomes visible again.

### Showing the path

The badge always keeps the file name visible. `fitLinkRow()` (in `sidebar.js`)
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

A hand-off note written before stepping away for a long time ("where I stopped,
what is next"). It is not a regular note: while work is **paused** the whole UI is
locked and the sidebar shows nothing but this note.

### Data

`MindStreamData.workPauseNote?: { text, updatedAt, paused }` is the last key of
`.vscode/mindstream.data.json`. It is absent until the first save and is never
added by `normalizeData()`; it is not part of `items`, so it never appears in a
note list, filter, or Markdown export.

- `text` is trimmed and capped at `MAX_WORK_PAUSE_TEXT` (10000 characters).
  `updatedAt` only moves when the text changes; the note shows it as
  `Updated: <date>` at the bottom.
- `normalizeWorkPauseNote()` drops a value that is not a plain object and falls
  back to empty values for wrong field types. Work is never paused without
  text, so a hand-edited file cannot lock the user in with an empty note.
- `WorkPauseStore` (`src/workPauseStore.ts`) is the only writer: `save(text,
pause?)`, `pause()` (refuses without text), `resume()` (keeps the text),
  `isPaused()`. It uses `IStorage`, so it follows the same external-change reload
  as the notes.

### Turning it on and off

Only the More menu (`...` in the view title) changes the lock:

| State | More shows                                               | Command                       |
| ----- | -------------------------------------------------------- | ----------------------------- |
| off   | `Pause work and show note` (and the export/import items) | `mindstream.workPause.pause`  |
| on    | `✓ Work paused - click to resume` only                   | `mindstream.workPause.resume` |

VS Code has no checked state for a contributed command, so the pair of commands
with opposite `when` clauses on the context key `mindstream.workPaused`
provides the check mark. The titles state the action and the way out in plain
words. `pause` ("Pause work and show note") with a saved note locks at once; with
no note it opens the editor first (`openWorkPauseEditor`), and the lock turns on
only when the user saves text (`saveWorkPauseNote` with `pause: true`).

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
   `SidebarController.handleMessage()`: only `refresh`, `saveWorkPauseNote`, and
   `confirmDiscardWorkPauseDraft` are processed.

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
- View mode shows the text and an edit button. Edit mode shows a textarea with
  Cancel/Save; Save is disabled for blank text.
- Cancel and `Esc` share one path (`requestWorkPauseCancel`): `WorkPause.cancelAction()`
  returns `leave` when the draft equals the saved text, otherwise `confirm`, which
  sends `confirmDiscardWorkPauseDraft`. The host asks with a modal
  `showWarningMessage` (`SidebarUi.confirmDiscardWorkPauseDraft`) and answers with
  `workPauseDiscardAnswer { discard }`.
- A `state` message that arrives while editing (an external file change) never
  replaces the draft (`WorkPause.shouldReplaceDraft`); the saved text and date are
  refreshed underneath.

### Messages

- `saveWorkPauseNote` (`text`, `pause?`) → `WorkPauseStore.save`.
- `confirmDiscardWorkPauseDraft` → host confirmation, answered by `workPauseDiscardAnswer`.
- Host → webview: `openWorkPauseEditor`, `workPauseDiscardAnswer`, and `state.workPause`.

The discard question is a modal `showWarningMessage` ("Discard your unsaved changes to the note?").
