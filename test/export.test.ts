import * as assert from 'assert';
import { createEmptyData } from '../src/storage';
import { ItemsStore } from '../src/itemsStore';
import { TypesRegistry } from '../src/typesRegistry';
import { CategoriesRegistry } from '../src/categoriesRegistry';
import { STATUS_LABEL, buildMarkdownExport, buildWeeklyReportText, mergeData } from '../src/export';
import { buildWeeklyReport } from '../src/report';
import { GENERAL_CATEGORY_ID, MindStreamData, MindStreamItem } from '../src/models';
import { InMemoryStorage } from './helpers';

describe('STATUS_LABEL', () => {
  it('maps every status to a readable label', () => {
    assert.deepStrictEqual(STATUS_LABEL, {
      pending: 'None',
      'in-progress': 'In Progress',
      done: 'Done'
    });
  });
});

describe('buildMarkdownExport', () => {
  function setup() {
    const storage = new InMemoryStorage(createEmptyData());
    const items = new ItemsStore(storage);
    const types = new TypesRegistry(storage);
    const categories = new CategoriesRegistry(storage);
    return { storage, items, types, categories };
  }

  it('returns only the header for an empty store', () => {
    const { items, types, categories } = setup();
    assert.deepStrictEqual(buildMarkdownExport(items, types, categories), ['# MindStream Notes', '']);
  });

  it('renders type, status, category, created date and archived flag', () => {
    const { items, types, categories } = setup();
    const typeId = types.add('Bug').id;
    const item = items.create({ typeId, title: 'Fix crash', categoryId: GENERAL_CATEGORY_ID });
    item.createdAt = '2020-01-02T00:00:00.000Z';
    items.setArchived(item.id, true);

    const text = buildMarkdownExport(items, types, categories).join('\n');
    assert.ok(text.includes('## [Bug] Fix crash'));
    assert.ok(text.includes('- Status: None'));
    assert.ok(text.includes('- Category: General'));
    assert.ok(text.includes('- Created: 2020-01-02'));
    assert.ok(text.includes('- Archived'));
  });

  it('includes the completed line and description when present', () => {
    const { items, types, categories } = setup();
    const typeId = types.add('Fix').id;
    const item = items.create({ typeId, title: 'Task', description: 'Details here' });
    items.changeStatus(item.id, 'done');

    const text = buildMarkdownExport(items, types, categories).join('\n');
    assert.ok(text.includes('- Status: Done'));
    assert.ok(text.includes('- Completed: '));
    assert.ok(text.includes('Details here'));
  });
});

describe('buildWeeklyReportText', () => {
  function makeItems(): ItemsStore {
    return new ItemsStore(new InMemoryStorage(createEmptyData()));
  }

  it('renders the summary and both lists when populated', () => {
    const items = makeItems();
    const done = items.create({ typeId: 't', title: 'Done' });
    items.changeStatus(done.id, 'done');
    const wip = items.create({ typeId: 't', title: 'WIP' });
    items.changeStatus(wip.id, 'in-progress');

    const report = buildWeeklyReport(items, new Date());
    const text = buildWeeklyReportText(report).join('\n');

    assert.ok(text.includes(`Week of ${report.weekLabel}`));
    assert.ok(text.includes(`Created this week:   ${report.createdCount} notes`));
    assert.ok(text.includes('Completed:'));
    assert.ok(text.includes('- Done'));
    assert.ok(text.includes('In progress:'));
    assert.ok(text.includes('- WIP'));
  });

  it('omits the lists when empty', () => {
    const items = makeItems();
    const report = buildWeeklyReport(items, new Date());
    const text = buildWeeklyReportText(report).join('\n');
    assert.ok(!text.includes('Completed:'));
    assert.ok(!text.includes('In progress:'));
  });
});

describe('mergeData', () => {
  function data(partial: Partial<MindStreamData>): MindStreamData {
    return { version: 1, types: [], categories: [], items: [], ...partial };
  }

  function item(id: string): MindStreamItem {
    return {
      id,
      typeId: 't',
      categoryId: GENERAL_CATEGORY_ID,
      title: id,
      status: 'pending',
      statusHistory: [],
      archived: false,
      createdAt: 'x',
      updatedAt: 'x'
    };
  }

  it('merges types, categories and items by id without duplicates', () => {
    const target = data({
      types: [{ id: 't1', label: 'A', createdAt: 'x' }],
      categories: [{ id: 'c1', label: 'C', createdAt: 'x' }],
      items: [item('i1')]
    });
    const incoming = data({
      types: [
        { id: 't1', label: 'A', createdAt: 'x' },
        { id: 't2', label: 'B', createdAt: 'x' }
      ],
      categories: [{ id: 'c2', label: 'D', createdAt: 'x' }],
      items: [item('i1'), item('i2')]
    });

    mergeData(target, incoming);

    assert.deepStrictEqual(target.types.map((t) => t.id).sort(), ['t1', 't2']);
    assert.deepStrictEqual(target.categories.map((c) => c.id).sort(), ['c1', 'c2']);
    assert.deepStrictEqual(target.items.map((i) => i.id).sort(), ['i1', 'i2']);
  });

  it('does not mutate the incoming data', () => {
    const target = data({});
    const incoming = data({ types: [{ id: 't1', label: 'A', createdAt: 'x' }] });
    mergeData(target, incoming);
    assert.strictEqual(incoming.types.length, 1);
    assert.strictEqual(target.types.length, 1);
  });
});
