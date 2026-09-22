import { GENERAL_CATEGORY_ID, MindStreamItem, MindStreamStatus } from './models';
import { IStorage } from './storage';
import { newId, nowIso } from './util';

export interface NewItemInput {
  typeId: string;
  title: string;
  description?: string;
  categoryId?: string;
  tags?: string[];
  status?: MindStreamStatus;
}

export interface UpdateItemInput {
  title?: string;
  description?: string;
  typeId?: string;
  categoryId?: string;
  tags?: string[];
}

/**
 * Item management (CRUD) with:
 * - An append-only history of status transitions.
 * - Archiving fully independent of status.
 * - Permanent deletion separate from archiving.
 */
export class ItemsStore {
  constructor(private readonly storage: IStorage) {}

  /**
   * Returns items in a stable creation order (ascending `createdAt`).
   * The view layer applies any status-based sorting/grouping for display.
   */
  list(includeArchived = false): MindStreamItem[] {
    const items = this.storage.getData().items;
    const filtered = includeArchived ? items : items.filter((it) => !it.archived);
    return [...filtered].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  get(id: string): MindStreamItem | undefined {
    return this.storage.getData().items.find((it) => it.id === id);
  }

  create(input: NewItemInput): MindStreamItem {
    const data = this.storage.getData();
    const now = nowIso();
    const status = input.status ?? 'pending';
    const item: MindStreamItem = {
      id: newId(),
      typeId: input.typeId,
      categoryId: input.categoryId ?? GENERAL_CATEGORY_ID,
      title: input.title,
      description: input.description,
      status,
      statusHistory: [{ status, at: now }],
      archived: false,
      tags: input.tags,
      createdAt: now,
      updatedAt: now
    };
    data.items.push(item);
    this.storage.saveData(data);
    return item;
  }

  update(id: string, patch: UpdateItemInput): void {
    const data = this.storage.getData();
    const item = data.items.find((it) => it.id === id);
    if (!item) {
      return;
    }
    if (patch.title !== undefined) {
      item.title = patch.title;
    }
    if (patch.description !== undefined) {
      item.description = patch.description;
    }
    if (patch.typeId !== undefined) {
      item.typeId = patch.typeId;
    }
    if (patch.categoryId !== undefined) {
      item.categoryId = patch.categoryId;
    }
    if (patch.tags !== undefined) {
      item.tags = patch.tags;
    }
    item.updatedAt = nowIso();
    this.storage.saveData(data);
  }

  /** Changes status and appends the new entry to statusHistory (never removes anything). */
  changeStatus(id: string, status: MindStreamStatus): void {
    const data = this.storage.getData();
    const item = data.items.find((it) => it.id === id);
    if (!item || item.status === status) {
      return;
    }
    item.status = status;
    item.statusHistory.push({ status, at: nowIso() });
    item.updatedAt = nowIso();
    this.storage.saveData(data);
  }

  /** Archives/unarchives without touching the status at all. */
  setArchived(id: string, archived: boolean): void {
    const data = this.storage.getData();
    const item = data.items.find((it) => it.id === id);
    if (!item || item.archived === archived) {
      return;
    }
    item.archived = archived;
    item.archivedAt = archived ? nowIso() : undefined;
    item.updatedAt = nowIso();
    this.storage.saveData(data);
  }

  /** Permanent deletion (distinct from archiving). */
  delete(id: string): void {
    const data = this.storage.getData();
    data.items = data.items.filter((it) => it.id !== id);
    this.storage.saveData(data);
  }

  /** Deletes every item belonging to a given category. */
  deleteByCategory(categoryId: string): void {
    const data = this.storage.getData();
    data.items = data.items.filter((it) => it.categoryId !== categoryId);
    this.storage.saveData(data);
  }

  /** Removes every item (used by the dev "delete test" action). */
  clear(): void {
    const data = this.storage.getData();
    data.items = [];
    this.storage.saveData(data);
  }

  /**
   * Inserts 20 varied sample items (mixed types, statuses and archive states)
   * for testing purposes. Returns the number of created items.
   */
  insertTestData(): number {
    const data = this.storage.getData();
    const types = data.types;
    const firstType = (index: number) =>
      types.length > 0 ? types[index % types.length].id : '';

    const samples: Array<{
      typeIndex: number;
      title: string;
      description?: string;
      status: MindStreamStatus;
      archived?: boolean;
    }> = [
      { typeIndex: 0, title: 'إصلاح خطأ في دالة الحفظ', description: 'الملف لا يُحفظ عند اختيار المسار الذي يحتوي على مسافات.', status: 'done' },
      { typeIndex: 0, title: 'مراجعة التحقق من المدخلات', description: 'يجب التحقق من أن العنوان غير فارغ قبل الإرسال.', status: 'in-progress' },
      { typeIndex: 0, title: 'إصلاح تسريب الذاكرة في المشغل', status: 'pending' },
      { typeIndex: 1, title: 'تغيير لون الشريط الجانبي', description: 'جعل الخلفية أفتح لتتناسب مع الثيم الفاتح.', status: 'in-progress' },
      { typeIndex: 1, title: 'تحديث أسماء المتغيرات لتكون أوضح', status: 'done' },
      { typeIndex: 1, title: 'نقل إعدادات المشروع إلى ملف منفصل', status: 'pending' },
      { typeIndex: 2, title: 'إضافة ميزة السحب والإفلات', description: 'السماح بإعادة ترتيب الملاحظات بالسحب.', status: 'pending' },
      { typeIndex: 2, title: 'ميزة البحث في الملاحظات', description: 'بحث فوري في العنوان والوصف.', status: 'in-progress' },
      { typeIndex: 2, title: 'دعم الاختصارات المخصصة', status: 'done' },
      { typeIndex: 3, title: 'إعادة النظر في بنية التخزين', description: 'فصل الأنواع عن العناصر في ملفين.', status: 'pending' },
      { typeIndex: 3, title: 'تبسيط طبقة العرض', status: 'in-progress' },
      { typeIndex: 4, title: 'ملاحظة: استخدام التخزين المؤقت', description: 'استخدام debounce عند الكتابة لتقليل الحفظ.', status: 'pending' },
      { typeIndex: 4, title: 'توثيق دالة الترتيب', status: 'done' },
      { typeIndex: 5, title: 'كتابة اختبار لوحدة التخزين', description: 'تغطية حالات الملف التالف والمفقود.', status: 'done' },
      { typeIndex: 5, title: 'اختبار إعادة تسمية الأنواع', status: 'pending' },
      { typeIndex: 5, title: 'اختبار الأرشفة وتاريخ الإنجاز', status: 'in-progress' },
      { typeIndex: 6, title: 'فكرة للتحسين لاحقاً', description: 'ربط الملاحظة بسطر معين في الكود.', status: 'pending' },
      { typeIndex: 6, title: 'تذكير بمراجعة التصميم', status: 'pending', archived: true },
      { typeIndex: 7, title: 'مقال عن واجهات VS Code', description: 'https://example.com/vscode-webview-api', status: 'pending' },
      { typeIndex: 7, title: 'دليل ألوان الثيمات', description: 'https://example.com/theme-colors', status: 'done', archived: true }
    ];

    let count = 0;
    for (const s of samples) {
      const typeId = firstType(s.typeIndex);
      if (!typeId) {
        continue;
      }
      const now = nowIso();
      const status = s.status;
      const history: MindStreamItem['statusHistory'] = [{ status, at: now }];
      if (status === 'done') {
        history.unshift({ status: 'pending', at: now }, { status: 'in-progress', at: now });
      } else if (status === 'in-progress') {
        history.unshift({ status: 'pending', at: now });
      }
      const item: MindStreamItem = {
        id: newId(),
        typeId,
        categoryId: GENERAL_CATEGORY_ID,
        title: s.title,
        description: s.description,
        status,
        statusHistory: history,
        archived: s.archived ?? false,
        archivedAt: s.archived ? now : undefined,
        createdAt: now,
        updatedAt: now
      };
      data.items.push(item);
      count++;
    }
    this.storage.saveData(data);
    return count;
  }

  /** Time of the last transition to "done" (used to show the completion sequence). */
  completedAt(item: MindStreamItem): string | undefined {
    const done = item.statusHistory.filter((h) => h.status === 'done');
    return done.length ? done[done.length - 1].at : undefined;
  }
}
