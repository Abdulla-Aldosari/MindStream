import * as vscode from 'vscode';
import { StorageService } from './storage';

/**
 * Creates a storage service bound to the actual open workspace folder (the visible project root).
 * Writes `.mindstream/data.json` inside that folder.
 * Returns null if no workspace folder is open.
 */
export function createWorkspaceStorage(folder: vscode.WorkspaceFolder | undefined): StorageService | null {
  if (!folder) {
    return null;
  }
  return StorageService.forDir(folder.uri.fsPath);
}

