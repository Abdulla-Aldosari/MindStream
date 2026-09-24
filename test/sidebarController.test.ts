import * as assert from 'assert';
import { createEmptyData } from '../src/storage';
import { ItemsStore } from '../src/itemsStore';
import { TypesRegistry } from '../src/typesRegistry';
import { CategoriesRegistry } from '../src/categoriesRegistry';
import { SidebarController, SidebarUi } from '../src/sidebarController';
import { InMemoryStorage } from './helpers';

class FakeUi implements SidebarUi {
  confirmDeleteNoteResult = true;
  confirmDeleteCategoryResult = true;
  confirmDeleteTypeResult = true;
  infos: string[] = [];
  confirmedNotes: string[] = [];
  confirmedCategories: { label: string; count: number }[] = [];
  confirmedTypes: string[] = [];

  async confirmDeleteNote(title: string): Promise<boolean> {
    this.confirmedNotes.push(title);
    return this.confirmDeleteNoteResult;
  }

  async confirmDeleteCategory(label: string, count: number): Promise<boolean> {
    this.confirmedCategories.push({ label, count });
    return this.confirmDeleteCategoryResult;
  }

  async confirmDeleteType(label: string): Promise<boolean> {
    this.confirmedTypes.push(label);
    return this.confirmDeleteTypeResult;
  }

  showInfo(message: string): void {
    this.infos.push(message);
  }
}

function setup() {
  const storage = new InMemoryStorage(createEmptyData());
  const items = new ItemsStore(storage);
  const types = new TypesRegistry(storage);
  const categories = new CategoriesRegistry(storage);
  const ui = new FakeUi();
  const controller = new SidebarController(items, types, categories, ui);
  const typeId = storage.getData().types[0].id;
  return { storage, items, types, categories, ui, controller, typeId };
}

describe('SidebarController.handleMessage', () => {
  it('addItem creates a note with a trimmed title', async () => {
    const { items, controller, typeId } = setup();
    await controller.handleMessage({ type: 'addItem', title: '  Idea  ', typeId });
    assert.strictEqual(items.list().length, 1);
    assert.strictEqual(items.list()[0].title, 'Idea');
  });

  it('addItem ignores a blank title', async () => {
    const { items, controller, typeId } = setup();
    await controller.handleMessage({ type: 'addItem', title: '   ', typeId });
    assert.strictEqual(items.list().length, 0);
  });

  it('updateItem patches the provided fields', async () => {
    const { items, controller, typeId } = setup();
    const item = items.create({ typeId, title: 'A' });
    await controller.handleMessage({ type: 'updateItem', id: item.id, title: 'B' });
    assert.strictEqual(items.get(item.id)!.title, 'B');
  });

  it('deleteItem confirms before deleting', async () => {
    const { items, ui, controller, typeId } = setup();
    const item = items.create({ typeId, title: 'Task' });
    await controller.handleMessage({ type: 'deleteItem', id: item.id });
    assert.deepStrictEqual(ui.confirmedNotes, ['Task']);
    assert.strictEqual(items.get(item.id), undefined);
  });

  it('deleteItem keeps the note when the user cancels', async () => {
    const { items, ui, controller, typeId } = setup();
    const item = items.create({ typeId, title: 'Keep' });
    ui.confirmDeleteNoteResult = false;
    await controller.handleMessage({ type: 'deleteItem', id: item.id });
    assert.ok(items.get(item.id));
  });

  it('deleteItem does not prompt for an unknown id', async () => {
    const { ui, controller } = setup();
    await controller.handleMessage({ type: 'deleteItem', id: 'missing' });
    assert.strictEqual(ui.confirmedNotes.length, 0);
  });

  it('changeStatus updates the status', async () => {
    const { items, controller, typeId } = setup();
    const item = items.create({ typeId, title: 'A' });
    await controller.handleMessage({ type: 'changeStatus', id: item.id, status: 'done' });
    assert.strictEqual(items.get(item.id)!.status, 'done');
  });

  it('toggleArchive archives the note', async () => {
    const { items, controller, typeId } = setup();
    const item = items.create({ typeId, title: 'A' });
    await controller.handleMessage({ type: 'toggleArchive', id: item.id, archived: true });
    assert.strictEqual(items.get(item.id)!.archived, true);
  });

  it('addCategory adds a trimmed label', async () => {
    const { categories, controller } = setup();
    await controller.handleMessage({ type: 'addCategory', label: '  Before Release  ' });
    assert.ok(categories.list().some((c) => c.label === 'Before Release'));
  });

  it('renameCategory renames the category', async () => {
    const { categories, controller } = setup();
    const cat = categories.add('Temp');
    await controller.handleMessage({ type: 'renameCategory', id: cat.id, label: 'Pre-Launch' });
    assert.strictEqual(categories.label(cat.id), 'Pre-Launch');
  });

  it('deleteCategory confirms with the item count and removes both', async () => {
    const { items, categories, ui, controller, typeId } = setup();
    const cat = categories.add('C');
    items.create({ typeId, title: 'X', categoryId: cat.id });
    await controller.handleMessage({ type: 'deleteCategory', id: cat.id });
    assert.deepStrictEqual(ui.confirmedCategories, [{ label: 'C', count: 1 }]);
    assert.strictEqual(categories.get(cat.id), undefined);
    assert.strictEqual(items.list(true).length, 0);
  });

  it('deleteCategory keeps the category when the user cancels', async () => {
    const { categories, ui, controller } = setup();
    const cat = categories.add('C');
    ui.confirmDeleteCategoryResult = false;
    await controller.handleMessage({ type: 'deleteCategory', id: cat.id });
    assert.ok(categories.get(cat.id));
  });

  it('addType adds a type with an icon', async () => {
    const { types, controller } = setup();
    await controller.handleMessage({ type: 'addType', label: 'Bug', icon: 'bug' });
    assert.ok(types.list().some((t) => t.label === 'Bug' && t.icon === 'bug'));
  });

  it('renameType renames the type', async () => {
    const { types, controller } = setup();
    const def = types.add('Fix');
    await controller.handleMessage({ type: 'renameType', id: def.id, label: 'Patch' });
    assert.strictEqual(types.label(def.id), 'Patch');
  });

  it('setTypeIcon updates the icon', async () => {
    const { types, controller } = setup();
    const def = types.add('Fix');
    await controller.handleMessage({ type: 'setTypeIcon', id: def.id, icon: 'wrench' });
    assert.strictEqual(types.get(def.id)!.icon, 'wrench');
  });

  it('deleteType blocks deletion and shows info when the type is in use', async () => {
    const { items, types, ui, controller } = setup();
    const def = types.add('Fix');
    items.create({ typeId: def.id, title: 'X' });
    await controller.handleMessage({ type: 'deleteType', id: def.id });
    assert.ok(types.get(def.id));
    assert.strictEqual(ui.confirmedTypes.length, 0);
    assert.strictEqual(ui.infos.length, 1);
  });

  it('deleteType confirms and removes an unused type', async () => {
    const { types, ui, controller } = setup();
    const def = types.add('Fix');
    await controller.handleMessage({ type: 'deleteType', id: def.id });
    assert.deepStrictEqual(ui.confirmedTypes, ['Fix']);
    assert.strictEqual(types.get(def.id), undefined);
  });

  it('deleteType keeps the type when the user cancels', async () => {
    const { types, ui, controller } = setup();
    const def = types.add('Fix');
    ui.confirmDeleteTypeResult = false;
    await controller.handleMessage({ type: 'deleteType', id: def.id });
    assert.ok(types.get(def.id));
  });
});
