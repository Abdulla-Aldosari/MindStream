import * as assert from 'assert';
import { createEmptyData } from '../src/storage';
import { TypesRegistry } from '../src/typesRegistry';
import { ItemsStore } from '../src/itemsStore';
import { InMemoryStorage } from './helpers';

function setup() {
  const storage = new InMemoryStorage(createEmptyData());
  return { storage, types: new TypesRegistry(storage), items: new ItemsStore(storage) };
}

describe('TypesRegistry', () => {
  it('adds a type with an increasing order value', () => {
    const { types } = setup();
    const first = types.add('A');
    const second = types.add('B');
    assert.ok(second.order! > first.order!);
  });

  it('add accepts an optional icon', () => {
    const { types } = setup();
    const def = types.add('Bug', 'bug');
    assert.strictEqual(def.icon, 'bug');
  });

  it('list returns added types in ascending order', () => {
    const { types } = setup();
    const a = types.add('A');
    const b = types.add('B');
    const ids = types.list().map((t) => t.id);
    assert.ok(ids.indexOf(a.id) < ids.indexOf(b.id));
  });

  it('get returns the definition or undefined for unknown ids', () => {
    const { types } = setup();
    const def = types.add('Fix');
    assert.strictEqual(types.get(def.id)?.label, 'Fix');
    assert.strictEqual(types.get('missing'), undefined);
  });

  it('label falls back to "(Deleted type)" for unknown ids', () => {
    const { types } = setup();
    assert.strictEqual(types.label('missing'), '(Deleted type)');
  });

  it('rename updates the label', () => {
    const { types } = setup();
    const def = types.add('Fix');
    types.rename(def.id, 'Bug fix');
    assert.strictEqual(types.label(def.id), 'Bug fix');
  });

  it('rename ignores unknown ids', () => {
    const { types } = setup();
    types.rename('missing', 'Nope');
    // no throw, nothing changes
  });

  it('setIcon updates the icon', () => {
    const { types } = setup();
    const def = types.add('Fix', 'wrench');
    types.setIcon(def.id, 'bug');
    assert.strictEqual(types.get(def.id)?.icon, 'bug');
  });

  it('setIcon ignores unknown ids', () => {
    const { types } = setup();
    types.setIcon('missing', 'bug');
    // no throw
  });

  it('deleting a type keeps its records and shows "(Deleted type)"', () => {
    const { types, items } = setup();
    const def = types.add('Fix');
    items.create({ typeId: def.id, title: 'Fix something' });
    const affected = types.remove(def.id);
    assert.strictEqual(affected, 1);
    assert.strictEqual(types.label(def.id), '(Deleted type)');
    assert.strictEqual(items.list()[0].typeId, def.id);
  });

  it('reassign moves items and updates their updatedAt', () => {
    const { types, items } = setup();
    const a = types.add('A');
    const b = types.add('B');
    const item = items.create({ typeId: a.id, title: 'X' });
    const moved = types.reassign(a.id, b.id);
    assert.strictEqual(moved, 1);
    const updated = items.get(item.id)!;
    assert.strictEqual(updated.typeId, b.id);
    assert.ok(updated.updatedAt >= item.updatedAt);
  });

  it('countItems counts archived items too', () => {
    const { types, items } = setup();
    const def = types.add('Fix');
    const item = items.create({ typeId: def.id, title: 'X' });
    items.setArchived(item.id, true);
    assert.strictEqual(types.countItems(def.id), 1);
  });
});
