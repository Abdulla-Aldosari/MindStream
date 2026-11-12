import { MindStreamWorkPauseNote } from "./models";
import { IStorage } from "./storage";
import { nowIso } from "./util";
import { MAX_WORK_PAUSE_TEXT, normalizeWorkPauseNote } from "./workPause";

/**
 * Reads and writes the single Work Pause note stored under
 * `MindStreamData.workPauseNote`. Invariant: a saved text is never empty, and
 * work is only paused while the note has text.
 */
export class WorkPauseStore {
  constructor(
    private readonly storage: IStorage,
    private readonly now: () => string = nowIso
  ) {}

  /** The current note; a never-saved note reads as empty and not paused. */
  get(): MindStreamWorkPauseNote {
    return normalizeWorkPauseNote(this.storage.getData().workPauseNote) ?? { text: "", updatedAt: "", paused: false };
  }

  isPaused(): boolean {
    return this.get().paused;
  }

  /**
   * Saves the text (trimmed, capped), optionally pausing work. Returns false and
   * changes nothing when the value is not a non-empty string. `updatedAt` only
   * moves when the text actually changes.
   */
  save(raw: unknown, pause = false): boolean {
    if (typeof raw !== "string") {
      return false;
    }
    const text = raw.trim().slice(0, MAX_WORK_PAUSE_TEXT);
    if (!text) {
      return false;
    }
    const current = this.get();
    const changed = text !== current.text || !current.updatedAt;
    this.write({
      text,
      updatedAt: changed ? this.now() : current.updatedAt,
      paused: pause ? true : current.paused,
    });
    return true;
  }

  /** Pauses work (locks the UI). Returns false (and stays running) when there is no text yet. */
  pause(): boolean {
    const current = this.get();
    if (!current.text.trim()) {
      return false;
    }
    if (!current.paused) {
      this.write({ ...current, paused: true });
    }
    return true;
  }

  /** Resumes work (unlocks the UI); the text is kept. */
  resume(): void {
    const current = this.get();
    if (current.paused) {
      this.write({ ...current, paused: false });
    }
  }

  private write(note: MindStreamWorkPauseNote): void {
    const data = this.storage.getData();
    data.workPauseNote = note;
    this.storage.saveData(data);
  }
}
