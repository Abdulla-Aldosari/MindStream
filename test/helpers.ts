import { MindStreamData } from "../src/models";
import { IStorage, StorageError, StorageProblem, blockedSaveMessage } from "../src/storage";

/**
 * In-memory storage for tests (tracks the last saved state). Set `problem` to
 * make every save fail exactly like a blocked `StorageService`: the save throws
 * and the in-memory data goes back to the last saved state.
 */
export class InMemoryStorage implements IStorage {
  data: MindStreamData;
  saved: MindStreamData[] = [];
  problem: StorageProblem | undefined;
  private committed: string;

  constructor(data: MindStreamData) {
    this.data = data;
    this.committed = JSON.stringify(data);
  }

  getData(): MindStreamData {
    return this.data;
  }

  saveData(data: MindStreamData): void {
    if (this.problem) {
      this.data = JSON.parse(this.committed);
      throw new StorageError("STORAGE_BLOCKED", blockedSaveMessage(this.problem));
    }
    this.data = data;
    this.committed = JSON.stringify(data);
    this.saved.push(JSON.parse(this.committed));
  }

  /** No real external backend to diff against in-memory; never reports an external change. */
  reloadIfExternal(): boolean {
    return false;
  }

  getProblem(): StorageProblem | undefined {
    return this.problem;
  }
}

/** A problem that blocks every save, for tests. */
export const BLOCKED: StorageProblem = {
  kind: "invalid",
  message: "The data file is not valid.",
  howToFix: "Fix the file.",
};
