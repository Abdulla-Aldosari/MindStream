/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as vscode from "vscode";
import { DESCRIPTION_SCHEME, DescriptionDraft } from "./descriptionDraft";
import { DEFAULT_TAB_CLOSE_BEHAVIOR, TabCloseBehavior } from "./noteFormSettings";

const SAVED_NOTICE = "MindStream: description updated in the note form. Click Save in the note to store it.";
const SAVED_NOTICE_MS = 6000;
/** Pause after the last keystroke before the tab saves itself (keeps the tab from ever staying "modified"). */
const AUTO_SAVE_DELAY_MS = 150;

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
 *
 * What closing the tab does with edits that were not saved is the
 * `mindstream.descriptionTab.onClose` setting: with "keep" the tab saves itself
 * shortly after every edit (so VS Code never asks), with "ask" VS Code's own
 * Save / Don't Save / Cancel question appears. Either way the text only reaches
 * the note form, never the data file.
 */
export class DescriptionEditor implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly draft = new DescriptionDraft();
  private closing = false;
  private autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly fileChanges = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly textChanges = new vscode.EventEmitter<string>();
  private readonly userClosed = new vscode.EventEmitter<string>();
  private readonly subscriptions: vscode.Disposable[];

  readonly onDidChangeFile = this.fileChanges.event;
  /** Fires with the live text after every edit or save made in the tab. */
  readonly onDidChangeText = this.textChanges.event;
  /** Fires with the final text when the user closes the tab (the draft ends). */
  readonly onDidCloseByUser = this.userClosed.event;

  constructor(private readonly tabCloseBehavior: () => TabCloseBehavior = () => DEFAULT_TAB_CLOSE_BEHAVIOR) {
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
    this.cancelAutoSave();
    try {
      await this.closeTabs(() => true);
    } finally {
      this.draft.close();
      this.closing = false;
    }
  }

  dispose(): void {
    this.cancelAutoSave();
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
    // `doc.isDirty` is not up to date yet while this event runs (it still shows the
    // state before the edit), so it is only checked when the timer fires.
    if (this.tabCloseBehavior() === "keep") {
      this.scheduleAutoSave(doc);
    }
  }

  /** Saves the tab shortly after the last edit; the save only updates the note form. */
  private scheduleAutoSave(doc: vscode.TextDocument): void {
    this.cancelAutoSave();
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = undefined;
      if (doc.isDirty && !doc.isClosed) {
        void Promise.resolve(doc.save()).catch(() => undefined);
      }
    }, AUTO_SAVE_DELAY_MS);
  }

  private cancelAutoSave(): void {
    if (this.autoSaveTimer !== undefined) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
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
    // "keep": every edit goes back to the form. "ask": the user answered VS Code's
    // question, so only what was saved in the tab counts (Don't Save drops the rest).
    const text = this.draft.finalText(this.tabCloseBehavior() === "keep");
    this.cancelAutoSave();
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
    // Automatic saves happen after every edit, so only a save the user asked for is announced.
    if (this.tabCloseBehavior() === "ask") {
      vscode.window.setStatusBarMessage(SAVED_NOTICE, SAVED_NOTICE_MS);
    }
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(oldUri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(oldUri);
  }
}
