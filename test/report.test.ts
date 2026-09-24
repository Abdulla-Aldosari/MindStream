import * as assert from 'assert';
import { createEmptyData } from '../src/storage';
import { ItemsStore } from '../src/itemsStore';
import { buildWeeklyReport, formatDate } from '../src/report';
import { InMemoryStorage } from './helpers';

describe('formatDate', () => {
  it('formats a valid ISO timestamp as YYYY-MM-DD', () => {
    assert.strictEqual(formatDate('2020-03-05T12:00:00.000Z'), '2020-03-05');
  });

  it('returns the original string for invalid input', () => {
    assert.strictEqual(formatDate('not-a-date'), 'not-a-date');
  });
});

describe('buildWeeklyReport', () => {
  function makeStore(): ItemsStore {
    return new ItemsStore(new InMemoryStorage(createEmptyData()));
  }

  it('counts created, completed, in-progress and archived within the injected week', () => {
    const items = makeStore();
    const now = new Date();

    items.create({ typeId: 't', title: 'New' });
    const doneNow = items.create({ typeId: 't', title: 'Done' });
    items.changeStatus(doneNow.id, 'done');
    const inProg = items.create({ typeId: 't', title: 'WIP' });
    items.changeStatus(inProg.id, 'in-progress');
    const archNow = items.create({ typeId: 't', title: 'Arch' });
    items.setArchived(archNow.id, true);

    // Item created long ago must be excluded from this-week counts.
    const oldItem = items.create({ typeId: 't', title: 'Old' });
    oldItem.createdAt = '2000-01-01T00:00:00.000Z';

    const report = buildWeeklyReport(items, now);

    assert.strictEqual(report.createdCount, 4);
    assert.strictEqual(report.completedCount, 1);
    assert.strictEqual(report.inProgressCount, 1);
    assert.strictEqual(report.archivedCount, 1);
    assert.strictEqual(report.weekLabel, formatDate(now.toISOString()));
  });

  it('excludes items completed before the week', () => {
    const items = makeStore();
    const now = new Date();

    const oldDone = items.create({ typeId: 't', title: 'Old done' });
    items.changeStatus(oldDone.id, 'done');
    const stored = items.get(oldDone.id)!;
    stored.statusHistory[stored.statusHistory.length - 1].at = '2000-01-01T00:00:00.000Z';

    const report = buildWeeklyReport(items, now);
    assert.strictEqual(report.completedCount, 0);
  });
});
