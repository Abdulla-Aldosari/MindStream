import * as vscode from 'vscode';
import { createWorkspaceStorage } from './workspaceStorage';
import { ItemsStore } from './itemsStore';
import { TypesRegistry } from './typesRegistry';
import { CategoriesRegistry } from './categoriesRegistry';
import { SidebarProvider, VIEW_TYPE } from './sidebarProvider';
import { buildWeeklyReport } from './report';
import {
  CommandsDeps,
  exportJson,
  exportMarkdown,
  exportWeeklyReport,
  importJson,
  requireWorkspace
} from './commands';

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
  // Created once per extension lifetime. Pass it as a
  // constructor argument (dependency injection) to any class that needs to log.
  const outputChannel = vscode.window.createOutputChannel('MindStream');
  context.subscriptions.push(outputChannel);

  const deps = createCommandsDeps();

  const folder = vscode.workspace.workspaceFolders?.[0];  

  if (!folder) {
    // No folder is open: show an explanatory message only, commands show an alert.
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(VIEW_TYPE, new NoWorkspaceProvider())
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.addNote', () => requireWorkspace(deps))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.manageTypes', () => requireWorkspace(deps))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.manageCategories', () => requireWorkspace(deps))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.exportMarkdown', () => requireWorkspace(deps))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.exportJson', () => requireWorkspace(deps))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.importJson', () => requireWorkspace(deps))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.weeklyReport', () => requireWorkspace(deps))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.exportWeeklyReport', () => requireWorkspace(deps))
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('mindstream.refresh', () => requireWorkspace(deps))
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

  const isDevMode = context.extensionMode === vscode.ExtensionMode.Development;
  sidebar = new SidebarProvider(context.extensionUri, items, types, categories, isDevMode);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_TYPE, sidebar, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

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
    vscode.commands.registerCommand('mindstream.exportMarkdown', () => exportMarkdown(deps, items, types, categories))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.exportJson', () => exportJson(deps, storage))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.importJson', () => importJson(deps, storage, () => sidebar?.refresh()))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.weeklyReport', () => sidebar?.openWeeklyReport(buildWeeklyReport(items)))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.exportWeeklyReport', () => exportWeeklyReport(deps, items))
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

export function deactivate(): void {
  /* nothing to do */
}

function createCommandsDeps(): CommandsDeps {
  return {
    get workspacePath(): string | undefined {
      return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    },
    joinPath(basePath, fileName) {
      return vscode.Uri.joinPath(vscode.Uri.file(basePath), fileName);
    },
    async showSaveDialog(defaultUri, filters) {
      return vscode.window.showSaveDialog({
        defaultUri: defaultUri ? vscode.Uri.file(defaultUri.fsPath) : undefined,
        filters
      });
    },
    async showOpenDialog() {
      return vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Import', filters: { JSON: ['json'] } });
    },
    async showWarningMessage(message, options, ...items) {
      return vscode.window.showWarningMessage(message, options ?? {}, ...items);
    },
    async showInformationMessage(message) {
      return vscode.window.showInformationMessage(message);
    },
    async showErrorMessage(message) {
      return vscode.window.showErrorMessage(message);
    },
    async executeCommand(command) {
      return vscode.commands.executeCommand(command);
    }
  };
}
