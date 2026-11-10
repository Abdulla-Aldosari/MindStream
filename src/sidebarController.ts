import { MindStreamLink, MindStreamStatus } from "./models";
import { DEFAULT_PRIORITY, isPriority } from "./priority";
import { ItemsStore } from "./itemsStore";
import { TypesRegistry } from "./typesRegistry";
import { CategoriesRegistry } from "./categoriesRegistry";
import { DEFAULT_EMOJI_PALETTE, EmojiRegistry } from "./emojiRegistry";
import { UiPrefsRegistry } from "./uiPrefs";

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
    | "openLink";
  id?: string;
  /**
   * Set by the webview on `addItem` when the open form was started from the
   * editor context menu. The link itself never comes from the webview: the
   * host keeps it (see `SidebarController.setPendingLink`).
   */
  linked?: boolean;
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
}

/** User-facing confirmations and notices the controller needs from the host. */
export interface SidebarUi {
  confirmDeleteNote(title: string): Promise<boolean>;
  confirmDeleteCategory(label: string, count: number): Promise<boolean>;
  confirmDeleteType(label: string): Promise<boolean>;
  confirmRestoreEmojiPalette(): Promise<boolean>;
  pickType(types: { id: string; label: string; icon?: string }[]): Promise<string | undefined>;
  showInfo(message: string): void;
}

/**
 * Message-handling logic for the sidebar, extracted from the webview provider
 * so it can be unit-tested without the `vscode` module. Mutates data through
 * the injected registries and asks for confirmations through the injected `ui`.
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
    private readonly ui: SidebarUi,
    /** Reads the live `mindstream.priority.style` setting (true unless "off"). */
    private readonly priorityEnabled: () => boolean = () => true
  ) {}

  /** Sets (or clears, with `undefined`) the link the next linked note will be created with. */
  setPendingLink(link: MindStreamLink | undefined): void {
    this.pendingLink = link;
  }

  async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case "addItem": {
        const link = msg.linked === true ? this.pendingLink : undefined;
        this.pendingLink = undefined;
        if (msg.title?.trim() && msg.typeId) {
          this.items.create({
            link,
            typeId: msg.typeId,
            title: msg.title.trim(),
            description: msg.description,
            categoryId: msg.categoryId,
            // Enabled: always written (the editor's default when untouched).
            // Disabled: never written, so the note stays unassigned.
            priority: this.priorityEnabled() ? (isPriority(msg.priority) ? msg.priority : DEFAULT_PRIORITY) : undefined,
          });
        }
        break;
      }
      case "updateItem":
        if (msg.id) {
          this.items.update(msg.id, {
            title: msg.title,
            description: msg.description,
            typeId: msg.typeId,
            categoryId: msg.categoryId,
            // Only an explicit, valid choice is stored; while the system is
            // disabled the stored value (or its absence) is left untouched.
            priority: this.priorityEnabled() && isPriority(msg.priority) ? msg.priority : undefined,
          });
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
          this.items.setArchived(msg.id, msg.archived);
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
