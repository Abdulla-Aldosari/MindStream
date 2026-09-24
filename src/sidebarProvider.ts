import * as vscode from 'vscode';
import { MindStreamStatus } from './models';
import { ItemsStore } from './itemsStore';
import { TypesRegistry } from './typesRegistry';
import { CategoriesRegistry } from './categoriesRegistry';
import { WeeklyReportData } from './report';
import { SidebarController, SidebarUi, WebviewMessage } from './sidebarController';
import { getBodyClass } from './util';

export const VIEW_TYPE = 'mindstream.sidebar';

const STATUS_LABEL: Record<MindStreamStatus, string> = {
  pending: 'None',
  'in-progress': 'In Progress',
  done: 'Done'
};

/**
 * Sidebar view provider (WebviewView).
 * Renders note cards with full flexibility in the sidebar using custom HTML/CSS.
 */
export class SidebarProvider implements vscode.WebviewViewProvider, SidebarUi {
  private _view?: vscode.WebviewView;
  private _archiveVisible = false;

  private readonly controller: SidebarController;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly items: ItemsStore,
    private readonly types: TypesRegistry,
    private readonly categories: CategoriesRegistry,
    private readonly isDevMode: boolean = false
  ) {
    this.controller = new SidebarController(items, types, categories, this);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'media')]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => this.handleMessage(msg));
    this.updateBadge();
    this.postState();
  }

  refresh(): void {
    this.updateBadge();
    this.postState();
  }

  /** Tells the webview to open the note editor modal. */
  openAddNote(): void {
    this._view?.webview.postMessage({ type: 'openAddNote' });
  }

  /** Tells the webview to open the categories management modal. */
  openCategories(): void {
    this._view?.webview.postMessage({ type: 'openCategories' });
  }

  /** Tells the webview to open the types management modal. */
  openTypes(): void {
    this._view?.webview.postMessage({ type: 'openTypes' });
  }

  /** Tells the webview to open the weekly report modal. */
  openWeeklyReport(report: WeeklyReportData): void {
    this._view?.webview.postMessage({ type: 'openWeeklyReport', report });
  }

  private updateBadge(): void {
    if (!this._view) {
      return;
    }
    const inProgress = this.items.list().filter((it) => it.status === 'in-progress').length;
    this._view.badge = inProgress > 0 ? { value: inProgress, tooltip: `${inProgress} in progress` } : undefined;
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    try {
      if (msg.type === 'refresh') {
        this.postState();
        return;
      }
      if (msg.type === 'toggleArchiveView') {
        this._archiveVisible = !this._archiveVisible;
        this.refresh();
        return;
      }
      await this.controller.handleMessage(msg);
      this.refresh();
    } catch (err) {
      void vscode.window.showErrorMessage(`MindStream: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async confirmDeleteNote(title: string): Promise<boolean> {
    const pick = await vscode.window.showWarningMessage(
      `Delete note "${title}" permanently?`,
      { modal: true },
      'Delete'
    );
    return pick === 'Delete';
  }

  async confirmDeleteCategory(label: string, count: number): Promise<boolean> {
    const pick = await vscode.window.showWarningMessage(
      `Delete category "${label}"? ${count} note(s) in it will be permanently deleted too.`,
      { modal: true },
      'Delete'
    );
    return pick === 'Delete';
  }

  async confirmDeleteType(label: string): Promise<boolean> {
    const pick = await vscode.window.showWarningMessage(
      `Delete type "${label}"?`,
      { modal: true },
      'Delete'
    );
    return pick === 'Delete';
  }

  showInfo(message: string): void {
    void vscode.window.showInformationMessage(message);
  }

  private postState(): void {
    if (!this._view) {
      return;
    }
    void this._view.webview.postMessage({
      type: 'state',
      items: this.items.list(this._archiveVisible),
      types: this.types.list().map((t) => ({ ...t, count: this.types.countItems(t.id) })),
      categories: this.categories.list().map((c) => ({ ...c, count: this.categories.countItems(c.id) })),
      statusLabels: STATUS_LABEL,
      includeArchived: this._archiveVisible,
      direction: this.getDirection()
    });
  }

  /** Reads the UI direction setting (defaults to 'ltr'). */
  private getDirection(): string {
    const configured = vscode.workspace.getConfiguration('mindstream').get<string>('ui.direction');
    return configured === 'rtl' ? 'rtl' : 'ltr';
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'media', 'sidebar.js'));
    const codiconNamesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'media', 'codicon-names.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'media', 'sidebar.css'));
    const codiconCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'media', 'codicon.css'));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${codiconCssUri}" rel="stylesheet">
  <link href="${styleUri}?v=${Date.now()}" rel="stylesheet">
  <title>MindStream</title>
</head>
<body class="${getBodyClass(this.isDevMode)}">
  <div id="toolbar" class="toolbar">
    <div id="category-filter-container" title="Filter by category"></div>
    <div id="view-mode-container" title="View mode"></div>
    <button id="btn-archive-toggle" class="btn btn-ghost" title="Show/hide archive">Archive</button>
  </div>
  <div id="list" class="list"></div>
  <div id="empty" class="empty" hidden>No notes yet.<br>Press "Quick Note" (Ctrl+Alt+M) to add your first idea.</div>
  <div id="modal" class="modal" hidden>
    <div class="modal-card">
      <div class="modal-header">
        <span id="modal-title">New note</span>
        <button id="modal-close" class="icon-btn close-x-btn" title="Close">✕</button>
      </div>
      <label class="field"><span>Title</span><input id="f-title" type="text" placeholder="Write the idea/task briefly"></label>
      <div class="field"><span>Type</span><div id="f-type-container"></div></div>
      <div class="field"><span>Category</span><div id="f-category-container"></div></div>
      <label class="field"><span>Description (optional)</span><textarea id="f-desc" rows="3" placeholder="Extra details..."></textarea></label>
      <div class="modal-actions">
        <button id="modal-cancel" class="btn btn-ghost">Cancel</button>
        <button id="modal-save" class="btn btn-primary">Save</button>
      </div>
    </div>
  </div>
  <div id="view-modal" class="modal" hidden>
    <div class="modal-card viewer-card">
      <div class="modal-header viewer-header">
        <button id="view-close" class="icon-btn close-x-btn" title="Close">✕</button>
      </div>
      <span id="view-title" class="viewer-title"></span>
      <div id="view-desc" class="viewer-desc">
        <div id="view-desc-scroll" class="viewer-desc-scroll"></div>
      </div>
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
        <button id="categories-close" class="icon-btn close-x-btn" title="Close">✕</button>
      </div>
      <div id="categories-list" class="categories-list"></div>
      <div class="categories-form">
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
        <button id="types-close" class="icon-btn close-x-btn" title="Close">✕</button>
      </div>
      <div id="types-list" class="types-list"></div>
      <div class="types-form">
        <button id="btn-type-icon" class="icon-btn type-icon-btn choose-icon" title="Choose icon">
          <span id="btn-type-icon-glyph" class="codicon codicon-tag"></span>
        </button>
        <input id="f-type-name" type="text" placeholder="New type name" autocomplete="off">
        <button id="btn-add-type" class="btn btn-primary">Add</button>
      </div>
      <div id="icons-modal" class="icons-modal" hidden>
        <div id="icons-grid" class="icons-grid"></div>
        <input id="f-icon-filter" type="text" placeholder="Filter icons..." autocomplete="off">
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
        <button id="report-close" class="icon-btn close-x-btn" title="Close">✕</button>
      </div>
      <div id="report-summary" class="report-summary"></div>
      <div id="report-body" class="report-body"></div>
    </div>
  </div>
  <script nonce="${nonce}" src="${codiconNamesUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
