import * as assert from 'assert';
import { createEmptyData } from '../src/storage';
import { ItemsStore } from '../src/itemsStore';
import { GENERAL_CATEGORY_ID } from '../src/models';
import { InMemoryStorage } from './helpers';

function setup() {
  const storage = new InMemoryStorage(createEmptyData());
  const items = new ItemsStore(storage);
  const typeId = storage.getData().types[0].id;
  return { storage, items, typeId };
}

describe('ItemsStore', () => {
  it('create defaults categoryId to General and status to pending', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'Idea' });
    assert.strictEqual(item.categoryId, GENERAL_CATEGORY_ID);
    assert.strictEqual(item.status, 'pending');
    assert.strictEqual(item.archived, false);
    assert.strictEqual(item.statusHistory.length, 1);
  });

  it('create persists description, categoryId, tags and status', () => {
    const { items, typeId } = setup();
    const item = items.create({
      typeId,
      title: 'T',
      description: 'Desc',
      categoryId: 'cat-x',
      tags: ['a', 'b'],
      status: 'done'
    });
    assert.strictEqual(item.description, 'Desc');
    assert.strictEqual(item.categoryId, 'cat-x');
    assert.deepStrictEqual(item.tags, ['a', 'b']);
    assert.strictEqual(item.status, 'done');
    assert.strictEqual(item.statusHistory[0].status, 'done');
  });

  it('get returns an item or undefined', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'X' });
    assert.strictEqual(items.get(item.id)?.title, 'X');
    assert.strictEqual(items.get('missing'), undefined);
  });

  it('update patches provided fields and bumps updatedAt', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'A' });
    items.update(item.id, { title: 'B', description: 'D', tags: ['x'] });
    const u = items.get(item.id)!;
    assert.strictEqual(u.title, 'B');
    assert.strictEqual(u.description, 'D');
    assert.deepStrictEqual(u.tags, ['x']);
    assert.ok(u.updatedAt >= item.updatedAt);
  });

  it('update ignores unknown ids and leaves unspecified fields unchanged', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'A', description: 'Keep' });
    items.update('missing', { title: 'X' });
    items.update(item.id, { title: 'B' });
    assert.strictEqual(items.get(item.id)!.description, 'Keep');
  });

  it('changeStatus appends history without removing previous entries', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'Task' });
    items.changeStatus(item.id, 'in-progress');
    items.changeStatus(item.id, 'done');
    const updated = items.get(item.id)!;
    assert.strictEqual(updated.status, 'done');
    assert.strictEqual(updated.statusHistory.length, 3);
    assert.deepStrictEqual(
      updated.statusHistory.map((h) => h.status),
      ['pending', 'in-progress', 'done']
    );
  });

  it('changeStatus is a no-op when the status is unchanged', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'A' });
    items.changeStatus(item.id, 'pending');
    assert.strictEqual(items.get(item.id)!.statusHistory.length, 1);
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

  it('setArchived clears archivedAt when unarchiving', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'A' });
    items.setArchived(item.id, true);
    items.setArchived(item.id, false);
    const u = items.get(item.id)!;
    assert.strictEqual(u.archived, false);
    assert.strictEqual(u.archivedAt, undefined);
  });

  it('setArchived is a no-op when the state is unchanged', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'A' });
    items.setArchived(item.id, false);
    assert.strictEqual(items.get(item.id)!.archived, false);
    assert.strictEqual(items.get(item.id)!.archivedAt, undefined);
  });

  it('deletion is permanent and distinct from archiving', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'Task' });
    items.delete(item.id);
    assert.strictEqual(items.get(item.id), undefined);
    assert.strictEqual(items.list(true).length, 0);
  });

  it('deleteByCategory removes only that category items', () => {
    const { items, typeId } = setup();
    items.create({ typeId, title: 'A', categoryId: 'c1' });
    items.create({ typeId, title: 'B', categoryId: 'c2' });
    items.deleteByCategory('c1');
    assert.strictEqual(items.list(true).length, 1);
    assert.strictEqual(items.list(true)[0].title, 'B');
  });

  it('completedAt returns the last done time or undefined', () => {
    const { items, typeId } = setup();
    const item = items.create({ typeId, title: 'A' });
    assert.strictEqual(items.completedAt(item), undefined);
    items.changeStatus(item.id, 'done');
    items.changeStatus(item.id, 'in-progress');
    items.changeStatus(item.id, 'done');
    assert.ok(items.completedAt(items.get(item.id)!));
  });

  it('list hides archived by default and shows on demand', () => {
    const { items, typeId } = setup();
    const a = items.create({ typeId, title: 'A' });
    items.create({ typeId, title: 'B' });
    items.setArchived(a.id, true);
    assert.strictEqual(items.list().length, 1);
    assert.strictEqual(items.list(true).length, 2);
  });

  it('list returns a stable creation order', () => {
    const { storage, items, typeId } = setup();
    const a = items.create({ typeId, title: 'A' });
    const b = items.create({ typeId, title: 'B' });
    const c = items.create({ typeId, title: 'C' });
    storage.getData().items.find((x) => x.id === a.id)!.createdAt = '2020-01-01T00:00:00.000Z';
    storage.getData().items.find((x) => x.id === b.id)!.createdAt = '2020-01-02T00:00:00.000Z';
    storage.getData().items.find((x) => x.id === c.id)!.createdAt = '2020-01-03T00:00:00.000Z';
    assert.deepStrictEqual(
      items.list().map((x) => x.id),
      [a.id, b.id, c.id]
    );
  });
});
