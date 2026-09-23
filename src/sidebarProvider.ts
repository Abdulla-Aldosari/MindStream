import * as vscode from 'vscode';
import { MindStreamStatus } from './models';
import { ItemsStore } from './itemsStore';
import { TypesRegistry } from './typesRegistry';
import { CategoriesRegistry } from './categoriesRegistry';

export const VIEW_TYPE = 'mindstream.sidebar';

interface WebviewMessage {
  type:
    | 'refresh'
    | 'addItem'
    | 'updateItem'
    | 'deleteItem'
    | 'changeStatus'
    | 'toggleArchive'
    | 'toggleArchiveView'
    | 'insertTestData'
    | 'clearAll'
    | 'addCategory'
    | 'renameCategory'
    | 'deleteCategory';
  id?: string;
  title?: string;
  description?: string;
  typeId?: string;
  categoryId?: string;
  label?: string;
  status?: MindStreamStatus;
  archived?: boolean;
}

const STATUS_LABEL: Record<MindStreamStatus, string> = {
  pending: 'None',
  'in-progress': 'In Progress',
  done: 'Done'
};

/**
 * Sidebar view provider (WebviewView).
 * Renders note cards with full flexibility in the sidebar using custom HTML/CSS.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _archiveVisible = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly items: ItemsStore,
    private readonly types: TypesRegistry,
    private readonly categories: CategoriesRegistry
  ) {}

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

  private updateBadge(): void {
    if (!this._view) {
      return;
    }
    const inProgress = this.items.list().filter((it) => it.status === 'in-progress').length;
    this._view.badge = inProgress > 0 ? { value: inProgress, tooltip: `${inProgress} in progress` } : undefined;
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    try {
      switch (msg.type) {
        case 'refresh':
          this.postState();
          return;
        case 'addItem':
          if (msg.title?.trim() && msg.typeId) {
            this.items.create({
              typeId: msg.typeId,
              title: msg.title.trim(),
              description: msg.description,
              categoryId: msg.categoryId
            });
          }
          break;
        case 'updateItem':
          if (msg.id) {
            this.items.update(msg.id, {
              title: msg.title,
              description: msg.description,
              typeId: msg.typeId,
              categoryId: msg.categoryId
            });
          }
          break;
        case 'deleteItem':
          if (msg.id) {
            const item = this.items.get(msg.id);
            if (!item) {
              break;
            }
            const confirm = await vscode.window.showWarningMessage(
              `Delete note "${item.title}" permanently?`,
              { modal: true },
              'Delete'
            );
            if (confirm === 'Delete') {
              this.items.delete(msg.id);
            }
          }
          break;
        case 'changeStatus':
          if (msg.id && msg.status) {
            this.items.changeStatus(msg.id, msg.status);
          }
          break;
        case 'toggleArchiveView':
          this._archiveVisible = !this._archiveVisible;
          break;
        case 'insertTestData':
          this.items.insertTestData();
          break;
        case 'clearAll': {
          const confirm = await vscode.window.showWarningMessage(
            'Delete ALL notes? This empties everything.',
            { modal: true },
            'Delete All'
          );
          if (confirm === 'Delete All') {
            this.items.clear();
          }
          break;
        }
        case 'toggleArchive':
          if (msg.id && typeof msg.archived === 'boolean') {
            this.items.setArchived(msg.id, msg.archived);
          }
          break;
        case 'addCategory':
          if (msg.label?.trim()) {
            this.categories.add(msg.label.trim());
          }
          break;
        case 'renameCategory':
          if (msg.id && msg.label?.trim()) {
            this.categories.rename(msg.id, msg.label.trim());
          }
          break;
        case 'deleteCategory': {
          if (!msg.id) {
            break;
          }
          const cat = this.categories.get(msg.id);
          if (!cat) {
            break;
          }
          const count = this.categories.countItems(msg.id);
          const confirm = await vscode.window.showWarningMessage(
            `Delete category "${cat.label}"? ${count} note(s) in it will be permanently deleted too.`,
            { modal: true },
            'Delete'
          );
          if (confirm === 'Delete') {
            this.items.deleteByCategory(msg.id);
            this.categories.remove(msg.id);
          }
          break;
        }
      }
      this.refresh();
    } catch (err) {
      void vscode.window.showErrorMessage(`MindStream: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private postState(): void {
    if (!this._view) {
      return;
    }
    void this._view.webview.postMessage({
      type: 'state',
      items: this.items.list(this._archiveVisible),
      types: this.types.list(),
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
<body>
  <div id="toolbar" class="toolbar">
    <div id="category-filter-container" title="Filter by category"></div>
    <div id="view-mode-container" title="View mode"></div>
    <button id="btn-add" class="btn btn-primary" title="Quick note">+ Note</button>
    <button id="btn-archive-toggle" class="btn btn-ghost" title="Show/hide archive">Archive</button>
    <span class="spacer"></span>
    <button id="btn-more" class="icon-btn" title="More options"><span class="codicon codicon-kebab-vertical"></span></button>
  </div>
  <div id="more-menu" class="more-menu" hidden>
    <button id="menu-manage-categories" class="more-menu-item"><span class="codicon codicon-folder"></span> Manage Categories</button>
    <button id="btn-insert-test" class="more-menu-item"><span class="codicon codicon-add"></span> dev-insert-test</button>
    <button id="btn-delete-test" class="more-menu-item danger"><span class="codicon codicon-trash"></span> dev-delete-test</button>
  </div>
  <div id="list" class="list"></div>
  <div id="empty" class="empty" hidden>No notes yet.<br>Press "+ Note" to add your first idea.</div>
  <div id="modal" class="modal" hidden>
    <div class="modal-card">
      <div class="modal-header">
        <span id="modal-title">New note</span>
        <button id="modal-close" class="icon-btn" title="Close">✕</button>
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
        <button id="view-close" class="icon-btn" title="Close">✕</button>
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
        <button id="categories-close" class="icon-btn" title="Close">✕</button>
      </div>
      <div id="categories-list" class="categories-list"></div>
      <div class="categories-form">
        <input id="f-category-name" type="text" placeholder="New category name" autocomplete="off">
        <button id="btn-add-category" class="btn btn-primary">Add</button>
      </div>
    </div>
  </div>
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
