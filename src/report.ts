import { MindStreamItem } from './models';
import { ItemsStore } from './itemsStore';

/** Data needed to render the weekly report (summary numbers + the records themselves). */
export interface WeeklyReportData {
  weekLabel: string;
  createdCount: number;
  completedCount: number;
  inProgressCount: number;
  archivedCount: number;
  completed: MindStreamItem[];
  inProgress: MindStreamItem[];
}

/** Formats an ISO timestamp as a plain YYYY-MM-DD date. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/** Monday of the week containing the given date. */
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Builds the weekly report from the items store (considers archived items too). */
export function buildWeeklyReport(items: ItemsStore, now: Date = new Date()): WeeklyReportData {
  const weekStart = startOfWeek(now).getTime();
  const all = items.list(true);
  const created = all.filter((it) => new Date(it.createdAt).getTime() >= weekStart);
  const completed = all.filter((it) => {
    const at = items.completedAt(it);
    return at ? new Date(at).getTime() >= weekStart : false;
  });
  const inProgress = all.filter((it) => it.status === 'in-progress');
  const archived = all.filter((it) => it.archivedAt && new Date(it.archivedAt).getTime() >= weekStart);
  return {
    weekLabel: formatDate(now.toISOString()),
    createdCount: created.length,
    completedCount: completed.length,
    inProgressCount: inProgress.length,
    archivedCount: archived.length,
    completed,
    inProgress
  };
}
