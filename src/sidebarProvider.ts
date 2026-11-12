import * as vscode from "vscode";
import { MindStreamLink, MindStreamStatus } from "./models";
import { LinkTracker } from "./linkTracker";
import { ItemsStore } from "./itemsStore";
import { TypesRegistry } from "./typesRegistry";
import { CategoriesRegistry } from "./categoriesRegistry";
import { EmojiRegistry } from "./emojiRegistry";
import { UiPrefsRegistry } from "./uiPrefs";
import { WeeklyReportData } from "./report";
import { SidebarController, SidebarUi, WebviewMessage } from "./sidebarController";
import { getBodyClass } from "./util";
import { DEFAULT_PRIORITY, normalizePriorityStyle, PRIORITIES, PRIORITY_LABEL, PriorityStyle, priorityFeatures } from "./priority";
import { WorkPauseStore } from "./workPauseStore";
import { WORK_PAUSE_CONTEXT_KEY, isAllowedDuringWorkPause } from "./workPause";

export const VIEW_TYPE = "mindstream.sidebar";

/** Upper bound for waiting on a never-opened panel before giving up on "Add note to this line". */
const VIEW_READY_TIMEOUT_MS = 5000;

const STATUS_LABEL: Record<MindStreamStatus, string> = {
  pending: "None",
  "in-progress": "In Progress",
  done: "Done",
};

/**
 * Sidebar view provider (WebviewView).
 * Renders note cards with full flexibility in the sidebar using custom HTML/CSS.
 */
export class SidebarProvider implements vscode.WebviewViewProvider, SidebarUi {
  private _view?: vscode.WebviewView;
  private _archiveVisible = false;

  private readonly controller: SidebarController;
  private resolveViewReady: (() => void) | undefined;
  private readonly viewReady = new Promise<void>((resolve) => {
    this.resolveViewReady = resolve;
  });

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly items: ItemsStore,
    private readonly types: TypesRegistry,
    private readonly categories: CategoriesRegistry,
    private readonly emoji: EmojiRegistry,
    private readonly uiPrefs: UiPrefsRegistry,
    private readonly workPause: WorkPauseStore,
    private readonly links: LinkTracker,
    private readonly isDevMode: boolean = false
  ) {
    this.controller = new SidebarController(items, types, categories, this.emoji, this.uiPrefs, this.workPause, this, () => this.getPriorityStyle() !== "off");
  }

  resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => this.handleMessage(msg));
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
      }
    });
    this.updateBadge();
    this.postState();
    this.resolveViewReady?.();
  }

  refresh(): void {
    this.syncWorkPauseContext();
    this.updateBadge();
    this.postState();
  }

  /**
   * Publishes the Work Pause lock as a VS Code context key, which the
   * `when` clauses in package.json use to hide the title-bar buttons and the
   * More items. Runs on every refresh, so changes made outside this window
   * (a file edit, git) are picked up too.
   */
  private syncWorkPauseContext(): void {
    void vscode.commands.executeCommand("setContext", WORK_PAUSE_CONTEXT_KEY, this.workPause.isPaused());
  }

  /**
   * "Pause work and show note" in the More menu. With a saved note it locks at
   * once; with none it first opens the editor, and the lock only turns on once a
   * note is saved.
   */
  pauseWork(): void {
    if (this.workPause.get().text.trim()) {
      this.workPause.pause();
      this.refresh();
      return;
    }
    void this._view?.webview.postMessage({ type: "openWorkPauseEditor" });
  }

  /** "✓ Work paused - click to resume" in the More menu: the only way out of the lock. */
  resumeWork(): void {
    this.workPause.resume();
    this.refresh();
  }

  /** Tells the webview to open the note editor modal. */
  openAddNote(): void {
    this.controller.setPendingLink(undefined);
    this._view?.webview.postMessage({ type: "openAddNote" });
  }

  /**
   * Opens the note editor for a note that will be linked to a code location.
   * The link stays in the host; the webview only receives what it must display.
   */
  async openAddNoteForLink(link: MindStreamLink): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.extension.mindstream");
    if (!this._view) {
      // The panel was never opened: wait (bounded) for it to be created.
      await Promise.race([this.viewReady, new Promise<void>((resolve) => setTimeout(resolve, VIEW_READY_TIMEOUT_MS))]);
    }
    if (!this._view) {
      return;
    }
    this.controller.setPendingLink(link);
    void this._view.webview.postMessage({ type: "openAddNote", link });
  }

  /** Tells the webview to open the categories management modal. */
  openCategories(): void {
    this._view?.webview.postMessage({ type: "openCategories" });
  }

  /** Tells the webview to open the types management modal. */
  openTypes(): void {
    this._view?.webview.postMessage({ type: "openTypes" });
  }

  /** Tells the webview to open the weekly report modal. */
  openWeeklyReport(report: WeeklyReportData): void {
    this._view?.webview.postMessage({ type: "openWeeklyReport", report });
  }

  private updateBadge(): void {
    if (!this._view) {
      return;
    }
    const inProgress = this.items.list().filter((it) => it.status === "in-progress").length;
    this._view.badge = inProgress > 0 ? { value: inProgress, tooltip: `${inProgress} in progress` } : undefined;
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    try {
      // The lock is enforced here as well as in the controller, because the
      // messages handled below never reach the controller.
      if (this.workPause.isPaused() && !isAllowedDuringWorkPause(msg.type)) {
        return;
      }
      if (msg.type === "refresh") {
        this.postState();
        return;
      }
      if (msg.type === "toggleArchiveView") {
        this._archiveVisible = !this._archiveVisible;
        this.refresh();
        return;
      }
      if (msg.type === "copyToClipboard") {
        if (typeof msg.text === "string" && msg.text.length > 0) {
          await vscode.env.clipboard.writeText(msg.text);
        }
        return;
      }
      if (msg.type === "openLink") {
        if (msg.id) {
          await this.openLinkedLocation(msg.id);
        }
        return;
      }
      await this.controller.handleMessage(msg);
      this.refresh();
    } catch (err) {
      void vscode.window.showErrorMessage(`MindStream: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Re-finds the linked code, then opens the file at its line (or explains why it cannot). */
  private async openLinkedLocation(id: string): Promise<void> {
    const resolved = await this.links.resolveItem(id);
    if (!resolved) {
      return;
    }
    this.refresh();
    const { link, outcome } = resolved;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (outcome === "missing" || !root) {
      void vscode.window.showWarningMessage(`MindStream: "${link.filePath}" no longer exists at this path. The note is kept.`);
      return;
    }
    const uri = vscode.Uri.joinPath(root, ...link.filePath.split("/"));
    const line = Math.max(0, link.lineStart - 1);
    const lineEnd = Math.max(line, (link.lineEnd ?? link.lineStart) - 1);
    const editor = await vscode.window.showTextDocument(uri, {
      selection: new vscode.Range(line, 0, lineEnd, Number.MAX_SAFE_INTEGER),
    });
    editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    if (outcome === "changed") {
      void vscode.window.showWarningMessage("MindStream: the linked code changed, so the line shown may no longer match the note.");
    }
  }

  async confirmDeleteNote(title: string): Promise<boolean> {
    const pick = await vscode.window.showWarningMessage(`Delete note "${title}" permanently?`, { modal: true }, "Delete");
    return pick === "Delete";
  }

  async confirmDeleteCategory(label: string, count: number): Promise<boolean> {
    const pick = await vscode.window.showWarningMessage(`Delete category "${label}"? ${count} note(s) in it will be permanently deleted too.`, { modal: true }, "Delete");
    return pick === "Delete";
  }

  async confirmDeleteType(label: string): Promise<boolean> {
    const pick = await vscode.window.showWarningMessage(`Delete type "${label}"?`, { modal: true }, "Delete");
    return pick === "Delete";
  }

  async confirmRestoreEmojiPalette(): Promise<boolean> {
    const pick = await vscode.window.showWarningMessage(
      "Restore the original emoji list? This resets the current list and any emoji you added will be lost.",
      { modal: true },
      "Restore"
    );
    return pick === "Restore";
  }

  async pickType(types: { id: string; label: string; icon?: string }[]): Promise<string | undefined> {
    const items: (vscode.QuickPickItem & { typeId: string })[] = types.map((t) => ({
      label: t.label,
      iconPath: new vscode.ThemeIcon(t.icon || "tag"),
      typeId: t.id,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      title: "Set Default Type",
      placeHolder: "Choose the type to pre-select for notes in this category",
    });
    return pick?.typeId;
  }

  async confirmDiscardWorkPauseDraft(): Promise<boolean> {
    const pick = await vscode.window.showWarningMessage("Discard your unsaved changes to the note?", { modal: true }, "Discard");
    return pick === "Discard";
  }

  answerWorkPauseDiscard(discard: boolean): void {
    void this._view?.webview.postMessage({ type: "workPauseDiscardAnswer", discard });
  }

  showInfo(message: string): void {
    void vscode.window.showInformationMessage(message);
  }

  private postState(): void {
    // A hidden panel is not rendered; it receives the latest state once it is shown again.
    if (!this._view || !this._view.visible) {
      return;
    }
    const workPauseNote = this.workPause.get();
    if (workPauseNote.paused) {
      // Locked: the page shows only the note, so nothing else is sent to draw.
      void this._view.webview.postMessage({ type: "state", workPause: workPauseNote });
      return;
    }
    void this._view.webview.postMessage({
      type: "state",
      workPause: workPauseNote,
      items: this.items.list(this._archiveVisible),
      types: this.types.list().map((t) => ({ ...t, count: this.types.countItems(t.id) })),
      categories: this.categories.list().map((c) => ({ ...c, count: this.categories.countItems(c.id) })),
      statusLabels: STATUS_LABEL,
      includeArchived: this._archiveVisible,
      direction: this.getDirection(),
      emojiPalette: this.emoji.palette(),
      emojiRecents: this.emoji.recents(),
      descriptionHeight: this.uiPrefs.descriptionHeight(),
      copyIncludeNoteInfo: this.getCopyIncludeNoteInfo(),
      priority: {
        ...priorityFeatures(this.getPriorityStyle()),
        levels: PRIORITIES,
        labels: PRIORITY_LABEL,
        defaultValue: DEFAULT_PRIORITY,
      },
    });
  }

  /** Reads the priority style setting (an unknown value falls back to the default). */
  private getPriorityStyle(): PriorityStyle {
    return normalizePriorityStyle(vscode.workspace.getConfiguration("mindstream").get<string>("priority.style"));
  }

  /** Reads the UI direction setting (defaults to 'ltr'). */
  private getDirection(): string {
    const configured = vscode.workspace.getConfiguration("mindstream").get<string>("ui.direction");
    return configured === "rtl" ? "rtl" : "ltr";
  }

  /** Reads the copy-content setting (defaults to including the note info section). */
  private getCopyIncludeNoteInfo(): boolean {
    return vscode.workspace.getConfiguration("mindstream").get<boolean>("copy.includeNoteInfo", true);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "sidebar.js"));
    const iconClassUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "iconClass.js"));
    const defaultTypeUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "defaultType.js"));
    const linkPathUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "linkPath.js"));
    const emojiUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "emoji.js"));
    const tooltipUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "tooltip.js"));
    const codiconNamesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "codicon-names.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "sidebar.css"));
    const codiconCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "codicon.css"));
    const dropdownMenuUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "dropdown-menu.js"));
    const dropdownMenuCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "dropdown-menu.css"));
    const viewOptionsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "viewOptions.js"));
    const workPauseUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "media", "workPause.js"));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${codiconCssUri}" rel="stylesheet">
  <link href="${dropdownMenuCssUri}" rel="stylesheet">
  <link href="${styleUri}?v=${Date.now()}" rel="stylesheet">
  <title>MindStream</title>
</head>
<body class="${getBodyClass(this.isDevMode)}">
  <div id="toolbar" class="toolbar">
    <div id="category-filter-container"></div>
    <div id="type-filter-container"></div>
    <button id="view-options-btn" class="cs-btn cs-btn-toolbar view-options-btn" type="button" data-tooltip="View options">
      <span id="view-options-icon" class="codicon codicon-list-filter" aria-hidden="true"></span>
      <span id="view-options-label" class="cs-btn-label">View</span>
      <span class="codicon codicon-chevron-down view-options-chevron" aria-hidden="true"></span>
    </button>
    <button id="btn-archive-toggle" class="btn btn-ghost" data-tooltip="Show/hide archive">Archive</button>
  </div>
  <div id="empty" class="empty" hidden></div>
  <div id="list" class="list"></div>
  <div id="modal" class="modal" hidden>
    <div class="modal-card">
      <div class="modal-header">
        <span id="modal-title">New note</span>
        <button id="modal-close" class="icon-btn close-x-btn" data-tooltip="Close">✕</button>
      </div>
      <div id="f-link-field" class="field" hidden>
        <span>Linked to code</span>
        <div id="f-link" class="link-readonly"></div>
      </div>
      <label class="field"><span>Title</span><input id="f-title" type="text" placeholder="Write the idea/task briefly"></label>
      <div class="field"><span>Type</span><div id="f-type-container"></div></div>
      <div class="field"><span>Category</span><div id="f-category-container"></div></div>
      <div id="f-priority-field" class="field" hidden>
        <span id="f-priority-label">Priority</span>
        <div id="f-priority" class="pc" role="radiogroup" aria-labelledby="f-priority-label">
          <div class="pc-indicator" aria-hidden="true"></div>
        </div>
        <div id="f-priority-hint" class="pc-hint" hidden>No priority assigned - Select one.</div>
      </div>
      <label class="field"><span>Description (optional)</span><textarea id="f-desc" rows="3" placeholder="Extra details..."></textarea></label>
      <div class="modal-actions">
        <button id="emoji-hint" class="emoji-hint" type="button">💡 Ctrl+Shift+/ inserts an emoji</button>
        <button id="modal-cancel" class="btn btn-ghost">Cancel</button>
        <button id="modal-save" class="btn btn-primary">Save</button>
      </div>
    </div>
  </div>
  <div id="view-modal" class="modal" hidden>
    <div class="modal-card viewer-card">
      <div class="modal-header viewer-header">
        <div class="viewer-options-wrap" id="viewer-options-wrap">
          <button id="viewer-option-btn" class="icon-btn viewer-option-btn" data-tooltip="More options" aria-haspopup="menu" aria-expanded="false">
            <span class="codicon codicon-ellipsis"></span>
          </button>
        </div>
        <span id="view-title" class="viewer-title"></span>
        <button id="view-close" class="icon-btn close-x-btn" data-tooltip="Close">✕</button>
      </div>      
      <div id="view-desc" class="viewer-desc">
        <div id="view-desc-scroll" class="viewer-desc-scroll">
          <div id="view-desc-content" class="viewer-desc-content"></div>
        </div>
      </div>
      <div id="view-link" class="viewer-link" hidden></div>
      <div id="view-timestamps" class="viewer-timestamps"></div>
      <div class="modal-actions">
        <div class="viewer-meta">
          <span id="view-type" class="card-type"></span>
          <span id="view-category" class="viewer-category"></span>
          <span id="view-status" class="status"></span>
        </div>
        <button id="view-edit" class="btn btn-primary">Edit</button>
        <button id="view-close-btn" class="btn btn-ghost">Close</button>
      </div>
    </div>
  </div>
  <div id="categories-modal" class="modal" hidden>
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title-group">
          <span class="modal-title">Manage Categories</span>
          <span class="modal-subtitle">Create, rename, and delete your note categories</span>
        </div>
        <button id="categories-close" class="icon-btn close-x-btn" data-tooltip="Close">✕</button>
      </div>
      <div id="categories-list" class="categories-list"></div>
      <div class="mgmt-form">
        <input id="f-category-name" type="text" placeholder="New category name" autocomplete="off">
        <button id="btn-add-category" class="btn btn-primary">Add</button>
      </div>
    </div>
  </div>
  <div id="types-modal" class="modal" hidden>
    <div class="modal-card types-card">
      <div class="modal-header">
        <div class="modal-title-group">
          <span class="modal-title">Manage Types</span>
          <span class="modal-subtitle">Create, rename, and delete your note types</span>
        </div>
        <button id="types-close" class="icon-btn close-x-btn" data-tooltip="Close">✕</button>
      </div>
      <div id="types-list" class="types-list"></div>
      <div class="mgmt-form">
        <button id="btn-type-icon" class="icon-btn type-icon-btn choose-icon" data-tooltip="Choose icon">
          <span id="btn-type-icon-glyph" class="codicon codicon-tag"></span>
        </button>
        <input id="f-type-name" type="text" placeholder="New type name" autocomplete="off">
        <button id="btn-add-type" class="btn btn-primary">Add</button>
      </div>
      <div id="icons-modal" class="icons-modal" hidden>
        <div id="icons-grid" class="icons-grid"></div>
        <input id="f-icon-filter" class="icon-filter-input" type="text" placeholder="Filter icons..." autocomplete="off">
      </div>
    </div>
  </div>
  <div id="report-modal" class="modal" hidden>
    <div class="modal-card report-card">
      <div class="modal-header">
        <div class="modal-title-group">
          <span id="report-title" class="modal-title">Weekly Report</span>
          <span class="modal-subtitle">Your activity for this week</span>
        </div>
        <button id="report-close" class="icon-btn close-x-btn" data-tooltip="Close">✕</button>
      </div>
      <div id="report-summary" class="report-summary"></div>
      <div id="report-body" class="report-body"></div>
    </div>
  </div>
  <div id="emoji-picker" class="emoji-picker" hidden>
    <div id="emoji-recents-row" class="emoji-recents-row" hidden>
      <div class="emoji-section-label">Recent</div>
      <div id="emoji-recents-grid" class="emoji-recents-grid"></div>
    </div>
    <div id="emoji-symbols-row" class="emoji-symbols-row">
      <div class="emoji-section-label">Symbols</div>
      <div id="emoji-symbols-grid" class="emoji-symbols-grid"></div>
    </div>
    <div id="emoji-grid" class="emoji-grid"></div>
    <div class="emoji-picker-footer">
      <button id="emoji-edit-btn" class="btn btn-ghost" type="button">Edit list</button>
    </div>
  </div>
  <div id="emoji-edit-modal" class="modal" hidden>
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title-group">
          <span class="modal-title">Edit Emoji List</span>
          <span class="modal-subtitle">Emoji are stored as a plain sequence and split automatically</span>
        </div>
        <button id="emoji-edit-close" class="icon-btn close-x-btn" data-tooltip="Close">✕</button>
      </div>
      <div class="field">
        <div class="field-label-row">
          <label for="f-emoji-list">Emoji</label>
          <button id="emoji-restore-btn" class="link-btn" type="button">Restore original emoji list</button>
        </div>
        <textarea id="f-emoji-list" rows="4" placeholder="Paste or type emoji one after another..."></textarea>
      </div>
      <div id="emoji-edit-preview" class="emoji-edit-preview"></div>
      <div class="modal-actions">
        <span id="emoji-notice" class="emoji-notice" hidden></span>
        <button id="emoji-edit-cancel" class="btn btn-ghost">Cancel</button>
        <button id="emoji-edit-save" class="btn btn-primary">Save</button>
      </div>
    </div>
  </div>
  <div id="work-pause" class="work-pause" role="dialog" aria-modal="true" aria-labelledby="work-pause-title" hidden>
    <svg class="work-pause-defs" width="0" height="0" focusable="false" aria-hidden="true">
      <defs>
        <clipPath id="work-pause-sheet-shape" clipPathUnits="objectBoundingBox">
          <path d="M0,0 Q0.5,0.02 1,0 Q0.98,0.5 1,1 Q0.5,0.98 0,1 Q0.02,0.5 0,0 Z" />
        </clipPath>
      </defs>
    </svg>
    <section id="work-pause-card" class="work-pause-card">
      <span class="work-pause-shadow" aria-hidden="true"></span>
      <span class="work-pause-tape" aria-hidden="true"></span>
      <div class="work-pause-sheet">
        <header class="work-pause-header">
          <span class="work-pause-badge" aria-hidden="true"><span class="codicon codicon-pinned"></span></span>
          <div class="work-pause-heading">
            <h2 id="work-pause-title" class="work-pause-title">Pick up where you left off</h2>
            <p class="work-pause-subtitle">A note to your future self</p>
          </div>
          <button id="work-pause-edit" class="work-pause-edit" type="button" aria-label="Edit note" data-tooltip="Edit note">
            <span class="codicon codicon-edit" aria-hidden="true"></span>
          </button>
        </header>
        <div class="work-pause-body">
          <div id="work-pause-view" class="work-pause-text" tabindex="0"></div>
          <textarea id="work-pause-input" class="work-pause-input" hidden aria-label="Note text" maxlength="10000" placeholder="What were you doing? Where did you stop? What is the next step?"></textarea>
        </div>
        <footer class="work-pause-footer">
          <span id="work-pause-updated" class="work-pause-updated"></span>
          <div id="work-pause-actions" class="work-pause-actions" hidden>
            <button id="work-pause-cancel" class="btn btn-ghost" type="button">Cancel</button>
            <button id="work-pause-save" class="btn btn-primary" type="button">Save</button>
          </div>
        </footer>
      </div>
    </section>
  </div>
  <script nonce="${nonce}" src="${codiconNamesUri}"></script>
  <script nonce="${nonce}" src="${iconClassUri}"></script>
  <script nonce="${nonce}" src="${defaultTypeUri}"></script>
  <script nonce="${nonce}" src="${linkPathUri}"></script>
  <script nonce="${nonce}" src="${emojiUri}"></script>
  <script nonce="${nonce}" src="${tooltipUri}"></script>
  <script nonce="${nonce}" src="${dropdownMenuUri}"></script>
  <script nonce="${nonce}" src="${viewOptionsUri}"></script>
  <script nonce="${nonce}" src="${workPauseUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
