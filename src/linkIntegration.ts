import * as vscode from "vscode";
import { LinkTracker, LinkFiles } from "./linkTracker";
import { buildLink, LineEdit, toRelativePath } from "./linkResolver";
import { MindStreamLink } from "./models";
import { debounce } from "./util";
import { SaveScheduler } from "./saveScheduler";

const REFRESH_DEBOUNCE_MS = 300;
/** Quiet time before pending line shifts are written, and the longest a burst may delay that write. */
const PERSIST_DELAY_MS = 3000;
const PERSIST_MAX_WAIT_MS = 20000;

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Reads workspace files for the tracker, preferring the (possibly unsaved) open document. */
export function createLinkFiles(root: vscode.Uri): LinkFiles {
  return {
    async readLines(relPath) {
      const uri = vscode.Uri.joinPath(root, ...relPath.split("/"));
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      if (open) {
        return splitLines(open.getText());
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return splitLines(Buffer.from(bytes).toString("utf8"));
      } catch {
        return null;
      }
    },
  };
}

/**
 * Builds the link for the active editor's cursor line (or selected lines).
 * Returns undefined, after telling the user why, when it cannot be linked.
 */
export function createLinkFromActiveEditor(folder: vscode.WorkspaceFolder): MindStreamLink | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    void vscode.window.showWarningMessage("MindStream: open a file from your project to add a note to one of its lines.");
    return undefined;
  }
  const { selection, document } = editor;
  const lineStart = selection.start.line + 1;
  // A selection that ends at column 0 of the next line does not include that line.
  const lineEnd = selection.isEmpty ? lineStart : selection.end.line + (selection.end.character === 0 && selection.end.line > selection.start.line ? 0 : 1);
  const link = buildLink(folder.uri.fsPath, document.uri.fsPath, splitLines(document.getText()), lineStart, lineEnd);
  if (!link) {
    void vscode.window.showWarningMessage("MindStream: this file is outside the open workspace folder, so a note cannot be linked to it.");
  }
  return link;
}

/**
 * Wires the tracker to VS Code: live edits, rename/move/delete operations, and a
 * full re-check on startup and window focus (which covers changes made outside
 * the editor, such as git or the terminal).
 */
export function registerLinkTracking(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder, tracker: LinkTracker, onChange: () => void): void {
  const root = folder.uri.fsPath;
  const notify = debounce(onChange, REFRESH_DEBOUNCE_MS);
  // Live line shifts are kept in memory and written in one batch (see LinkTracker.applyEdits).
  const persist = new SaveScheduler(() => tracker.flush(), PERSIST_DELAY_MS, PERSIST_MAX_WAIT_MS);
  const rel = (uri: vscode.Uri): string | undefined => (uri.scheme === "file" ? toRelativePath(root, uri.fsPath) : undefined);

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const relPath = rel(e.document.uri);
      if (!relPath || e.contentChanges.length === 0) {
        return;
      }
      const edits: LineEdit[] = e.contentChanges.map((c) => ({
        startLine: c.range.start.line,
        endLine: c.range.end.line,
        addedLines: c.text.split(/\r\n|\r|\n/).length - 1,
      }));
      if (tracker.applyEdits(relPath, edits)) {
        persist.schedule();
        notify();
      }
    }),
    // Natural save points: the user saving the file, leaving the window, or closing VS Code.
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (rel(doc.uri)) {
        persist.flush();
      }
    }),
    { dispose: () => persist.flush() },
    vscode.workspace.onDidRenameFiles((e) => {
      let changed = false;
      for (const { oldUri, newUri } of e.files) {
        const from = rel(oldUri);
        const to = rel(newUri);
        if (from && to) {
          changed = tracker.applyRename(from, to) || changed;
        } else if (from) {
          // Moved out of the workspace: the old location no longer has the file.
          changed = tracker.applyDelete(from) || changed;
        }
      }
      if (changed) {
        notify();
      }
    }),
    vscode.workspace.onDidDeleteFiles((e) => {
      let changed = false;
      for (const uri of e.files) {
        const removed = rel(uri);
        if (removed) {
          changed = tracker.applyDelete(removed) || changed;
        }
      }
      if (changed) {
        notify();
      }
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void tracker.refreshAll().then((changed) => changed && notify());
      } else {
        persist.flush();
      }
    })
  );

  void tracker.refreshAll().then((changed) => changed && notify());
}
