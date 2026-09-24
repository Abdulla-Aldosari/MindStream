import * as assert from 'assert';
import { createEmptyData } from '../src/storage';
import { CategoriesRegistry } from '../src/categoriesRegistry';
import { ItemsStore } from '../src/itemsStore';
import { GENERAL_CATEGORY_ID } from '../src/models';
import { InMemoryStorage } from './helpers';

function setup() {
  const storage = new InMemoryStorage(createEmptyData());
  return { storage, categories: new CategoriesRegistry(storage), items: new ItemsStore(storage) };
}

describe('CategoriesRegistry', () => {
  it('starts with the default General category', () => {
    const { categories } = setup();
    assert.strictEqual(categories.list().length, 1);
    assert.strictEqual(categories.list()[0].id, GENERAL_CATEGORY_ID);
  });

  it('get returns a category or undefined', () => {
    const { categories } = setup();
    assert.strictEqual(categories.get(GENERAL_CATEGORY_ID)?.label, 'General');
    assert.strictEqual(categories.get('missing'), undefined);
  });

  it('label falls back to "(Deleted category)"', () => {
    const { categories } = setup();
    assert.strictEqual(categories.label('missing'), '(Deleted category)');
  });

  it('add creates a category with increasing order', () => {
    const { categories } = setup();
    const a = categories.add('A');
    const b = categories.add('B');
    assert.ok(b.order! > a.order!);
    const ids = categories.list().map((c) => c.id);
    assert.ok(ids.indexOf(a.id) < ids.indexOf(b.id));
  });

  it('rename updates the label', () => {
    const { categories } = setup();
    const cat = categories.add('Temp');
    categories.rename(cat.id, 'Pre-Launch');
    assert.strictEqual(categories.label(cat.id), 'Pre-Launch');
  });

  it('rename ignores unknown ids', () => {
    const { categories } = setup();
    categories.rename('missing', 'X');
    // no throw
  });

  it('remove returns false for unknown and for the default category', () => {
    const { categories } = setup();
    assert.strictEqual(categories.remove('missing'), false);
    assert.strictEqual(categories.remove(GENERAL_CATEGORY_ID), false);
  });

  it('remove deletes a non-default category', () => {
    const { categories } = setup();
    const cat = categories.add('Temp');
    assert.strictEqual(categories.remove(cat.id), true);
    assert.strictEqual(categories.get(cat.id), undefined);
  });

  it('countItems counts archived items too', () => {
    const { categories, items } = setup();
    const cat = categories.add('C');
    const item = items.create({ typeId: 't', title: 'X', categoryId: cat.id });
    items.setArchived(item.id, true);
    assert.strictEqual(categories.countItems(cat.id), 1);
  });
});
