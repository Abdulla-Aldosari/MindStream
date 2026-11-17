import { MindStreamLink, MindStreamStatus } from "./models";
import { DEFAULT_PRIORITY, isPriority } from "./priority";
import { ItemsStore } from "./itemsStore";
import { TypesRegistry } from "./typesRegistry";
import { CategoriesRegistry } from "./categoriesRegistry";
import { DEFAULT_EMOJI_PALETTE, EmojiRegistry } from "./emojiRegistry";
import { UiPrefsRegistry } from "./uiPrefs";
import { WorkPauseStore } from "./workPauseStore";
import { LinkTracker } from "./linkTracker";
import { isAllowedDuringWorkPause } from "./workPause";
import { sanitizeTasks } from "./tasks";

export interface WebviewMessage {
  type:
    | "refresh"
    | "addItem"
    | "updateItem"
    | "deleteItem"
    | "changeStatus"
    | "toggleArchive"
    | "toggleArchiveView"
    | "addCategory"
    | "renameCategory"
    | "deleteCategory"
    | "setCategoryDefaultType"
    | "addType"
    | "renameType"
    | "setTypeIcon"
    | "deleteType"
    | "recordEmojiUse"
    | "updateEmojiPalette"
    | "restoreEmojiPalette"
    | "setDescriptionHeight"
    | "copyToClipboard"
    | "openLink"
    | "saveWorkPauseNote"
    | "confirmDiscardWorkPauseDraft"
    | "openDescriptionEditor"
    | "closeDescriptionEditor"
    | "setTaskCompleted";
  id?: string;
  /** `saveWorkPauseNote` only: also pause work (lock the UI) once saved. */
  pause?: boolean;
  /**
   * Set by the webview on `addItem` when the open form was started from the
   * editor context menu. The link itself never comes from the webview: the
   * host keeps it (see `SidebarController.setPendingLink`).
   */
  linked?: boolean;
  /** `addItem`/`updateItem`: id of the editor's Save, echoed back by `SidebarUi.answerNoteSave`. */
  saveId?: number;
  title?: string;
  description?: string;
  typeId?: string;
  categoryId?: string;
  label?: string;
  icon?: string;
  status?: MindStreamStatus;
  /** Raw value from the webview; only a valid level is stored (see isPriority). */
  priority?: unknown;
  archived?: boolean;
  emoji?: string;
  palette?: string[];
  height?: number;
  text?: string;
  /** `addItem`/`updateItem`: the editor's raw task list, cleaned by `sanitizeTasks`. */
  tasks?: unknown;
  /** `setTaskCompleted`: position of the task, its expected title, and the new value. */
  index?: number;
  completed?: boolean;
}

/** User-facing confirmations and notices the controller needs from the host. */
export interface SidebarUi {
  confirmDeleteNote(title: string): Promise<boolean>;
  confirmDeleteCategory(label: string, count: number): Promise<boolean>;
  confirmDeleteType(label: string): Promise<boolean>;
  confirmRestoreEmojiPalette(): Promise<boolean>;
  /** Asks before throwing away an unsaved Work Pause draft (Cancel or Esc while editing). */
  confirmDiscardWorkPauseDraft(): Promise<boolean>;
  /** Sends the user's answer to that question back to the webview. */
  answerWorkPauseDiscard(discard: boolean): void;
  pickType(types: { id: string; label: string; icon?: string }[]): Promise<string | undefined>;
  showInfo(message: string): void;
  /**
   * Tells the webview whether the note editor's Save (`addItem`/`updateItem`)
   * was stored. The editor closes only on success, so a refused save never
   * loses what the user typed.
   */
  answerNoteSave(saveId: number | undefined, ok: boolean): void;
  /**
   * Shows the note form's description in an editor tab (or reveals the tab when
   * it is already open). The text goes back to the form as the user edits it;
   * nothing is stored until the form's own Save.
   */
  openDescriptionEditor(title: string, text: string): Promise<void>;
  /** Ends the description draft and closes its tab. */
  closeDescriptionEditor(): Promise<void>;
}

/**
 * Message-handling logic for the sidebar, extracted from the webview provider
 * so it can be unit-tested without the `vscode` module. Mutates data through
 * the injected registries and asks for confirmations through the injected `ui`.
 * Unarchiving a linked note re-finds its code through the injected `links`.
 */
export class SidebarController {
  /** Link prepared by the "Add note to this line" command, consumed by the next `addItem`. */
  private pendingLink: MindStreamLink | undefined;

  constructor(
    private readonly items: ItemsStore,
    private readonly types: TypesRegistry,
    private readonly categories: CategoriesRegistry,
    private readonly emoji: EmojiRegistry,
    private readonly uiPrefs: UiPrefsRegistry,
    private readonly workPause: WorkPauseStore,
    /** Re-finds a note's code when it is unarchived (archived notes are not re-checked meanwhile). */
    private readonly links: LinkTracker,
    private readonly ui: SidebarUi,
    /** Reads the live `mindstream.priority.style` setting (true unless "off"). */
    private readonly priorityEnabled: () => boolean = () => true
  ) {}

  /** Sets (or clears, with `undefined`) the link the next linked note will be created with. */
  setPendingLink(link: MindStreamLink | undefined): void {
    this.pendingLink = link;
  }

  /** Answers a note editor Save that is ignored (work paused), so the editor keeps its text. */
  refuseNoteSave(msg: WebviewMessage): void {
    if (msg.type === "addItem" || msg.type === "updateItem") {
      this.ui.answerNoteSave(msg.saveId, false);
    }
  }

  /** Runs the note editor's write and answers the webview; a failure is re-thrown for the host to show. */
  private saveNote(msg: WebviewMessage, write: () => void): void {
    try {
      write();
    } catch (err) {
      this.ui.answerNoteSave(msg.saveId, false);
      throw err;
    }
    this.ui.answerNoteSave(msg.saveId, true);
  }

  /**
   * Refuses a note whose type or category does not exist, so a save is never
   * answered as stored when nothing was written. The message reaches the user
   * through the host, and the editor keeps what was typed.
   */
  private assertKnownTypeAndCategory(typeId: string | undefined, categoryId: string | undefined): void {
    if (typeId !== undefined && !this.types.get(typeId)) {
      throw new Error("The note's type no longer exists. Pick an existing type, or add one from Manage Types. Nothing was changed.");
    }
    if (categoryId !== undefined && !this.categories.get(categoryId)) {
      throw new Error("The note's category no longer exists. Pick an existing category. Nothing was changed.");
    }
  }

  async handleMessage(msg: WebviewMessage): Promise<void> {
    // While work is paused, the note is the only thing that may change.
    if (this.workPause.isPaused() && !isAllowedDuringWorkPause(msg.type)) {
      this.refuseNoteSave(msg);
      return;
    }
    switch (msg.type) {
      case "saveWorkPauseNote":
        this.workPause.save(msg.text, msg.pause === true);
        break;
      case "confirmDiscardWorkPauseDraft":
        this.ui.answerWorkPauseDiscard(await this.ui.confirmDiscardWorkPauseDraft());
        break;
      case "openDescriptionEditor":
        await this.ui.openDescriptionEditor(typeof msg.title === "string" ? msg.title : "", typeof msg.description === "string" ? msg.description : "");
        break;
      case "closeDescriptionEditor":
        await this.ui.closeDescriptionEditor();
        break;
      case "addItem": {
        const previousLink = this.pendingLink;
        const link = msg.linked === true ? previousLink : undefined;
        this.pendingLink = undefined;
        try {
          this.saveNote(msg, () => {
            if (msg.title?.trim()) {
              // A missing type id (no types) is refused too, never skipped silently.
              this.assertKnownTypeAndCategory(msg.typeId ?? "", msg.categoryId);
              this.items.create({
                link,
                typeId: msg.typeId as string,
                title: msg.title.trim(),
                description: msg.description,
                categoryId: msg.categoryId,
                tasks: sanitizeTasks(msg.tasks),
                // Enabled: always written (the editor's default when untouched).
                // Disabled: never written, so the note stays unassigned.
                priority: this.priorityEnabled() ? (isPriority(msg.priority) ? msg.priority : DEFAULT_PRIORITY) : undefined,
              });
            }
          });
        } catch (err) {
          // The editor stays open with its link, so the next Save still has it.
          this.pendingLink = previousLink;
          throw err;
        }
        break;
      }
      case "updateItem":
        this.saveNote(msg, () => {
          if (msg.id) {
            this.assertKnownTypeAndCategory(msg.typeId, msg.categoryId);
            this.items.update(msg.id, {
              title: msg.title,
              description: msg.description,
              typeId: msg.typeId,
              categoryId: msg.categoryId,
              // Only an explicit, valid choice is stored; while the system is
              // disabled the stored value (or its absence) is left untouched.
              priority: this.priorityEnabled() && isPriority(msg.priority) ? msg.priority : undefined,
              // A sent list replaces the stored one (empty clears it); no list leaves it untouched.
              tasks: Array.isArray(msg.tasks) ? (sanitizeTasks(msg.tasks) ?? []) : undefined,
            });
          }
        });
        break;
      case "setTaskCompleted":
        if (msg.id && Number.isInteger(msg.index) && typeof msg.title === "string" && typeof msg.completed === "boolean") {
          this.items.setTaskCompleted(msg.id, msg.index as number, msg.title, msg.completed);
        }
        break;
      case "deleteItem":
        if (msg.id) {
          const item = this.items.get(msg.id);
          if (!item) {
            break;
          }
          if (await this.ui.confirmDeleteNote(item.title)) {
            this.items.delete(msg.id);
          }
        }
        break;
      case "changeStatus":
        if (msg.id && msg.status) {
          this.items.changeStatus(msg.id, msg.status);
        }
        break;
      case "toggleArchive":
        if (msg.id && typeof msg.archived === "boolean") {
          const wasArchived = this.items.get(msg.id)?.archived === true;
          this.items.setArchived(msg.id, msg.archived);
          if (wasArchived && !msg.archived) {
            // The link was not re-checked while archived; a refused write is dropped silently.
            await this.links.resolveItem(msg.id);
          }
        }
        break;
      case "addCategory":
        if (msg.label?.trim()) {
          this.categories.add(msg.label.trim());
        }
        break;
      case "renameCategory":
        if (msg.id && msg.label?.trim()) {
          this.categories.rename(msg.id, msg.label.trim());
        }
        break;
      case "deleteCategory": {
        if (!msg.id) {
          break;
        }
        const cat = this.categories.get(msg.id);
        if (!cat) {
          break;
        }
        const count = this.categories.countItems(msg.id);
        if (await this.ui.confirmDeleteCategory(cat.label, count)) {
          this.items.deleteByCategory(msg.id);
          this.categories.remove(msg.id);
        }
        break;
      }
      case "setCategoryDefaultType": {
        if (!msg.id) {
          break;
        }
        const cat = this.categories.get(msg.id);
        if (!cat) {
          break;
        }
        const types = this.types.list();
        const picked = await this.ui.pickType(types.map((t) => ({ id: t.id, label: t.label, icon: t.icon })));
        if (picked) {
          this.categories.setDefaultType(msg.id, picked);
        }
        break;
      }
      case "addType":
        if (msg.label?.trim()) {
          this.types.add(msg.label.trim(), msg.icon);
        }
        break;
      case "renameType":
        if (msg.id && msg.label?.trim()) {
          this.types.rename(msg.id, msg.label.trim());
        }
        break;
      case "setTypeIcon":
        if (msg.id && msg.icon) {
          this.types.setIcon(msg.id, msg.icon);
        }
        break;
      case "deleteType": {
        if (!msg.id) {
          break;
        }
        const typeDef = this.types.get(msg.id);
        if (!typeDef) {
          break;
        }
        if (this.types.list().length <= 1) {
          this.ui.showInfo(`Type "${typeDef.label}" is the last type. Add another type before deleting it: notes need at least one type.`);
          break;
        }
        const linked = this.types.countItems(msg.id);
        if (linked > 0) {
          this.ui.showInfo(`Type "${typeDef.label}" is used by ${linked} note(s). Change those notes to a different type before deleting it.`);
          break;
        }
        if (await this.ui.confirmDeleteType(typeDef.label)) {
          this.types.remove(msg.id);
        }
        break;
      }
      case "recordEmojiUse":
        if (msg.emoji) {
          await this.emoji.recordUse(msg.emoji);
        }
        break;
      case "updateEmojiPalette":
        if (msg.palette) {
          await this.emoji.setPalette(msg.palette);
        }
        break;
      case "restoreEmojiPalette":
        if (await this.ui.confirmRestoreEmojiPalette()) {
          await this.emoji.setPalette(DEFAULT_EMOJI_PALETTE);
        }
        break;
      case "setDescriptionHeight":
        if (typeof msg.height === "number") {
          await this.uiPrefs.setDescriptionHeight(msg.height);
        }
        break;
    }
  }
}
