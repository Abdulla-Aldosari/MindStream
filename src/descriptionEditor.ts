import * as vscode from "vscode";
import { DESCRIPTION_SCHEME, DescriptionDraft } from "./descriptionDraft";

const SAVED_NOTICE = "MindStream: description updated in the note form. Click Save in the note to store it.";
const SAVED_NOTICE_MS = 6000;

function isSchemeTab(tab: vscode.Tab): tab is vscode.Tab & { input: vscode.TabInputText } {
  return tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === DESCRIPTION_SCHEME;
}

/**
 * Opens the description of the note form in a normal VS Code editor tab.
 *
 * The tab is backed by a virtual file (scheme `mindstream-desc`), so Ctrl+S
 * saves without a "Save As" dialog and never touches the data file: the text
 * only reaches the note form, and the note is stored by the form's own Save.
 * The rules live in `DescriptionDraft`; this class is the `vscode` layer.
 */
export class DescriptionEditor implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly draft = new DescriptionDraft();
  private closing = false;
  private readonly fileChanges = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly textChanges = new vscode.EventEmitter<string>();
  private readonly userClosed = new vscode.EventEmitter<string>();
  private readonly subscriptions: vscode.Disposable[];

  readonly onDidChangeFile = this.fileChanges.event;
  /** Fires with the live text after every edit or save made in the tab. */
  readonly onDidChangeText = this.textChanges.event;
  /** Fires with the final text when the user closes the tab (the draft ends). */
  readonly onDidCloseByUser = this.userClosed.event;

  constructor() {
    this.subscriptions = [
      vscode.workspace.registerFileSystemProvider(DESCRIPTION_SCHEME, this, { isCaseSensitive: true }),
      vscode.workspace.onDidChangeTextDocument((e) => this.handleDocumentChange(e)),
      vscode.window.tabGroups.onDidChangeTabs((e) => this.handleTabsClosed(e.closed)),
      this.fileChanges,
      this.textChanges,
      this.userClosed,
    ];
    // Tabs restored by a window reload belong to a form that no longer exists.
    void this.closeTabs(() => true);
  }

  /** The live text of the open draft, or `undefined` when none is open. */
  text(): string | undefined {
    return this.draft.liveText();
  }

  /** Opens the draft in a tab, or shows the tab again when it is already open. */
  async open(title: string, text: string): Promise<void> {
    const existing = this.draft.info();
    const info = existing ?? this.draft.open(title, text);
    const uri = vscode.Uri.from({ scheme: DESCRIPTION_SCHEME, path: info.path });
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      if (!existing) {
        this.draft.close();
      }
      throw err;
    }
    // Any other leftover description tab (an older draft) is closed.
    await this.closeTabs((tab) => tab.input.uri.path !== info.path);
  }

  /** Ends the draft and closes its tab. The tab is closed without asking to save. */
  async close(): Promise<void> {
    if (!this.draft.isOpen()) {
      return;
    }
    // The file must stay readable while its tab is reverted and closed, and the
    // tab closing here is not the user ending the draft.
    this.closing = true;
    try {
      await this.closeTabs(() => true);
    } finally {
      this.draft.close();
      this.closing = false;
    }
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.draft.close();
  }

  private async closeTabs(match: (tab: vscode.Tab & { input: vscode.TabInputText }) => boolean): Promise<void> {
    const tabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter(isSchemeTab)
      .filter(match);
    const clean = tabs.filter((tab) => !tab.isDirty);
    if (clean.length > 0) {
      await vscode.window.tabGroups.close(clean);
    }
    // Closing an edited tab would ask "Save changes?". The text already reached
    // the form (or is being discarded on purpose), so the tab is reverted first.
    for (const tab of tabs.filter((t) => t.isDirty)) {
      await vscode.window.showTextDocument(tab.input.uri, { preview: false });
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    }
  }

  private handleDocumentChange(e: vscode.TextDocumentChangeEvent): void {
    const doc = e.document;
    if (doc.uri.scheme !== DESCRIPTION_SCHEME || e.contentChanges.length === 0) {
      return;
    }
    if (this.draft.setLive(doc.uri.path, doc.getText())) {
      this.textChanges.fire(this.draft.liveText() ?? "");
    }
  }

  private handleTabsClosed(closed: readonly vscode.Tab[]): void {
    const info = this.draft.info();
    if (!info || this.closing) {
      return;
    }
    const isDraftTab = (tab: vscode.Tab): boolean => isSchemeTab(tab) && tab.input.uri.path === info.path;
    if (!closed.some(isDraftTab)) {
      return;
    }
    // The same file may still be shown in a split: the draft lives on then.
    if (vscode.window.tabGroups.all.some((group) => group.tabs.some(isDraftTab))) {
      return;
    }
    const text = this.draft.liveText() ?? "";
    this.draft.close();
    this.userClosed.fire(text);
  }

  // --- vscode.FileSystemProvider: a single virtual file, nothing else ---

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const stat = this.draft.stat(uri.path);
    if (!stat) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return { type: vscode.FileType.File, ctime: stat.mtime, mtime: stat.mtime, size: stat.size };
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const text = this.draft.savedText(uri.path);
    if (text === undefined) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return new TextEncoder().encode(text);
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    const text = new TextDecoder().decode(content);
    if (!this.draft.save(uri.path, text)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    this.textChanges.fire(this.draft.liveText() ?? "");
    vscode.window.setStatusBarMessage(SAVED_NOTICE, SAVED_NOTICE_MS);
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(oldUri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(oldUri);
  }
}
