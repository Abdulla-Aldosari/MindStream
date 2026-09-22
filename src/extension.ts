import * as vscode from 'vscode';
import { createWorkspaceStorage } from './workspaceStorage';
import { ItemsStore } from './itemsStore';
import { TypesRegistry } from './typesRegistry';
import { CategoriesRegistry } from './categoriesRegistry';
import { SidebarProvider, VIEW_TYPE } from './sidebarProvider';
import { MindStreamTypeDef } from './models';

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
    vscode.commands.registerCommand('mindstream.manageTypes', () => manageTypes(types, items))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mindstream.manageCategories', () => sidebar?.openCategories())
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

interface QuickPickTypeItem extends vscode.QuickPickItem {
  typeDef?: MindStreamTypeDef;
}

async function pickType(types: TypesRegistry, allowNew: boolean): Promise<MindStreamTypeDef | undefined> {
  const defs = types.list();
  const items: QuickPickTypeItem[] = defs.map((t) => ({
    label: `$(${t.icon ?? 'tag'}) ${t.label}`,
    typeDef: t
  }));
  if (allowNew) {
    items.push({ label: '$(add) Create new type...' });
  }
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Choose a type' });
  if (!picked) {
    return undefined;
  }
  if (picked.typeDef) {
    return picked.typeDef;
  }
  // Create a new type
  const label = await vscode.window.showInputBox({
    prompt: 'New type name',
    placeHolder: 'e.g. Check, Think'
  });
  if (!label?.trim()) {
    return undefined;
  }
  return types.add(label.trim());
}

async function manageTypes(types: TypesRegistry, items: ItemsStore): Promise<void> {
  // Initial list: add a type or pick an existing one to manage it
  const defs = types.list();
  const entries: QuickPickTypeItem[] = [
    { label: '$(add) Add new type' },
    ...defs.map((t) => ({ label: `$(${t.icon ?? 'tag'}) ${t.label}`, description: t.label, typeDef: t }))
  ];
  const picked = await vscode.window.showQuickPick(entries, {
    placeHolder: 'Manage types: add one or pick a type to edit/delete'
  });
  if (!picked) {
    return;
  }
  if (!picked.typeDef) {
    const label = await vscode.window.showInputBox({ prompt: 'New type name', placeHolder: 'e.g. Check, Think' });
    if (!label?.trim()) {
      return;
    }
    types.add(label.trim());
    vscode.window.showInformationMessage(`Added type "${label.trim()}"`);
    return;
  }
  const def = picked.typeDef;
  const action = await vscode.window.showQuickPick(
    [
      { label: '$(edit) Rename', action: 'rename' as const },
      { label: '$(trash) Delete', action: 'delete' as const }
    ],
    { placeHolder: `Action on "${def.label}"` }
  );
  if (!action) {
    return;
  }
  if (action.action === 'rename') {
    const label = await vscode.window.showInputBox({ value: def.label, prompt: 'New name' });
    if (!label?.trim()) {
      return;
    }
    types.rename(def.id, label.trim());
    vscode.window.showInformationMessage(`Renamed to "${label.trim()}"`);
  } else {
    const affected = items.list(true).filter((it) => it.typeId === def.id).length;
    const confirm = await vscode.window.showWarningMessage(
      `Delete type "${def.label}"? ${affected > 0 ? `${affected} note(s) are linked to it.` : ''}`,
      { modal: true },
      'Delete'
    );
    if (confirm !== 'Delete') {
      return;
    }
    types.remove(def.id);
    if (affected > 0) {
      const other = types.list().filter((t) => t.id !== def.id);
      if (other.length > 0) {
        const target = await vscode.window.showQuickPick(
          other.map((t) => ({ label: t.label, id: t.id })),
          { placeHolder: 'Reassign the linked notes to a type...' }
        );
        if (target) {
          types.reassign(def.id, target.id);
        }
      }
    }
    vscode.window.showInformationMessage(`Deleted type "${def.label}"`);
  }
  sidebar?.refresh();
}
