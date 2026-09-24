import { MindStreamStatus } from './models';
import { ItemsStore } from './itemsStore';
import { TypesRegistry } from './typesRegistry';
import { CategoriesRegistry } from './categoriesRegistry';

export interface WebviewMessage {
  type:
    | 'refresh'
    | 'addItem'
    | 'updateItem'
    | 'deleteItem'
    | 'changeStatus'
    | 'toggleArchive'
    | 'toggleArchiveView'
    | 'addCategory'
    | 'renameCategory'
    | 'deleteCategory'
    | 'addType'
    | 'renameType'
    | 'setTypeIcon'
    | 'deleteType';
  id?: string;
  title?: string;
  description?: string;
  typeId?: string;
  categoryId?: string;
  label?: string;
  icon?: string;
  status?: MindStreamStatus;
  archived?: boolean;
}

/** User-facing confirmations and notices the controller needs from the host. */
export interface SidebarUi {
  confirmDeleteNote(title: string): Promise<boolean>;
  confirmDeleteCategory(label: string, count: number): Promise<boolean>;
  confirmDeleteType(label: string): Promise<boolean>;
  showInfo(message: string): void;
}

/**
 * Message-handling logic for the sidebar, extracted from the webview provider
 * so it can be unit-tested without the `vscode` module. Mutates data through
 * the injected registries and asks for confirmations through the injected `ui`.
 */
export class SidebarController {
  constructor(
    private readonly items: ItemsStore,
    private readonly types: TypesRegistry,
    private readonly categories: CategoriesRegistry,
    private readonly ui: SidebarUi
  ) {}

  async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'addItem':
        if (msg.title?.trim() && msg.typeId) {
          this.items.create({
            typeId: msg.typeId,
            title: msg.title.trim(),
            description: msg.description,
            categoryId: msg.categoryId
          });
        }
        break;
      case 'updateItem':
        if (msg.id) {
          this.items.update(msg.id, {
            title: msg.title,
            description: msg.description,
            typeId: msg.typeId,
            categoryId: msg.categoryId
          });
        }
        break;
      case 'deleteItem':
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
      case 'changeStatus':
        if (msg.id && msg.status) {
          this.items.changeStatus(msg.id, msg.status);
        }
        break;
      case 'toggleArchive':
        if (msg.id && typeof msg.archived === 'boolean') {
          this.items.setArchived(msg.id, msg.archived);
        }
        break;
      case 'addCategory':
        if (msg.label?.trim()) {
          this.categories.add(msg.label.trim());
        }
        break;
      case 'renameCategory':
        if (msg.id && msg.label?.trim()) {
          this.categories.rename(msg.id, msg.label.trim());
        }
        break;
      case 'deleteCategory': {
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
      case 'addType':
        if (msg.label?.trim()) {
          this.types.add(msg.label.trim(), msg.icon);
        }
        break;
      case 'renameType':
        if (msg.id && msg.label?.trim()) {
          this.types.rename(msg.id, msg.label.trim());
        }
        break;
      case 'setTypeIcon':
        if (msg.id && msg.icon) {
          this.types.setIcon(msg.id, msg.icon);
        }
        break;
      case 'deleteType': {
        if (!msg.id) {
          break;
        }
        const typeDef = this.types.get(msg.id);
        if (!typeDef) {
          break;
        }
        const linked = this.types.countItems(msg.id);
        if (linked > 0) {
          this.ui.showInfo(
            `Type "${typeDef.label}" is used by ${linked} note(s). Change those notes to a different type before deleting it.`
          );
          break;
        }
        if (await this.ui.confirmDeleteType(typeDef.label)) {
          this.types.remove(msg.id);
        }
        break;
      }
    }
  }
}
