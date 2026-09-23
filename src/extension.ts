import * as fs from 'fs';
import * as vscode from 'vscode';
import { createWorkspaceStorage } from './workspaceStorage';
import { normalizeData, StorageService } from './storage';
import { ItemsStore } from './itemsStore';
import { TypesRegistry } from './typesRegistry';
import { CategoriesRegistry } from './categoriesRegistry';
import { SidebarProvider, VIEW_TYPE } from './sidebarProvider';
import { MindStreamData, MindStreamStatus, MindStreamTypeDef } from './models';

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
    vscode.commands.registerCommand('mindstream.manageTypes', () => manageTypes(types, items))
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
    vscode.commands.registerCommand('mindstream.weeklyReport', () => weeklyReport(items))
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

const STATUS_LABEL: Record<MindStreamStatus, string> = {
  pending: 'None',
  'in-progress': 'In Progress',
  done: 'Done'
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
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
  const lines: string[] = ['# MindStream Notes', ''];
  for (const it of all) {
    lines.push(`## [${types.label(it.typeId)}] ${it.title}`);
    lines.push(`- Status: ${STATUS_LABEL[it.status]}`);
    lines.push(`- Category: ${categories.label(it.categoryId)}`);
    lines.push(`- Created: ${formatDate(it.createdAt)}`);
    const done = items.completedAt(it);
    if (done) {
      lines.push(`- Completed: ${formatDate(done)}`);
    }
    if (it.archived) {
      lines.push('- Archived');
    }
    if (it.description) {
      lines.push('');
      lines.push(it.description);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }
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

function mergeData(target: MindStreamData, incoming: MindStreamData): void {
  const typeIds = new Set(target.types.map((t) => t.id));
  for (const t of incoming.types) {
    if (!typeIds.has(t.id)) {
      target.types.push(t);
      typeIds.add(t.id);
    }
  }
  const categoryIds = new Set(target.categories.map((c) => c.id));
  for (const c of incoming.categories) {
    if (!categoryIds.has(c.id)) {
      target.categories.push(c);
      categoryIds.add(c.id);
    }
  }
  const itemIds = new Set(target.items.map((i) => i.id));
  for (const i of incoming.items) {
    if (!itemIds.has(i.id)) {
      target.items.push(i);
      itemIds.add(i.id);
    }
  }
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

interface WeeklyReportData {
  weekLabel: string;
  createdCount: number;
  completedCount: number;
  inProgressCount: number;
  archivedCount: number;
  completedTitles: string[];
  inProgressTitles: string[];
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildWeeklyReport(items: ItemsStore): WeeklyReportData {
  const now = new Date();
  const weekStart = startOfWeek(now).getTime();
  const all = items.list(true);
  const created = all.filter((it) => new Date(it.createdAt).getTime() >= weekStart);
  const completed = all.filter((it) => {
    const at = items.completedAt(it);
    return at ? new Date(at).getTime() >= weekStart : false;
  });
  const inProgress = all.filter((it) => it.status === 'in-progress');
  const archived = all.filter((it) => it.archivedAt && new Date(it.archivedAt).getTime() >= weekStart);
  return {
    weekLabel: formatDate(now.toISOString()),
    createdCount: created.length,
    completedCount: completed.length,
    inProgressCount: inProgress.length,
    archivedCount: archived.length,
    completedTitles: completed.map((it) => it.title),
    inProgressTitles: inProgress.map((it) => it.title)
  };
}

async function weeklyReport(items: ItemsStore): Promise<void> {
  const report = buildWeeklyReport(items);
  const qp = vscode.window.createQuickPick();
  qp.title = `MindStream Weekly Report — Week of ${report.weekLabel}`;
  const entries: vscode.QuickPickItem[] = [
    { label: `Created this week: ${report.createdCount} notes` },
    { label: `Completed this week: ${report.completedCount} notes` },
    { label: `Currently in progress: ${report.inProgressCount} notes` },
    { label: `Archived this week: ${report.archivedCount} notes` },
    { label: 'Completed', kind: vscode.QuickPickItemKind.Separator },
    ...report.completedTitles.map((t) => ({ label: `• ${t}` })),
    { label: 'In progress', kind: vscode.QuickPickItemKind.Separator },
    ...report.inProgressTitles.map((t) => ({ label: `• ${t}` }))
  ];
  qp.items = entries;
  qp.onDidHide(() => qp.dispose());
  qp.show();
}

async function exportWeeklyReport(items: ItemsStore): Promise<void> {
  const report = buildWeeklyReport(items);
  const lines: string[] = [
    `MindStream Weekly Report — Week of ${report.weekLabel}`,
    '',
    `Created this week:   ${report.createdCount} notes`,
    `Completed this week: ${report.completedCount} notes`,
    `Currently in progress: ${report.inProgressCount} notes`,
    `Archived this week:  ${report.archivedCount} notes`,
    ''
  ];
  if (report.completedTitles.length) {
    lines.push('Completed:');
    for (const t of report.completedTitles) {
      lines.push(`- ${t}`);
    }
    lines.push('');
  }
  if (report.inProgressTitles.length) {
    lines.push('In progress:');
    for (const t of report.inProgressTitles) {
      lines.push(`- ${t}`);
    }
    lines.push('');
  }
  const uri = await saveDialog(`weekly-report-${report.weekLabel}.md`, { Markdown: ['md'] });
  if (!uri) {
    return;
  }
  fs.writeFileSync(uri.fsPath, lines.join('\n'), 'utf8');
  void vscode.window.showInformationMessage('MindStream: Exported weekly report.');
}
