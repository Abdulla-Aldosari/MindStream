import { MindStreamData, MindStreamStatus } from "./models";
import { ItemsStore } from "./itemsStore";
import { TypesRegistry } from "./typesRegistry";
import { CategoriesRegistry } from "./categoriesRegistry";
import { formatDate, WeeklyReportData } from "./report";

/** Human-readable labels for each item status (used in exports). */
export const STATUS_LABEL: Record<MindStreamStatus, string> = {
  pending: "None",
  "in-progress": "In Progress",
  done: "Done",
};

/** Builds the Markdown export content (a list of lines) for all notes. */
export function buildMarkdownExport(items: ItemsStore, types: TypesRegistry, categories: CategoriesRegistry): string[] {
  const all = items.list(true);
  const lines: string[] = ["# MindStream Notes", ""];
  for (const it of all) {
    lines.push(`## [${types.label(it.typeId)}] ${it.title}`);
    lines.push(`- Status: ${STATUS_LABEL[it.status]}`);
    lines.push(`- Category: ${categories.label(it.categoryId)}`);
    lines.push(`- Created: ${formatDate(it.createdAt)}`);
    if (it.completedAt) {
      lines.push(`- Completed: ${formatDate(it.completedAt)}`);
    }
    if (it.archived) {
      lines.push("- Archived");
    }
    if (it.description) {
      lines.push("");
      lines.push(it.description);
    }
    if (it.tasks?.length) {
      lines.push("");
      for (const task of it.tasks) {
        lines.push(`- [${task.completed ? "x" : " "}] ${task.title}`);
      }
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines;
}

/** Builds the weekly report export content (a list of lines). */
export function buildWeeklyReportText(report: WeeklyReportData): string[] {
  const lines: string[] = [
    `MindStream Weekly Report — Week of ${report.weekLabel}`,
    "",
    `Created this week:   ${report.createdCount} notes`,
    `Completed this week: ${report.completedCount} notes`,
    `Currently in progress: ${report.inProgressCount} notes`,
    `Archived this week:  ${report.archivedCount} notes`,
    "",
  ];
  if (report.completed.length) {
    lines.push("Completed:");
    for (const it of report.completed) {
      lines.push(`- ${it.title}`);
    }
    lines.push("");
  }
  if (report.inProgress.length) {
    lines.push("In progress:");
    for (const it of report.inProgress) {
      lines.push(`- ${it.title}`);
    }
    lines.push("");
  }
  return lines;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStrings(entry: unknown, keys: string[]): boolean {
  return isRecord(entry) && keys.every((key) => typeof entry[key] === "string");
}

/**
 * Checks that parsed JSON really is a MindStream data file before anything is
 * offered to the user. Any JSON object is otherwise accepted by
 * `normalizeData`, which would let an unrelated file (for example VS Code's
 * settings.json) replace every note. One bad entry rejects the whole file, so
 * no note is dropped silently.
 */
export function validateImportData(parsed: unknown): { ok: true } | { ok: false; reason: string } {
  if (!isRecord(parsed)) {
    return { ok: false, reason: "it does not contain a data object" };
  }
  const sections: { key: "types" | "categories" | "items"; fields: string[] }[] = [
    { key: "types", fields: ["id", "label"] },
    { key: "categories", fields: ["id", "label"] },
    { key: "items", fields: ["id", "typeId", "categoryId", "title"] },
  ];
  for (const { key, fields } of sections) {
    const list = parsed[key];
    if (!Array.isArray(list)) {
      return { ok: false, reason: `it has no "${key}" list` };
    }
    const bad = list.findIndex((entry) => !hasStrings(entry, fields));
    if (bad !== -1) {
      return { ok: false, reason: `entry ${bad + 1} of "${key}" is missing one of: ${fields.join(", ")}` };
    }
  }
  return { ok: true };
}

/** Merges `incoming` data into `target` by id (no duplicates). Mutates `target`. */
export function mergeData(target: MindStreamData, incoming: MindStreamData): void {
  const typeIds = new Set(target.types.map((t) => t.id));
  for (const t of incoming.types) {
    if (!typeIds.has(t.id)) {
      target.types.push(t);
      typeIds.add(t.id);
    }
  }
  const categoryIds = new Set(target.categories.map((c) => c.id));
  for (const c of incoming.categories) {
    if (!categoryIds.has(c.id)) {
      target.categories.push(c);
      categoryIds.add(c.id);
    }
  }
  const itemIds = new Set(target.items.map((i) => i.id));
  for (const i of incoming.items) {
    if (!itemIds.has(i.id)) {
      target.items.push(i);
      itemIds.add(i.id);
    }
  }
}
