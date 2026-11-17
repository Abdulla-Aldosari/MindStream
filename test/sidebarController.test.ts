import * as assert from "assert";
import { createEmptyData } from "../src/storage";
import { ItemsStore } from "../src/itemsStore";
import { TypesRegistry } from "../src/typesRegistry";
import { CategoriesRegistry } from "../src/categoriesRegistry";
import { SidebarController, SidebarUi } from "../src/sidebarController";
import { DEFAULT_EMOJI_PALETTE, EmojiMemento, EmojiRegistry } from "../src/emojiRegistry";
import { DEFAULT_DESCRIPTION_HEIGHT, UiPrefsRegistry } from "../src/uiPrefs";
import { DEFAULT_PRIORITY } from "../src/priority";
import { WorkPauseStore } from "../src/workPauseStore";
import { BLOCKED, InMemoryStorage } from "./helpers";
import { StorageError } from "../src/storage";

class FakeEmojiMemento implements EmojiMemento {
  private store = new Map<string, unknown>();
  get<T>(key: string, defaultValue: T): T {
    return (this.store.has(key) ? this.store.get(key) : defaultValue) as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
}

class FakeUi implements SidebarUi {
  confirmDeleteNoteResult = true;
  confirmDeleteCategoryResult = true;
  confirmDeleteTypeResult = true;
  confirmRestoreEmojiPaletteResult = true;
  pickTypeResult: string | undefined = undefined;
  infos: string[] = [];
  confirmedNotes: string[] = [];
  confirmedCategories: { label: string; count: number }[] = [];
  confirmedTypes: string[] = [];
  restoreConfirmations = 0;
  pickedTypes: { id: string; label: string; icon?: string }[] = [];

  async confirmDeleteNote(title: string): Promise<boolean> {
    this.confirmedNotes.push(title);
    return this.confirmDeleteNoteResult;
  }

  async confirmDeleteCategory(label: string, count: number): Promise<boolean> {
    this.confirmedCategories.push({ label, count });
    return this.confirmDeleteCategoryResult;
  }

  async confirmDeleteType(label: string): Promise<boolean> {
    this.confirmedTypes.push(label);
    return this.confirmDeleteTypeResult;
  }

  async confirmRestoreEmojiPalette(): Promise<boolean> {
    this.restoreConfirmations += 1;
    return this.confirmRestoreEmojiPaletteResult;
  }

  confirmDiscardWorkPauseDraftResult = true;
  discardConfirmations = 0;
  discardAnswers: boolean[] = [];

  async confirmDiscardWorkPauseDraft(): Promise<boolean> {
    this.discardConfirmations += 1;
    return this.confirmDiscardWorkPauseDraftResult;
  }

  answerWorkPauseDiscard(discard: boolean): void {
    this.discardAnswers.push(discard);
  }

  async pickType(types: { id: string; label: string; icon?: string }[]): Promise<string | undefined> {
    this.pickedTypes = types;
    return this.pickTypeResult;
  }

  showInfo(message: string): void {
    this.infos.push(message);
  }

  saveAnswers: { saveId: number | undefined; ok: boolean }[] = [];

  answerNoteSave(saveId: number | undefined, ok: boolean): void {
    this.saveAnswers.push({ saveId, ok });
  }

  descriptionOpens: { title: string; text: string }[] = [];
  descriptionCloses = 0;

  async openDescriptionEditor(title: string, text: string): Promise<void> {
    this.descriptionOpens.push({ title, text });
  }

  async closeDescriptionEditor(): Promise<void> {
    this.descriptionCloses += 1;
  }
}

function setup(priorityEnabled = true) {
  const storage = new InMemoryStorage(createEmptyData());
  const items = new ItemsStore(storage);
  const types = new TypesRegistry(storage);
  const categories = new CategoriesRegistry(storage);
  const emoji = new EmojiRegistry(new FakeEmojiMemento());
  const uiPrefs = new UiPrefsRegistry(new FakeEmojiMemento());
  const ui = new FakeUi();
  const workPause = new WorkPauseStore(storage);
  const controller = new SidebarController(items, types, categories, emoji, uiPrefs, workPause, ui, () => priorityEnabled);
  const typeId = storage.getData().types[0].id;
  return { storage, items, types, categories, emoji, uiPrefs, workPause, ui, controller, typeId };
}

describe("SidebarController.handleMessage", () => {
  it("addItem creates a note with a trimmed title", async () => {
    const { items, controller, typeId } = setup();
    await controller.handleMessage({ type: "addItem", title: "  Idea  ", typeId });
    assert.strictEqual(items.list().length, 1);
    assert.strictEqual(items.list()[0].title, "Idea");
  });

  it("addItem ignores a blank title", async () => {
    const { items, controller, typeId } = setup();
    await controller.handleMessage({ type: "addItem", title: "   ", typeId });
    assert.strictEqual(items.list().length, 0);
  });

  describe("code link", () => {
    const link = { filePath: "src/a.ts", lineStart: 3, state: "ok" as const };

    it("addItem attaches the host's pending link only when the form was linked", async () => {
      const { items, controller, typeId } = setup();
      controller.setPendingLink(link);
      await controller.handleMessage({ type: "addItem", title: "A", typeId, linked: true });
      assert.deepStrictEqual(items.list()[0].link, link);
    });

    it("addItem ignores a pending link when the webview did not flag the form as linked", async () => {
      const { items, controller, typeId } = setup();
      controller.setPendingLink(link);
      await controller.handleMessage({ type: "addItem", title: "A", typeId });
      assert.strictEqual(items.list()[0].link, undefined);
    });

    it("addItem never trusts a link sent by the webview", async () => {
      const { items, controller, typeId } = setup();
      const forged = { type: "addItem", title: "A", typeId, linked: true, link: { filePath: "../x", lineStart: 1 } };
      await controller.handleMessage(forged as never);
      assert.strictEqual(items.list()[0].link, undefined);
    });

    it("the pending link is consumed by one addItem", async () => {
      const { items, controller, typeId } = setup();
      controller.setPendingLink(link);
      await controller.handleMessage({ type: "addItem", title: "A", typeId, linked: true });
      await controller.handleMessage({ type: "addItem", title: "B", typeId, linked: true });
      assert.strictEqual(items.list()[1].link, undefined);
    });

    it("updateItem cannot change or remove an existing link", async () => {
      const { items, controller, typeId } = setup();
      const note = items.create({ typeId, title: "A", link });
      const forged = { type: "updateItem", id: note.id, title: "B", link: { filePath: "other.ts", lineStart: 9, state: "ok" } };
      await controller.handleMessage(forged as never);
      assert.strictEqual(items.get(note.id)?.title, "B");
      assert.deepStrictEqual(items.get(note.id)?.link, link);
    });

    it("updateItem cannot add a link to a plain note", async () => {
      const { items, controller, typeId } = setup();
      const note = items.create({ typeId, title: "A" });
      await controller.handleMessage({ type: "updateItem", id: note.id, linked: true, title: "B" });
      assert.strictEqual(items.get(note.id)?.link, undefined);
    });
  });

  describe("priority", () => {
    it("addItem stores the chosen priority while enabled", async () => {
      const { items, controller, typeId } = setup(true);
      await controller.handleMessage({ type: "addItem", title: "A", typeId, priority: "critical" });
      assert.strictEqual(items.list()[0].priority, "critical");
    });

    it("addItem writes DEFAULT_PRIORITY when enabled and none (or an invalid one) is sent", async () => {
      const { items, controller, typeId } = setup(true);
      await controller.handleMessage({ type: "addItem", title: "A", typeId });
      await controller.handleMessage({ type: "addItem", title: "B", typeId, priority: "urgent" });
      assert.deepStrictEqual(
        items.list().map((it) => it.priority),
        [DEFAULT_PRIORITY, DEFAULT_PRIORITY]
      );
    });

    it("addItem never writes a priority key while disabled", async () => {
      const { items, controller, typeId } = setup(false);
      await controller.handleMessage({ type: "addItem", title: "A", typeId, priority: "high" });
      assert.strictEqual("priority" in items.list()[0], false);
    });

    it("updateItem stores an explicit choice and never adds one implicitly", async () => {
      const { items, controller, typeId } = setup(true);
      const item = items.create({ typeId, title: "Old note" });
      await controller.handleMessage({ type: "updateItem", id: item.id, title: "Renamed" });
      assert.strictEqual("priority" in items.get(item.id)!, false);
      await controller.handleMessage({ type: "updateItem", id: item.id, priority: "medium" });
      assert.strictEqual(items.get(item.id)!.priority, "medium");
    });

    it("updateItem keeps the stored priority while disabled", async () => {
      const { items, controller, typeId } = setup(false);
      const item = items.create({ typeId, title: "A", priority: "high" });
      await controller.handleMessage({ type: "updateItem", id: item.id, title: "B", priority: "low" });
      assert.strictEqual(items.get(item.id)!.priority, "high");
    });
  });

  it("updateItem patches the provided fields", async () => {
    const { items, controller, typeId } = setup();
    const item = items.create({ typeId, title: "A" });
    await controller.handleMessage({ type: "updateItem", id: item.id, title: "B" });
    assert.strictEqual(items.get(item.id)!.title, "B");
  });

  it("deleteItem confirms before deleting", async () => {
    const { items, ui, controller, typeId } = setup();
    const item = items.create({ typeId, title: "Task" });
    await controller.handleMessage({ type: "deleteItem", id: item.id });
    assert.deepStrictEqual(ui.confirmedNotes, ["Task"]);
    assert.strictEqual(items.get(item.id), undefined);
  });

  it("deleteItem keeps the note when the user cancels", async () => {
    const { items, ui, controller, typeId } = setup();
    const item = items.create({ typeId, title: "Keep" });
    ui.confirmDeleteNoteResult = false;
    await controller.handleMessage({ type: "deleteItem", id: item.id });
    assert.ok(items.get(item.id));
  });

  it("deleteItem does not prompt for an unknown id", async () => {
    const { ui, controller } = setup();
    await controller.handleMessage({ type: "deleteItem", id: "missing" });
    assert.strictEqual(ui.confirmedNotes.length, 0);
  });

  it("changeStatus updates the status", async () => {
    const { items, controller, typeId } = setup();
    const item = items.create({ typeId, title: "A" });
    await controller.handleMessage({ type: "changeStatus", id: item.id, status: "done" });
    assert.strictEqual(items.get(item.id)!.status, "done");
  });

  it("toggleArchive archives the note", async () => {
    const { items, controller, typeId } = setup();
    const item = items.create({ typeId, title: "A" });
    await controller.handleMessage({ type: "toggleArchive", id: item.id, archived: true });
    assert.strictEqual(items.get(item.id)!.archived, true);
  });

  it("addCategory adds a trimmed label", async () => {
    const { categories, controller } = setup();
    await controller.handleMessage({ type: "addCategory", label: "  Before Release  " });
    assert.ok(categories.list().some((c) => c.label === "Before Release"));
  });

  it("renameCategory renames the category", async () => {
    const { categories, controller } = setup();
    const cat = categories.add("Temp");
    await controller.handleMessage({ type: "renameCategory", id: cat.id, label: "Pre-Launch" });
    assert.strictEqual(categories.label(cat.id), "Pre-Launch");
  });

  it("setCategoryDefaultType saves the picked type", async () => {
    const { types, categories, ui, controller } = setup();
    const cat = categories.add("Fixes");
    const fix = types.list().find((t) => t.label === "Fix")!;
    ui.pickTypeResult = fix.id;
    await controller.handleMessage({ type: "setCategoryDefaultType", id: cat.id });
    assert.strictEqual(categories.get(cat.id)!.defaultTypeId, fix.id);
    assert.strictEqual(ui.pickedTypes.length, types.list().length);
  });

  it("setCategoryDefaultType does nothing when the picker is cancelled", async () => {
    const { categories, ui, controller } = setup();
    const cat = categories.add("Fixes");
    ui.pickTypeResult = undefined;
    await controller.handleMessage({ type: "setCategoryDefaultType", id: cat.id });
    assert.strictEqual(categories.get(cat.id)!.defaultTypeId, undefined);
  });

  it("setCategoryDefaultType ignores an unknown category without prompting", async () => {
    const { ui, controller } = setup();
    ui.pickTypeResult = "anything";
    await controller.handleMessage({ type: "setCategoryDefaultType", id: "missing" });
    assert.strictEqual(ui.pickedTypes.length, 0);
  });

  it("deleteCategory confirms with the item count and removes both", async () => {
    const { items, categories, ui, controller, typeId } = setup();
    const cat = categories.add("C");
    items.create({ typeId, title: "X", categoryId: cat.id });
    await controller.handleMessage({ type: "deleteCategory", id: cat.id });
    assert.deepStrictEqual(ui.confirmedCategories, [{ label: "C", count: 1 }]);
    assert.strictEqual(categories.get(cat.id), undefined);
    assert.strictEqual(items.list(true).length, 0);
  });

  it("deleteCategory keeps the category when the user cancels", async () => {
    const { categories, ui, controller } = setup();
    const cat = categories.add("C");
    ui.confirmDeleteCategoryResult = false;
    await controller.handleMessage({ type: "deleteCategory", id: cat.id });
    assert.ok(categories.get(cat.id));
  });

  it("addType adds a type with an icon", async () => {
    const { types, controller } = setup();
    await controller.handleMessage({ type: "addType", label: "Bug", icon: "bug" });
    assert.ok(types.list().some((t) => t.label === "Bug" && t.icon === "bug"));
  });

  it("renameType renames the type", async () => {
    const { types, controller } = setup();
    const def = types.add("Fix");
    await controller.handleMessage({ type: "renameType", id: def.id, label: "Patch" });
    assert.strictEqual(types.label(def.id), "Patch");
  });

  it("setTypeIcon updates the icon", async () => {
    const { types, controller } = setup();
    const def = types.add("Fix");
    await controller.handleMessage({ type: "setTypeIcon", id: def.id, icon: "wrench" });
    assert.strictEqual(types.get(def.id)!.icon, "wrench");
  });

  it("deleteType blocks deletion and shows info when the type is in use", async () => {
    const { items, types, ui, controller } = setup();
    const def = types.add("Fix");
    items.create({ typeId: def.id, title: "X" });
    await controller.handleMessage({ type: "deleteType", id: def.id });
    assert.ok(types.get(def.id));
    assert.strictEqual(ui.confirmedTypes.length, 0);
    assert.strictEqual(ui.infos.length, 1);
  });

  it("deleteType confirms and removes an unused type", async () => {
    const { types, ui, controller } = setup();
    const def = types.add("Fix");
    await controller.handleMessage({ type: "deleteType", id: def.id });
    assert.deepStrictEqual(ui.confirmedTypes, ["Fix"]);
    assert.strictEqual(types.get(def.id), undefined);
  });

  it("deleteType keeps the type when the user cancels", async () => {
    const { types, ui, controller } = setup();
    const def = types.add("Fix");
    ui.confirmDeleteTypeResult = false;
    await controller.handleMessage({ type: "deleteType", id: def.id });
    assert.ok(types.get(def.id));
  });

  it("recordEmojiUse records the emoji as the most recent", async () => {
    const { emoji, controller } = setup();
    await controller.handleMessage({ type: "recordEmojiUse", emoji: "📌" });
    await controller.handleMessage({ type: "recordEmojiUse", emoji: "✅" });
    assert.deepStrictEqual(emoji.recents(), ["✅", "📌"]);
  });

  it("updateEmojiPalette replaces and dedupes the palette", async () => {
    const { emoji, controller } = setup();
    await controller.handleMessage({ type: "updateEmojiPalette", palette: ["✅", "📌", "✅"] });
    assert.deepStrictEqual(emoji.palette(), ["✅", "📌"]);
  });

  it("restoreEmojiPalette restores DEFAULT_EMOJI_PALETTE when confirmed", async () => {
    const { emoji, ui, controller } = setup();
    await emoji.setPalette(["✅"]);
    await controller.handleMessage({ type: "restoreEmojiPalette" });
    assert.strictEqual(ui.restoreConfirmations, 1);
    assert.deepStrictEqual(emoji.palette(), DEFAULT_EMOJI_PALETTE);
  });

  it("restoreEmojiPalette keeps the palette when cancelled", async () => {
    const { emoji, ui, controller } = setup();
    await emoji.setPalette(["✅"]);
    ui.confirmRestoreEmojiPaletteResult = false;
    await controller.handleMessage({ type: "restoreEmojiPalette" });
    assert.deepStrictEqual(emoji.palette(), ["✅"]);
  });

  it("setDescriptionHeight persists the clamped height", async () => {
    const { uiPrefs, controller } = setup();
    await controller.handleMessage({ type: "setDescriptionHeight", height: 320 });
    assert.strictEqual(uiPrefs.descriptionHeight(), 320);
  });

  it("setDescriptionHeight ignores a non-numeric height", async () => {
    const { uiPrefs, controller } = setup();
    await controller.handleMessage({ type: "setDescriptionHeight", height: undefined });
    assert.strictEqual(uiPrefs.descriptionHeight(), DEFAULT_DESCRIPTION_HEIGHT);
  });
});

describe("SidebarController Work Pause", () => {
  it("saveWorkPauseNote stores the text without pausing by default", async () => {
    const { workPause, controller } = setup();
    await controller.handleMessage({ type: "saveWorkPauseNote", text: "Stopped at line 84" });
    assert.strictEqual(workPause.get().text, "Stopped at line 84");
    assert.strictEqual(workPause.isPaused(), false);
  });

  it("saveWorkPauseNote with pause true locks once the text is saved", async () => {
    const { workPause, controller } = setup();
    await controller.handleMessage({ type: "saveWorkPauseNote", text: "Go home", pause: true });
    assert.strictEqual(workPause.isPaused(), true);
  });

  it("saveWorkPauseNote never pauses on blank or non-string text", async () => {
    const { workPause, controller, storage } = setup();
    await controller.handleMessage({ type: "saveWorkPauseNote", text: "   ", pause: true });
    await controller.handleMessage({ type: "saveWorkPauseNote", text: undefined, pause: true });
    assert.strictEqual(workPause.isPaused(), false);
    assert.strictEqual(storage.saved.length, 0);
  });

  it("confirmDiscardWorkPauseDraft asks the host and relays the answer, either way", async () => {
    const { controller, ui } = setup();
    await controller.handleMessage({ type: "confirmDiscardWorkPauseDraft" });
    ui.confirmDiscardWorkPauseDraftResult = false;
    await controller.handleMessage({ type: "confirmDiscardWorkPauseDraft" });
    assert.strictEqual(ui.discardConfirmations, 2);
    assert.deepStrictEqual(ui.discardAnswers, [true, false]);
  });

  it("the discard question still works while work is paused", async () => {
    const { controller, ui } = setup();
    await controller.handleMessage({ type: "saveWorkPauseNote", text: "Locked", pause: true });
    await controller.handleMessage({ type: "confirmDiscardWorkPauseDraft" });
    assert.deepStrictEqual(ui.discardAnswers, [true]);
  });

  it("only a literal true pauses", async () => {
    const { workPause, controller } = setup();
    await controller.handleMessage({ type: "saveWorkPauseNote", text: "x", pause: "yes" as unknown as boolean });
    assert.strictEqual(workPause.isPaused(), false);
  });

  describe("while work is paused", () => {
    async function locked() {
      const ctx = setup();
      await ctx.controller.handleMessage({ type: "saveWorkPauseNote", text: "Locked", pause: true });
      ctx.storage.saved.length = 0;
      return ctx;
    }

    it("ignores every note, category, type, emoji and preference mutation", async () => {
      const { controller, storage, items, typeId } = await locked();
      const id = items.create({ typeId, title: "keep" }).id;
      storage.saved.length = 0;
      const messages = [
        { type: "addItem", title: "New", typeId },
        { type: "updateItem", id, title: "Changed" },
        { type: "deleteItem", id },
        { type: "changeStatus", id, status: "done" },
        { type: "toggleArchive", id, archived: true },
        { type: "addCategory", label: "C" },
        { type: "addType", label: "T" },
        { type: "recordEmojiUse", emoji: "✅" },
        { type: "setDescriptionHeight", height: 300 },
        { type: "setTaskCompleted", id, index: 0, title: "x", completed: true },
      ] as const;
      for (const m of messages) {
        await controller.handleMessage(m);
      }
      assert.strictEqual(storage.saved.length, 0);
      assert.strictEqual(items.get(id)?.title, "keep");
      assert.strictEqual(items.list().length, 1);
    });

    it("still lets the note itself be edited", async () => {
      const { controller, workPause } = await locked();
      await controller.handleMessage({ type: "saveWorkPauseNote", text: "Updated" });
      assert.strictEqual(workPause.get().text, "Updated");
      assert.strictEqual(workPause.isPaused(), true);
    });

    it("resumes normal handling once work is resumed", async () => {
      const { controller, workPause, items, typeId } = await locked();
      workPause.resume();
      await controller.handleMessage({ type: "addItem", title: "After", typeId });
      assert.strictEqual(items.list().length, 1);
    });
  });
});

describe("SidebarController tasks", () => {
  it("addItem stores the sanitized task list", async () => {
    const { items, controller, typeId } = setup();
    await controller.handleMessage({ type: "addItem", title: "G", typeId, tasks: [{ title: " A ", completed: true }, { title: "" }, "junk"] });
    assert.deepStrictEqual(items.list()[0].tasks, [{ title: "A", completed: true }]);
  });

  it("addItem writes no key without tasks", async () => {
    const { items, controller, typeId } = setup();
    await controller.handleMessage({ type: "addItem", title: "Plain", typeId, tasks: [{ title: "  " }] });
    assert.ok(!("tasks" in items.list()[0]));
  });

  it("updateItem replaces the list, clears it when empty, and keeps it when absent", async () => {
    const { items, controller, typeId } = setup();
    const id = items.create({ typeId, title: "G", tasks: [{ title: "A", completed: false }] }).id;
    await controller.handleMessage({ type: "updateItem", id, title: "G" });
    assert.deepStrictEqual(items.get(id)?.tasks, [{ title: "A", completed: false }]);
    await controller.handleMessage({ type: "updateItem", id, title: "G", tasks: [{ title: "B", completed: true }, { title: "A" }] });
    assert.deepStrictEqual(items.get(id)?.tasks, [
      { title: "B", completed: true },
      { title: "A", completed: false },
    ]);
    await controller.handleMessage({ type: "updateItem", id, title: "G", tasks: [{ title: " " }] });
    assert.ok(!("tasks" in (items.get(id) ?? {})));
  });

  it("setTaskCompleted stores a valid request", async () => {
    const { items, controller, typeId } = setup();
    const id = items.create({ typeId, title: "G", tasks: [{ title: "A", completed: false }] }).id;
    await controller.handleMessage({ type: "setTaskCompleted", id, index: 0, title: "A", completed: true });
    assert.strictEqual(items.get(id)?.tasks?.[0].completed, true);
    await controller.handleMessage({ type: "setTaskCompleted", id, index: 0, title: "A", completed: false });
    assert.strictEqual(items.get(id)?.tasks?.[0].completed, false);
  });

  it("setTaskCompleted ignores malformed requests", async () => {
    const { storage, items, controller, typeId } = setup();
    const id = items.create({ typeId, title: "G", tasks: [{ title: "A", completed: false }] }).id;
    const saves = storage.saved.length;
    const bad = [
      { type: "setTaskCompleted", index: 0, title: "A", completed: true },
      { type: "setTaskCompleted", id, index: 0.5, title: "A", completed: true },
      { type: "setTaskCompleted", id, title: "A", completed: true },
      { type: "setTaskCompleted", id, index: 0, completed: true },
      { type: "setTaskCompleted", id, index: 0, title: "A" },
      { type: "setTaskCompleted", id, index: 0, title: "Other", completed: true },
    ] as const;
    for (const m of bad) {
      await controller.handleMessage(m);
    }
    assert.strictEqual(storage.saved.length, saves);
    assert.strictEqual(items.get(id)?.tasks?.[0].completed, false);
  });
});

describe("SidebarController note editor save answer", () => {
  it("answers ok with the save id when the note is stored", async () => {
    const { controller, ui, typeId, items } = setup();
    await controller.handleMessage({ type: "addItem", title: "A", typeId, saveId: 7 });
    assert.deepStrictEqual(ui.saveAnswers, [{ saveId: 7, ok: true }]);
    await controller.handleMessage({ type: "updateItem", id: items.list()[0].id, title: "B", saveId: 8 });
    assert.deepStrictEqual(ui.saveAnswers[1], { saveId: 8, ok: true });
  });

  it("answers not ok and re-throws when the storage refuses, changing nothing", async () => {
    const { controller, ui, typeId, items, storage } = setup();
    const note = items.create({ typeId, title: "Kept" });
    storage.problem = BLOCKED;
    await assert.rejects(controller.handleMessage({ type: "addItem", title: "New", typeId, saveId: 1 }), StorageError);
    await assert.rejects(controller.handleMessage({ type: "updateItem", id: note.id, title: "Changed", saveId: 2 }), StorageError);
    assert.deepStrictEqual(ui.saveAnswers, [
      { saveId: 1, ok: false },
      { saveId: 2, ok: false },
    ]);
    assert.strictEqual(items.list().length, 1);
    assert.strictEqual(items.get(note.id)?.title, "Kept");
  });

  it("keeps the pending code link when the save is refused, so the retry still links", async () => {
    const { controller, typeId, items, storage } = setup();
    const link = { filePath: "src/a.ts", lineStart: 3, state: "ok" as const };
    controller.setPendingLink(link);
    storage.problem = BLOCKED;
    await assert.rejects(controller.handleMessage({ type: "addItem", title: "A", typeId, linked: true, saveId: 1 }));
    storage.problem = undefined;
    await controller.handleMessage({ type: "addItem", title: "A", typeId, linked: true, saveId: 2 });
    assert.deepStrictEqual(items.list()[0].link, link);
  });

  it("refuses a note with a missing or unknown type and answers not ok", async () => {
    const { controller, ui, items, typeId } = setup();
    await assert.rejects(controller.handleMessage({ type: "addItem", title: "A", saveId: 1 }), /type no longer exists/);
    await assert.rejects(controller.handleMessage({ type: "addItem", title: "A", typeId: "gone", saveId: 2 }), /type no longer exists/);
    await assert.rejects(controller.handleMessage({ type: "addItem", title: "A", typeId, categoryId: "gone", saveId: 3 }), /category no longer exists/);
    assert.strictEqual(items.list().length, 0);
    assert.deepStrictEqual(ui.saveAnswers, [
      { saveId: 1, ok: false },
      { saveId: 2, ok: false },
      { saveId: 3, ok: false },
    ]);
  });

  it("refuses to move a note to an unknown type", async () => {
    const { controller, items, typeId } = setup();
    const note = items.create({ typeId, title: "Kept" });
    await assert.rejects(controller.handleMessage({ type: "updateItem", id: note.id, title: "Kept", typeId: "gone", saveId: 1 }), /type no longer exists/);
    assert.strictEqual(items.get(note.id)?.typeId, typeId);
  });

  it("deleteType keeps the last type and says why", async () => {
    const { types, ui, controller } = setup();
    for (const t of types.list().slice(1)) {
      types.remove(t.id);
    }
    const last = types.list()[0];
    await controller.handleMessage({ type: "deleteType", id: last.id });
    assert.ok(types.get(last.id));
    assert.strictEqual(ui.confirmedTypes.length, 0);
    assert.ok(ui.infos.some((m) => m.includes("last type")));
  });

  it("answers not ok while work is paused, so the editor keeps its text", async () => {
    const { controller, ui, typeId, items } = setup();
    await controller.handleMessage({ type: "saveWorkPauseNote", text: "Locked", pause: true });
    await controller.handleMessage({ type: "addItem", title: "A", typeId, saveId: 3 });
    assert.deepStrictEqual(ui.saveAnswers, [{ saveId: 3, ok: false }]);
    assert.strictEqual(items.list().length, 0);
  });

  it("refuseNoteSave answers only note editor saves", () => {
    const { controller, ui } = setup();
    controller.refuseNoteSave({ type: "changeStatus", id: "x" });
    assert.strictEqual(ui.saveAnswers.length, 0);
    controller.refuseNoteSave({ type: "updateItem", id: "x", saveId: 4 });
    assert.deepStrictEqual(ui.saveAnswers, [{ saveId: 4, ok: false }]);
  });

  describe("description editor tab", () => {
    it("openDescriptionEditor passes the title and text to the host and stores nothing", async () => {
      const { controller, ui, storage, items } = setup();
      await controller.handleMessage({ type: "openDescriptionEditor", title: "Idea", description: "Long text" });
      assert.deepStrictEqual(ui.descriptionOpens, [{ title: "Idea", text: "Long text" }]);
      assert.strictEqual(storage.saved.length, 0);
      assert.strictEqual(items.list().length, 0);
    });

    it("openDescriptionEditor treats a missing title or text as empty", async () => {
      const { controller, ui } = setup();
      await controller.handleMessage({ type: "openDescriptionEditor", title: 5 as unknown as string, description: undefined });
      assert.deepStrictEqual(ui.descriptionOpens, [{ title: "", text: "" }]);
    });

    it("closeDescriptionEditor asks the host to close the tab", async () => {
      const { controller, ui } = setup();
      await controller.handleMessage({ type: "closeDescriptionEditor" });
      assert.strictEqual(ui.descriptionCloses, 1);
    });

    it("is refused while work is paused, and the data stays unchanged", async () => {
      const { controller, ui, storage } = setup();
      await controller.handleMessage({ type: "saveWorkPauseNote", text: "Locked", pause: true });
      const saves = storage.saved.length;
      await controller.handleMessage({ type: "openDescriptionEditor", title: "Idea", description: "x" });
      assert.strictEqual(ui.descriptionOpens.length, 0);
      assert.strictEqual(storage.saved.length, saves);
    });

    it("a refused note save leaves the data untouched while the description came from the tab", async () => {
      const { controller, items, storage, typeId } = setup();
      storage.problem = BLOCKED;
      await assert.rejects(controller.handleMessage({ type: "addItem", title: "A", description: "from the tab", typeId, saveId: 1 }), StorageError);
      assert.strictEqual(items.list().length, 0);
      assert.strictEqual(storage.saved.length, 0);
    });
  });
});
