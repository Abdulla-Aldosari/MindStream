import { MindStreamData } from '../src/models';
import { IStorage } from '../src/storage';

/** In-memory storage for tests (tracks the last saved state). */
export class InMemoryStorage implements IStorage {
  data: MindStreamData;
  saved: MindStreamData[] = [];

  constructor(data: MindStreamData) {
    this.data = data;
  }

  getData(): MindStreamData {
    return this.data;
  }

  saveData(data: MindStreamData): void {
    this.data = data;
    this.saved.push(JSON.parse(JSON.stringify(data)));
  }
}
