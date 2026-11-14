import * as fs from "fs";
import { ItemsStore } from "./itemsStore";
import { TypesRegistry } from "./typesRegistry";
import { CategoriesRegistry } from "./categoriesRegistry";
import { IStorage, StorageError, normalizeData } from "./storage";
import { buildMarkdownExport, buildWeeklyReportText, mergeData } from "./export";
import { buildWeeklyReport } from "./report";

/** Minimal stand-in for `vscode.Uri` so command logic stays free of the `vscode` module. */
export interface UriLike {
  fsPath: string;
}

/** I/O surface the command handlers depend on (injected for testability). */
export interface CommandsDeps {
  readonly workspacePath: string | undefined;
  joinPath(basePath: string, fileName: string): UriLike;
  showSaveDialog(defaultUri: UriLike | undefined, filters: Record<string, string[]>): Promise<UriLike | undefined>;
  showOpenDialog(): Promise<UriLike[] | undefined>;
  showWarningMessage(message: string, options: { modal: boolean } | undefined, ...items: string[]): Promise<string | undefined>;
  showInformationMessage(message: string): Promise<unknown>;
  showErrorMessage(message: string): Promise<unknown>;
  executeCommand(command: string): Promise<unknown>;
}

async function saveDialog(deps: CommandsDeps, fileName: string, filters: Record<string, string[]>): Promise<UriLike | undefined> {
  const defaultUri = deps.workspacePath ? deps.joinPath(deps.workspacePath, fileName) : undefined;
  return deps.showSaveDialog(defaultUri, filters);
}

export async function requireWorkspace(deps: CommandsDeps): Promise<void> {
  const pick = await deps.showWarningMessage("MindStream: Open a folder (project) first to start recording notes.", undefined, "Open Folder");
  if (pick === "Open Folder") {
    await deps.executeCommand("vscode.openFolder");
  }
}

export async function exportMarkdown(deps: CommandsDeps, items: ItemsStore, types: TypesRegistry, categories: CategoriesRegistry): Promise<void> {
  const all = items.list(true);
  if (all.length === 0) {
    await deps.showInformationMessage("MindStream: There are no notes to export.");
    return;
  }
  const lines = buildMarkdownExport(items, types, categories);
  const uri = await saveDialog(deps, "mindstream-notes.md", { Markdown: ["md"] });
  if (!uri) {
    return;
  }
  fs.writeFileSync(uri.fsPath, lines.join("\n"), "utf8");
  await deps.showInformationMessage(`MindStream: Exported ${all.length} note(s) to Markdown.`);
}

export async function exportJson(deps: CommandsDeps, storage: IStorage): Promise<void> {
  const uri = await saveDialog(deps, "mindstream-data.json", { JSON: ["json"] });
  if (!uri) {
    return;
  }
  fs.writeFileSync(uri.fsPath, JSON.stringify(storage.getData(), null, 2), "utf8");
  await deps.showInformationMessage("MindStream: Exported data to JSON.");
}

/**
 * Imports a JSON data file. `Merge` adds missing types/categories/notes and
 * keeps the current Work Pause note; `Replace` swaps in the file's data,
 * including its Work Pause note (always imported as not paused). Does nothing
 * while the Work Pause lock is on. While the data file cannot be saved, it
 * explains why and changes nothing.
 */
export async function importJson(deps: CommandsDeps, storage: IStorage, refresh: () => void): Promise<void> {
  if (storage.getData().workPauseNote?.paused === true) {
    return;
  }
  const problem = storage.getProblem();
  if (problem) {
    await deps.showErrorMessage(`MindStream: Import is not possible right now. ${problem.message} Nothing was changed. ${problem.howToFix}`);
    return;
  }
  const uris = await deps.showOpenDialog();
  if (!uris || uris.length === 0) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(uris[0].fsPath, "utf8"));
  } catch (err) {
    await deps.showErrorMessage(`MindStream: Could not read the selected file: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const incoming = normalizeData(parsed);
  // An import never turns the lock on: the user must not be locked out by a file.
  if (incoming.workPauseNote) {
    incoming.workPauseNote = { ...incoming.workPauseNote, paused: false };
  }
  const current = storage.getData();
  const report = [
    "MindStream - Import JSON",
    "",
    `Current: ${current.items.length} notes, ${current.types.length} types, ${current.categories.length} categories`,
    `Imported: ${incoming.items.length} notes, ${incoming.types.length} types, ${incoming.categories.length} categories`,
  ].join("\n");
  const choice = await deps.showWarningMessage(report, { modal: true }, "Merge", "Replace");
  if (choice !== "Merge" && choice !== "Replace") {
    return;
  }
  try {
    if (choice === "Merge") {
      // Read again: the data may have been reloaded while the dialog was open.
      const latest = storage.getData();
      mergeData(latest, incoming);
      storage.saveData(latest);
    } else {
      storage.saveData(incoming);
    }
  } catch (err) {
    if (err instanceof StorageError) {
      await deps.showErrorMessage(`MindStream: ${err.message}`);
      return;
    }
    throw err;
  }
  refresh();
  await deps.showInformationMessage(choice === "Merge" ? "MindStream: Imported and merged data." : "MindStream: Replaced data with the imported file.");
}

export async function exportWeeklyReport(deps: CommandsDeps, items: ItemsStore): Promise<void> {
  const report = buildWeeklyReport(items);
  const lines = buildWeeklyReportText(report);
  const uri = await saveDialog(deps, `weekly-report-${report.weekLabel}.md`, { Markdown: ["md"] });
  if (!uri) {
    return;
  }
  fs.writeFileSync(uri.fsPath, lines.join("\n"), "utf8");
  await deps.showInformationMessage("MindStream: Exported weekly report.");
}
