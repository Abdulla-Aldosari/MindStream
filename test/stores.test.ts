import * as assert from 'assert';
import { createEmptyData, normalizeData, StorageService } from '../src/storage';
import { TypesRegistry } from '../src/typesRegistry';
import { ItemsStore } from '../src/itemsStore';
import { InMemoryStorage } from './helpers';

describe('StorageService', () => {
  it('creates default data with ready-made types when the file is missing', () => {
    const s = StorageService.fromText(null);
    const data = s.getData();
    assert.strictEqual(data.version, 1);
    assert.strictEqual(data.items.length, 0);
    assert.ok(data.types.length >= 8, 'default types must be present');
  });

  it('reads existing data and normalizes the incomplete structure', () => {
    const s = StorageService.fromText(
      JSON.stringify({ version: 1, types: [], items: [{ id: 'x', typeId: 't', title: 'Title' }] })
    );
    const data = s.getData();
    assert.strictEqual(data.items.length, 1);
    assert.deepStrictEqual(data.items[0].statusHistory, [{ status: 'pending', at: data.items[0].statusHistory[0].at }]);
    assert.strictEqual(data.items[0].archived, false);
  });

  it('handles corrupt JSON by falling back to default data', () => {
    const s = StorageService.fromText('{not valid json');
    assert.strictEqual(s.getData().version, 1);
  });
});

describe('TypesRegistry', () => {
  function setup() {
    const storage = new InMemoryStorage(createEmptyData());
    return { storage, types: new TypesRegistry(storage), items: new ItemsStore(storage) };
  }

  it('adds a new type', () => {
    const { types } = setup();
    const def = types.add('Check', 'check');
    assert.strictEqual(def.label, 'Check');
    assert.ok(def.id);
  });

  it('renaming updates the display without breaking records (reference by id)', () => {
    const { types, items } = setup();
    const def = types.add('Fix');
    items.create({ typeId: def.id, title: 'Fix something' });
    types.rename(def.id, 'Bug fix');
    assert.strictEqual(types.label(def.id), 'Bug fix');
    assert.strictEqual(items.list()[0].typeId, def.id);
  });

  it('deleting keeps records intact and shows "Deleted type"', () => {
    const { types, items } = setup();
    const def = types.add('Fix');
    items.create({ typeId: def.id, title: 'Fix something' });
    const affected = types.remove(def.id);
    assert.strictEqual(affected, 1);
    assert.strictEqual(types.label(def.id), '(Deleted type)');
    assert.strictEqual(items.list()[0].typeId, def.id);
  });

  it('reassignment moves all records from one type to another', () => {
    const { types, items } = setup();
    const a = types.add('A');
    const b = types.add('B');
    items.create({ typeId: a.id, title: 'One' });
    items.create({ typeId: a.id, title: 'Two' });
    const moved = types.reassign(a.id, b.id);
    assert.strictEqual(moved, 2);
    assert.ok(items.list().every((it) => it.typeId === b.id));
  });
});

describe('ItemsStore', () => {
  function setup() {
    const storage = new InMemoryStorage(createEmptyData());
    const items = new ItemsStore(storage);
    const typeId = storage.getData().types[0].id;
    return { storage, items, typeId };
  }

  it('creates an item with pending status and an initial history record', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'Idea' });
    assert.strictEqual(item.status, 'pending');
    assert.strictEqual(item.statusHistory.length, 1);
    assert.strictEqual(item.archived, false);
  });

  it('changing status appends a history entry without removing previous ones', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'Task' });
    items.changeStatus(item.id, 'in-progress');
    items.changeStatus(item.id, 'done');
    const updated = items.get(item.id)!;
    assert.strictEqual(updated.status, 'done');
    assert.strictEqual(updated.statusHistory.length, 3);
    assert.deepStrictEqual(updated.statusHistory.map((h) => h.status), ['pending', 'in-progress', 'done']);
  });

  it('completedAt returns the time of the last transition to done', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'Task' });
    items.changeStatus(item.id, 'done');
    const doneAt = items.completedAt(items.get(item.id)!);
    assert.ok(doneAt);
  });

  it('archiving does not change the status and saves archivedAt', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'Task' });
    items.changeStatus(item.id, 'done');
    items.setArchived(item.id, true);
    const updated = items.get(item.id)!;
    assert.strictEqual(updated.status, 'done');
    assert.strictEqual(updated.archived, true);
    assert.ok(updated.archivedAt);
  });

  it('the list hides archived items by default and shows them on demand', () => {
    const { items, typeId } = setup();
    const a = items.create({ typeId, title: 'A' });
    const b = items.create({ typeId, title: 'B' });
    items.setArchived(a.id, true);
    assert.strictEqual(items.list().length, 1);
    assert.strictEqual(items.list()[0].id, b.id);
    assert.strictEqual(items.list(true).length, 2);
  });

  it('deletion is permanent and distinct from archiving', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'Task' });
    items.delete(item.id);
    assert.strictEqual(items.get(item.id), undefined);
    assert.strictEqual(items.list(true).length, 0);
  });
});
