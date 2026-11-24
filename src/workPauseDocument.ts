/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as vscode from "vscode";
import { WORK_PAUSE_DOC_PATH, WORK_PAUSE_DOC_SCHEME, WorkPauseCopy } from "./workPause";

/**
 * Shows a read-only copy of the Work Pause note in an editor tab, so it can
 * stay in view after work is resumed. The copy is a snapshot: it is replaced
 * only when the user opens it again. There is a single tab: opening again
 * shows the tab that is already open (in its own editor group) with the new
 * text. Nothing is written anywhere and no file is created: the tab is backed
 * by a content provider (scheme `mindstream-pause`), which VS Code shows as
 * read-only and never asks to save.
 */
export class WorkPauseDocument implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly copy: WorkPauseCopy;
  private readonly changes = new vscode.EventEmitter<vscode.Uri>();
  private readonly registration: vscode.Disposable;
  private readonly uri = vscode.Uri.from({ scheme: WORK_PAUSE_DOC_SCHEME, path: WORK_PAUSE_DOC_PATH });

  readonly onDidChange = this.changes.event;

  /** `storedText` reads the stored note, shown by a tab restored before any snapshot. */
  constructor(storedText: () => string) {
    this.copy = new WorkPauseCopy(storedText);
    this.registration = vscode.workspace.registerTextDocumentContentProvider(WORK_PAUSE_DOC_SCHEME, this);
  }

  provideTextDocumentContent(): string {
    return this.copy.content();
  }

  /** Puts `text` in the copy and shows its tab, reusing the open one. */
  async open(text: string): Promise<void> {
    this.copy.take(text);
    // An open (or cached) document re-reads its content.
    this.changes.fire(this.uri);
    const target = this.uri.toString();
    const existing = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === target);
    const doc = await vscode.workspace.openTextDocument(this.uri);
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: existing?.group.viewColumn });
  }

  dispose(): void {
    this.registration.dispose();
    this.changes.dispose();
  }
}
