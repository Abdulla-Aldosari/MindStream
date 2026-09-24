import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createEmptyData,
  DEFAULT_TYPES,
  DEFAULT_CATEGORIES,
  normalizeData,
  StorageService
} from '../src/storage';
import { DATA_VERSION, GENERAL_CATEGORY_ID } from '../src/models';

describe('createEmptyData', () => {
  it('creates versioned empty data with ready-made types and the General category', () => {
    const data = createEmptyData();
    assert.strictEqual(data.version, DATA_VERSION);
    assert.strictEqual(data.items.length, 0);
    assert.strictEqual(data.types.length, DEFAULT_TYPES.length);

    const general = data.categories[0];
    assert.strictEqual(data.categories.length, 1);
    assert.strictEqual(general.id, GENERAL_CATEGORY_ID);
    assert.strictEqual(general.isDefault, true);

    const ids = new Set(data.types.map((t) => t.id));
    assert.strictEqual(ids.size, data.types.length);
    for (const t of data.types) {
      assert.ok(t.id.length > 0);
      assert.ok(t.createdAt.length > 0);
    }
  });
});

describe('DEFAULT_TYPES / DEFAULT_CATEGORIES', () => {
  it('ships 8 default types', () => {
    assert.strictEqual(DEFAULT_TYPES.length, 8);
  });

  it('ships the General default category', () => {
    assert.strictEqual(DEFAULT_CATEGORIES.length, 1);
    assert.strictEqual(DEFAULT_CATEGORIES[0].id, GENERAL_CATEGORY_ID);
    assert.strictEqual(DEFAULT_CATEGORIES[0].label, 'General');
  });
});

describe('normalizeData', () => {
  it('returns empty data for null / non-object input', () => {
    for (const raw of [null, undefined, 42, 'text', true]) {
      const d = normalizeData(raw);
      assert.strictEqual(d.version, DATA_VERSION);
      assert.strictEqual(d.types.length, DEFAULT_TYPES.length);
      assert.strictEqual(d.items.length, 0);
    }
  });

  it('fills missing arrays and version', () => {
    const d = normalizeData({});
    assert.strictEqual(d.version, DATA_VERSION);
    assert.deepStrictEqual(d.types, []);
    assert.strictEqual(d.categories.length, 1);
    assert.deepStrictEqual(d.items, []);
  });

  it('injects the General category at the front when missing', () => {
    const d = normalizeData({ categories: [{ id: 'x', label: 'X', createdAt: 't' }] });
    assert.strictEqual(d.categories[0].id, GENERAL_CATEGORY_ID);
    assert.strictEqual(d.categories.length, 2);
  });

  it('does not duplicate the General category when already present', () => {
    const d = normalizeData({
      categories: [
        { id: GENERAL_CATEGORY_ID, label: 'General', isDefault: true, order: 0, createdAt: 't' },
        { id: 'x', label: 'X', createdAt: 't' }
      ]
    });
    assert.strictEqual(d.categories.filter((c) => c.id === GENERAL_CATEGORY_ID).length, 1);
    assert.strictEqual(d.categories.length, 2);
  });

  it('ignores legacy items without a categoryId', () => {
    const d = normalizeData({ items: [{ id: 'x', typeId: 't', title: 'No cat' }] });
    assert.strictEqual(d.items.length, 0);
  });

  it('fills missing statusHistory and archived on kept items', () => {
    const d = normalizeData({
      items: [
        {
          id: 'x',
          typeId: 't',
          categoryId: 'general',
          title: 'A',
          status: 'done',
          createdAt: '2020-01-01T00:00:00.000Z'
        }
      ]
    });
    assert.strictEqual(d.items.length, 1);
    const it = d.items[0];
    assert.deepStrictEqual(it.statusHistory, [{ status: 'done', at: '2020-01-01T00:00:00.000Z' }]);
    assert.strictEqual(it.archived, false);
  });

  it('preserves a numeric version when provided', () => {
    const d = normalizeData({ version: 7 });
    assert.strictEqual(d.version, 7);
  });
});

describe('StorageService', () => {
  it('fromText: corrupt JSON falls back to default data', () => {
    const s = StorageService.fromText('{not valid json');
    assert.strictEqual(s.getData().version, DATA_VERSION);
  });

  it('fromText: reads and normalizes valid JSON', () => {
    const s = StorageService.fromText(JSON.stringify({ version: 1, types: [], categories: [], items: [] }));
    assert.strictEqual(s.getData().version, 1);
    assert.strictEqual(s.getData().categories[0].id, GENERAL_CATEGORY_ID);
  });

  it('forDir: round-trips data through the filesystem', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstream-test-'));
    try {
      const s1 = StorageService.forDir(dir);
      const data = s1.getData();
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
      s1.saveData(data);

      const s2 = StorageService.forDir(dir);
      assert.strictEqual(s2.getData().items.length, 1);
      assert.strictEqual(s2.getData().items[0].title, 'Hello');

      const file = path.join(dir, '.mindstream', 'data.json');
      assert.ok(fs.existsSync(file));
      assert.ok(!fs.existsSync(file + '.tmp'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
