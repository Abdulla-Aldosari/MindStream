import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WorkspaceFolder } from 'vscode';
import { createWorkspaceStorage } from '../src/workspaceStorage';
import { GENERAL_CATEGORY_ID } from '../src/models';

function fakeFolder(fsPath: string): WorkspaceFolder {
  return { uri: { fsPath } } as unknown as WorkspaceFolder;
}

describe('createWorkspaceStorage', () => {
  it('returns null when no workspace folder is open', () => {
    assert.strictEqual(createWorkspaceStorage(undefined), null);
  });

  it('binds a StorageService to the workspace folder and persists data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstream-ws-test-'));
    try {
      const storage = createWorkspaceStorage(fakeFolder(dir));
      assert.ok(storage);
      assert.strictEqual(storage!.getData().categories[0].id, GENERAL_CATEGORY_ID);

      const data = storage!.getData();
      data.items.push({
        id: 'i1',
        typeId: 't1',
        categoryId: GENERAL_CATEGORY_ID,
        title: 'Hello',
        status: 'pending',
        statusHistory: [{ status: 'pending', at: '2020-01-01T00:00:00.000Z' }],
        archived: false,
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z'
      });
      storage!.saveData(data);

      const reloaded = createWorkspaceStorage(fakeFolder(dir));
      assert.strictEqual(reloaded!.getData().items.length, 1);
      assert.strictEqual(reloaded!.getData().items[0].title, 'Hello');
      assert.ok(fs.existsSync(path.join(dir, '.mindstream', 'data.json')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
