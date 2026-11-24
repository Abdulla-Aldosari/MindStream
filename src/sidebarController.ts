/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { GENERAL_CATEGORY_ID, MindStreamLink, MindStreamStatus } from "./models";
import { isPriority } from "./priority";
import { ItemsStore } from "./itemsStore";
import { TypesRegistry } from "./typesRegistry";
import { CategoriesRegistry } from "./categoriesRegistry";
import { DEFAULT_EMOJI_PALETTE, EmojiRegistry } from "./emojiRegistry";
import { UiPrefsRegistry } from "./uiPrefs";
import { WorkPauseStore } from "./workPauseStore";
import { NotesService } from "./notesService";
import { isAllowedDuringWorkPause } from "./workPause";

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
    | "copyWorkPauseNote"
    | "openWorkPauseNoteInEditor"
    | "resumeWork"
    | "deleteWorkPauseNote"
    | "confirmCloseNoteForm"
    | "newNoteFormOpened"
    | "openDescriptionEditor"
    | "closeDescriptionEditor"
    | "setTaskCompleted";
  id?: string;
  /** `saveWorkPauseNote` only: also pause work (lock the UI) once saved. */
  pause?: boolean;
  /**
   * What a Save is based on: `updateItem` sends the note's fields as they were
   * when the form opened, `saveWorkPauseNote` the text when editing started,
   * `deleteWorkPauseNote` the text the card showed. A change made elsewhere
   * since then refuses the request (`CONFLICT`).
   */
  base?: unknown;
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

/** The answer to "this note form has changes: save, discard, or keep editing?". */
export type NoteCloseChoice = "save" | "discard" | "cancel";

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
  /** Tells the webview whether the Work Pause note was stored; a refused save keeps the draft open. */
  answerWorkPauseSave(ok: boolean): void;
  /** Puts the Work Pause note's text on the clipboard. */
  copyWorkPauseNote(text: string): Promise<void>;
  /** Shows a read-only copy of the Work Pause note in its single editor tab. */
  openWorkPauseNoteInEditor(text: string): Promise<void>;
  /** Asks before deleting the Work Pause note (which also resumes work). */
  confirmDeleteWorkPauseNote(): Promise<boolean>;
  /**
   * Asks what to do with the changes of the note form that is being closed:
   * store them (`save`, which the form runs as its own Save), `discard` them,
   * or `cancel` and keep editing.
   */
  confirmCloseNoteForm(): Promise<NoteCloseChoice>;
  /** Sends the user's answer to that question back to the webview. */
  answerCloseNoteForm(choice: NoteCloseChoice): void;
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
 * so it can be unit-tested without the `vscode` module. Every write goes
 * through the injected `NotesService` (the same rules as any other caller);
 * this class only reads the registries to word its questions, and asks for
 * confirmations through the injected `ui`.
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
    private readonly notes: NotesService,
    private readonly ui: SidebarUi,
    /** Reads the live `mindstream.priority.style` setting (true unless "off"). */
    private readonly priorityEnabled: () => boolean = () => true
  ) {}

  /** Link of a new-note request the webview has not accepted yet (it may keep its current form instead). */
  private offeredLink: MindStreamLink | undefined;

  /** Sets (or clears, with `undefined`) the link the next linked note will be created with. */
  setPendingLink(link: MindStreamLink | undefined): void {
    this.pendingLink = link;
  }

  /**
   * Remembers the link of a new-note request. It becomes the pending link only
   * when the webview confirms it opened the new form (`newNoteFormOpened`), so a
   * request the user cancelled never changes the form that stays open.
   */
  offerLink(link: MindStreamLink | undefined): void {
    this.offeredLink = link;
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

  /** The base fields sent by the note form, keeping only the editable ones. */
  private static formBase(raw: unknown): Record<string, unknown> | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    const src = raw as Record<string, unknown>;
    const base: Record<string, unknown> = {};
    for (const field of ["title", "description", "typeId", "categoryId", "priority", "tasks"]) {
      if (field in src) {
        base[field] = src[field];
      }
    }
    return base;
  }

  async handleMessage(msg: WebviewMessage): Promise<void> {
    // While work is paused, the note is the only thing that may change.
    if (this.workPause.isPaused() && !isAllowedDuringWorkPause(msg.type)) {
      this.refuseNoteSave(msg);
      return;
    }
    switch (msg.type) {
      case "saveWorkPauseNote":
        try {
          // The user's own note panel: the only write allowed while work is paused.
          this.notes.saveWorkPauseNote(msg.text, { pause: msg.pause === true, base: msg.base, userEditWhilePaused: true });
        } catch (err) {
          this.ui.answerWorkPauseSave(false);
          throw err;
        }
        this.ui.answerWorkPauseSave(true);
        break;
      case "confirmDiscardWorkPauseDraft":
        this.ui.answerWorkPauseDiscard(await this.ui.confirmDiscardWorkPauseDraft());
        break;
      // The note card's buttons. Copy and the editor tab use the stored text, never text from the webview.
      case "copyWorkPauseNote": {
        const text = this.workPause.get().text;
        if (text) {
          await this.ui.copyWorkPauseNote(text);
        }
        break;
      }
      case "openWorkPauseNoteInEditor": {
        const text = this.workPause.get().text;
        if (text) {
          await this.ui.openWorkPauseNoteInEditor(text);
        }
        break;
      }
      case "resumeWork":
        // The user's own click on the card, like the More menu item: the note is kept.
        this.workPause.resume();
        break;
      case "deleteWorkPauseNote":
        // Refused with its reason before the question, so the user is never asked for nothing.
        this.notes.checkWorkPauseNoteDeletable(msg.base);
        if (await this.ui.confirmDeleteWorkPauseNote()) {
          this.notes.deleteWorkPauseNote(msg.base);
        }
        break;
      case "confirmCloseNoteForm":
        // Only a question: nothing is read or written here. The form runs its own Save when the answer is "save".
        this.ui.answerCloseNoteForm(await this.ui.confirmCloseNoteForm());
        break;
      case "newNoteFormOpened":
        // The webview opened the new form requested by a command: only now does its link apply.
        this.pendingLink = msg.linked === true ? this.offeredLink : undefined;
        this.offeredLink = undefined;
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
            this.notes.addNote(
              {
                title: msg.title,
                description: msg.description,
                // The form always sends a type: a missing one (no types) is refused, never defaulted.
                typeId: msg.typeId ?? null,
                categoryId: msg.categoryId ?? GENERAL_CATEGORY_ID,
                tasks: Array.isArray(msg.tasks) ? msg.tasks : undefined,
                // Only a valid choice is sent on; the service applies the default
                // while priority is on and writes none while it is off.
                priority: this.priorityEnabled() && isPriority(msg.priority) ? msg.priority : undefined,
              },
              link
            );
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
          this.notes.updateNote(
            msg.id,
            {
              title: msg.title,
              description: msg.description,
              typeId: msg.typeId,
              categoryId: msg.categoryId,
              // Only an explicit, valid choice is stored; while the system is
              // disabled the stored value (or its absence) is left untouched.
              priority: this.priorityEnabled() && isPriority(msg.priority) ? msg.priority : undefined,
              // A sent list replaces the stored one (empty clears it); no list leaves it untouched.
              tasks: Array.isArray(msg.tasks) ? msg.tasks : undefined,
            },
            // The fields as the form showed them: a change made elsewhere since then refuses the Save.
            { base: SidebarController.formBase(msg.base) ?? {} }
          );
        });
        break;
      case "setTaskCompleted":
        this.notes.setTaskCompleted(msg.id, msg.index, msg.title, msg.completed);
        break;
      case "deleteItem": {
        const item = this.notes.getNote(msg.id);
        this.notes.checkWritable();
        if (await this.ui.confirmDeleteNote(item.title)) {
          this.notes.deleteNote(item.id);
        }
        break;
      }
      case "changeStatus":
        this.notes.changeStatus(msg.id, msg.status);
        break;
      case "toggleArchive":
        await this.notes.setArchived(msg.id, msg.archived);
        break;
      case "addCategory":
        this.notes.addCategory(msg.label);
        break;
      case "renameCategory":
        this.notes.renameCategory(msg.id, msg.label);
        break;
      case "deleteCategory": {
        const cat = this.notes.getCategory(msg.id);
        this.notes.checkWritable();
        if (cat.id === GENERAL_CATEGORY_ID) {
          // Refused with its reason before any question.
          this.notes.deleteCategory(cat.id);
        }
        const count = this.categories.countItems(cat.id);
        if (await this.ui.confirmDeleteCategory(cat.label, count)) {
          this.notes.deleteCategory(cat.id);
        }
        break;
      }
      case "setCategoryDefaultType": {
        const cat = this.notes.getCategory(msg.id);
        this.notes.checkWritable();
        const types = this.types.list();
        const picked = await this.ui.pickType(types.map((t) => ({ id: t.id, label: t.label, icon: t.icon })));
        if (picked) {
          this.notes.setCategoryDefaultType(cat.id, picked);
        }
        break;
      }
      case "addType":
        this.notes.addType(msg.label, msg.icon);
        break;
      case "renameType":
        this.notes.renameType(msg.id, msg.label);
        break;
      case "setTypeIcon":
        this.notes.setTypeIcon(msg.id, msg.icon);
        break;
      case "deleteType": {
        const typeDef = this.notes.getType(msg.id);
        this.notes.checkWritable();
        // Explained before any question, so the user is never asked for nothing.
        const problem = this.notes.typeDeletionProblem(typeDef.id);
        if (problem) {
          this.ui.showInfo(problem);
          break;
        }
        if (await this.ui.confirmDeleteType(typeDef.label)) {
          this.notes.deleteType(typeDef.id);
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
