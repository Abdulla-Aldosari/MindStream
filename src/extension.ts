import * as fs from 'fs';
import * as vscode from 'vscode';
import { createWorkspaceStorage } from './workspaceStorage';
import { normalizeData, StorageService } from './storage';
import { ItemsStore } from './itemsStore';
import { TypesRegistry } from './typesRegistry';
import { CategoriesRegistry } from './categoriesRegistry';
import { SidebarProvider, VIEW_TYPE } from './sidebarProvider';
import { buildMarkdownExport, buildWeeklyReportText, mergeData } from './export';
import { buildWeeklyReport } from './report';

let sidebar: SidebarProvider | undefined;

/**
 * Sidebar view provider shown when no folder is open:
 * displays a clear message asking the user to open a folder to start using it.
 */
class NoWorkspaceProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: false };
    webviewView.webview.html = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 24px 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
    .box { text-align: center; padding: 16px; }
    .icon { font-size: 40px; margin-bottom: 8px; }
    h3 { margin: 0 0 8px; font-size: 14px; }
    p { margin: 0; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.7; }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">🧠</div>
    <h3>MindStream</h3>
    <p>Open a folder (project) to start recording your notes and ideas.</p>
    <p>Data is stored in <code>.mindstream/data.json</code> at the project root.</p>
  </div>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];  

  if (!folder) {
    // No folder is open: show an explanatory message only, commands show an alert.
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(VIEW_TYPE, new NoWorkspaceProvider())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.addNote', () => requireWorkspace())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.manageTypes', () => requireWorkspace())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.manageCategories', () => requireWorkspace())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.exportMarkdown', () => requireWorkspace())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.exportJson', () => requireWorkspace())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.importJson', () => requireWorkspace())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.weeklyReport', () => requireWorkspace())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.exportWeeklyReport', () => requireWorkspace())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.refresh', () => requireWorkspace())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.showSidebar', async () => {
        await vscode.commands.executeCommand('workbench.view.extension.mindstream');
      })
    );
    return;
  }

  const storage = createWorkspaceStorage(folder);
  if (!storage) {
    return;
  }
  const types = new TypesRegistry(storage);
  const items = new ItemsStore(storage);
  const categories = new CategoriesRegistry(storage);

  sidebar = new SidebarProvider(context.extensionUri, items, types, categories);

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_TYPE, sidebar));

  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.addNote', () => sidebar?.openAddNote())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.manageTypes', () => sidebar?.openTypes())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.manageCategories', () => sidebar?.openCategories())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.exportMarkdown', () => exportMarkdown(items, types, categories))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.exportJson', () => exportJson(storage))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.importJson', () => importJson(storage, sidebar))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.weeklyReport', () => sidebar?.openWeeklyReport(buildWeeklyReport(items)))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.exportWeeklyReport', () => exportWeeklyReport(items))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.refresh', () => sidebar?.refresh())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.showSidebar', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.mindstream');
    })
  );
}

async function requireWorkspace(): Promise<void> {
  const pick = await vscode.window.showWarningMessage(
    'MindStream: Open a folder (project) first to start recording notes.',
    'Open Folder'
  );
  if (pick === 'Open Folder') {
    void vscode.commands.executeCommand('vscode.openFolder');
  }
}

export function deactivate(): void {
  /* nothing to do */
}

async function saveDialog(fileName: string, filters: Record<string, string[]>): Promise<vscode.Uri | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return vscode.window.showSaveDialog({
    defaultUri: folder ? vscode.Uri.joinPath(folder.uri, fileName) : undefined,
    filters
  });
}

async function exportMarkdown(items: ItemsStore, types: TypesRegistry, categories: CategoriesRegistry): Promise<void> {
  const all = items.list(true);
  if (all.length === 0) {
    void vscode.window.showInformationMessage('MindStream: There are no notes to export.');
    return;
  }
  const lines = buildMarkdownExport(items, types, categories);
  const uri = await saveDialog('mindstream-notes.md', { Markdown: ['md'] });
  if (!uri) {
    return;
  }
  fs.writeFileSync(uri.fsPath, lines.join('\n'), 'utf8');
  void vscode.window.showInformationMessage(`MindStream: Exported ${all.length} note(s) to Markdown.`);
}

async function exportJson(storage: StorageService): Promise<void> {
  const uri = await saveDialog('mindstream-data.json', { JSON: ['json'] });
  if (!uri) {
    return;
  }
  fs.writeFileSync(uri.fsPath, JSON.stringify(storage.getData(), null, 2), 'utf8');
  void vscode.window.showInformationMessage('MindStream: Exported data to JSON.');
}

async function importJson(storage: StorageService, sidebar: SidebarProvider | undefined): Promise<void> {
  const uris = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Import', filters: { JSON: ['json'] } });
  if (!uris || uris.length === 0) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(uris[0].fsPath, 'utf8'));
  } catch (err) {
    void vscode.window.showErrorMessage(`MindStream: Could not read the selected file: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const incoming = normalizeData(parsed);
  const current = storage.getData();
  const report = [
    'MindStream — Import JSON',
    '',
    `Current: ${current.items.length} notes, ${current.types.length} types, ${current.categories.length} categories`,
    `Imported: ${incoming.items.length} notes, ${incoming.types.length} types, ${incoming.categories.length} categories`
  ].join('\n');
  const choice = await vscode.window.showWarningMessage(report, { modal: true }, 'Merge', 'Replace');
  if (choice === 'Merge') {
    mergeData(current, incoming);
    storage.saveData(current);
    sidebar?.refresh();
    void vscode.window.showInformationMessage('MindStream: Imported and merged data.');
  } else if (choice === 'Replace') {
    storage.saveData(incoming);
    sidebar?.refresh();
    void vscode.window.showInformationMessage('MindStream: Replaced data with the imported file.');
  }
}

async function exportWeeklyReport(items: ItemsStore): Promise<void> {
  const report = buildWeeklyReport(items);
  const lines = buildWeeklyReportText(report);
  const uri = await saveDialog(`weekly-report-${report.weekLabel}.md`, { Markdown: ['md'] });
  if (!uri) {
    return;
  }
  fs.writeFileSync(uri.fsPath, lines.join('\n'), 'utf8');
  void vscode.window.showInformationMessage('MindStream: Exported weekly report.');
}
