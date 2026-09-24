import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createEmptyData } from '../src/storage';
import { ItemsStore } from '../src/itemsStore';
import { TypesRegistry } from '../src/typesRegistry';
import { CategoriesRegistry } from '../src/categoriesRegistry';
import { GENERAL_CATEGORY_ID } from '../src/models';
import {
  CommandsDeps,
  UriLike,
  exportJson,
  exportMarkdown,
  exportWeeklyReport,
  importJson,
  requireWorkspace
} from '../src/commands';
import { InMemoryStorage } from './helpers';

class FakeDeps implements CommandsDeps {
  workspacePath = '/fake/ws';
  saveUri: UriLike | undefined;
  openUris: UriLike[] | undefined;
  warningResult: string | undefined;
  infos: string[] = [];
  errors: string[] = [];
  executed: string[] = [];
  warningMessages: string[] = [];
  lastDefaultUri: UriLike | undefined;

  joinPath(basePath: string, fileName: string): UriLike {
    return { fsPath: path.join(basePath, fileName) };
  }

  async showSaveDialog(defaultUri: UriLike | undefined): Promise<UriLike | undefined> {
    this.lastDefaultUri = defaultUri;
    return this.saveUri;
  }

  async showOpenDialog(): Promise<UriLike[] | undefined> {
    return this.openUris;
  }

  async showWarningMessage(message: string): Promise<string | undefined> {
    this.warningMessages.push(message);
    return this.warningResult;
  }

  async showInformationMessage(message: string): Promise<unknown> {
    this.infos.push(message);
    return undefined;
  }

  async showErrorMessage(message: string): Promise<unknown> {
    this.errors.push(message);
    return undefined;
  }

  async executeCommand(command: string): Promise<unknown> {
    this.executed.push(command);
    return undefined;
  }
}

function tmpFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstream-cmd-test-'));
  return path.join(dir, name);
}

describe('requireWorkspace', () => {
  it('executes the open-folder command when the user picks Open Folder', async () => {
    const deps = new FakeDeps();
    deps.warningResult = 'Open Folder';
    await requireWorkspace(deps);
    assert.deepStrictEqual(deps.executed, ['vscode.openFolder']);
  });

  it('does nothing when the user dismisses the prompt', async () => {
    const deps = new FakeDeps();
    deps.warningResult = undefined;
    await requireWorkspace(deps);
    assert.strictEqual(deps.executed.length, 0);
  });
});

describe('exportMarkdown', () => {
  function setup() {
    const storage = new InMemoryStorage(createEmptyData());
    return {
      items: new ItemsStore(storage),
      types: new TypesRegistry(storage),
      categories: new CategoriesRegistry(storage)
    };
  }

  it('shows an info message when there are no notes', async () => {
    const deps = new FakeDeps();
    const { items, types, categories } = setup();
    await exportMarkdown(deps, items, types, categories);
    assert.strictEqual(deps.infos.length, 1);
    assert.strictEqual(deps.saveUri, undefined);
  });

  it('writes markdown to the chosen path and reports the count', async () => {
    const deps = new FakeDeps();
    const { items, types, categories } = setup();
    const typeId = types.add('Bug').id;
    items.create({ typeId, title: 'Fix crash', categoryId: GENERAL_CATEGORY_ID });

    deps.saveUri = { fsPath: tmpFile('notes.md') };
    await exportMarkdown(deps, items, types, categories);

    assert.strictEqual(deps.lastDefaultUri!.fsPath, path.join('/fake/ws', 'mindstream-notes.md'));
    const content = fs.readFileSync(deps.saveUri.fsPath, 'utf8');
    assert.ok(content.includes('## [Bug] Fix crash'));
    assert.ok(deps.infos.some((m) => m.includes('1 note(s)')));
  });
});

describe('exportJson', () => {
  it('writes the data as pretty-printed JSON', async () => {
    const deps = new FakeDeps();
    const storage = new InMemoryStorage(createEmptyData());
    deps.saveUri = { fsPath: tmpFile('data.json') };

    await exportJson(deps, storage);

    const content = fs.readFileSync(deps.saveUri.fsPath, 'utf8');
    assert.deepStrictEqual(JSON.parse(content), storage.getData());
  });

  it('does not write when the save dialog is cancelled', async () => {
    const deps = new FakeDeps();
    const storage = new InMemoryStorage(createEmptyData());
    deps.saveUri = undefined;

    await exportJson(deps, storage);

    assert.strictEqual(deps.infos.length, 0);
  });
});

describe('importJson', () => {
  function makeImportFile(data: unknown): string {
    const file = tmpFile('incoming.json');
    fs.writeFileSync(file, JSON.stringify(data), 'utf8');
    return file;
  }

  function incomingItem(id: string) {
    return {
      id,
      typeId: 't',
      categoryId: 'general',
      title: 'Imported',
      status: 'pending',
      statusHistory: [{ status: 'pending', at: '2020-01-01T00:00:00.000Z' }],
      archived: false,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z'
    };
  }

  function incomingData(id: string) {
    return {
      version: 1,
      types: [],
      categories: [{ id: 'general', label: 'General', isDefault: true, order: 0, createdAt: 'x' }],
      items: [incomingItem(id)]
    };
  }

  it('does nothing when no file is selected', async () => {
    const deps = new FakeDeps();
    const storage = new InMemoryStorage(createEmptyData());
    deps.openUris = undefined;
    let refreshed = false;

    await importJson(deps, storage, () => (refreshed = true));

    assert.strictEqual(refreshed, false);
    assert.strictEqual(deps.errors.length, 0);
  });

  it('reports an error for an unreadable file', async () => {
    const deps = new FakeDeps();
    const storage = new InMemoryStorage(createEmptyData());
    deps.openUris = [{ fsPath: tmpFile('missing.json') }];

    await importJson(deps, storage, () => {});

    assert.strictEqual(deps.errors.length, 1);
  });

  it('merges the imported data on Merge', async () => {
    const deps = new FakeDeps();
    const storage = new InMemoryStorage(createEmptyData());
    const items = new ItemsStore(storage);
    const typeId = storage.getData().types[0].id;
    items.create({ typeId, title: 'Local', categoryId: GENERAL_CATEGORY_ID });

    deps.openUris = [{ fsPath: makeImportFile(incomingData('imported-1')) }];
    deps.warningResult = 'Merge';
    let refreshed = false;

    await importJson(deps, storage, () => (refreshed = true));

    assert.strictEqual(storage.getData().items.length, 2);
    assert.strictEqual(refreshed, true);
    assert.ok(deps.infos.some((m) => m.includes('merged')));
  });

  it('replaces the data on Replace', async () => {
    const deps = new FakeDeps();
    const storage = new InMemoryStorage(createEmptyData());
    const items = new ItemsStore(storage);
    const typeId = storage.getData().types[0].id;
    items.create({ typeId, title: 'Local', categoryId: GENERAL_CATEGORY_ID });

    deps.openUris = [{ fsPath: makeImportFile(incomingData('imported-1')) }];
    deps.warningResult = 'Replace';
    let refreshed = false;

    await importJson(deps, storage, () => (refreshed = true));

    assert.strictEqual(storage.getData().items.length, 1);
    assert.strictEqual(storage.getData().items[0].id, 'imported-1');
    assert.strictEqual(refreshed, true);
    assert.ok(deps.infos.some((m) => m.includes('Replaced')));
  });

  it('leaves the data untouched when the user cancels', async () => {
    const deps = new FakeDeps();
    const storage = new InMemoryStorage(createEmptyData());
    const file = makeImportFile({ version: 1, types: [], categories: [], items: [] });

    deps.openUris = [{ fsPath: file }];
    deps.warningResult = undefined;

    await importJson(deps, storage, () => {});

    assert.strictEqual(storage.getData().items.length, 0);
    assert.strictEqual(deps.infos.length, 0);
  });
});

describe('exportWeeklyReport', () => {
  it('writes the weekly report markdown', async () => {
    const deps = new FakeDeps();
    const storage = new InMemoryStorage(createEmptyData());
    const items = new ItemsStore(storage);
    deps.saveUri = { fsPath: tmpFile('report.md') };

    await exportWeeklyReport(deps, items);

    const content = fs.readFileSync(deps.saveUri.fsPath, 'utf8');
    assert.ok(content.includes('MindStream Weekly Report'));
    assert.ok(deps.infos.some((m) => m.includes('weekly report')));
  });
});
