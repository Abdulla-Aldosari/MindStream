/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { createEmptyData } from "../src/storage";
import { ItemsStore } from "../src/itemsStore";
import { TypesRegistry } from "../src/typesRegistry";
import { CategoriesRegistry } from "../src/categoriesRegistry";
import { WorkPauseStore } from "../src/workPauseStore";
import { LinkTracker } from "../src/linkTracker";
import { NotesService } from "../src/notesService";
import { NotesQuery } from "../src/mcp/notesQuery";
import { ToolResult } from "../src/mcp/mcpTypes";
import { InnerServer } from "../src/mcp/innerServer";
import { RouterRegistry } from "../src/mcp/routerRegistry";
import { createDispatcher } from "../src/mcp/mcpRouter";
import { FakeFiles, InMemoryStorage } from "./helpers";

/** The token every test window uses. It is not a real secret. */
export const TEST_TOKEN = "test-token-not-a-real-secret";

/** A temporary registry directory shared by the windows of one test. */
export function makeRegistryDir(): { dir: string; remove(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-router-"));
  return { dir, remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/**
 * One simulated VS Code window: its own notes over its own in-memory storage,
 * an inner server on a port picked by the system, and an entry in the shared
 * registry. `isAlive` lets a test say a window's process is gone.
 */
export class TestWindow {
  readonly storage = new InMemoryStorage(createEmptyData());
  readonly items = new ItemsStore(this.storage);
  readonly types = new TypesRegistry(this.storage);
  readonly categories = new CategoriesRegistry(this.storage);
  readonly workPause = new WorkPauseStore(this.storage);
  readonly files = new FakeFiles();
  readonly ctx: { notes: NotesService; query: NotesQuery };
  readonly registry: RouterRegistry;
  readonly inner: InnerServer;
  token = TEST_TOKEN;
  port = 0;

  constructor(
    readonly folder: string,
    readonly pid: number,
    registryDir: string,
    alive: Set<number>,
    startedAt = 1000
  ) {
    const links = new LinkTracker(this.items, this.files);
    const deps = {
      storage: this.storage,
      items: this.items,
      types: this.types,
      categories: this.categories,
      workPause: this.workPause,
      links,
      files: this.files,
      priorityEnabled: () => true,
    };
    this.ctx = { notes: new NotesService(deps), query: new NotesQuery(deps) };
    this.registry = new RouterRegistry({ dir: registryDir, platform: "posix", isAlive: (p) => alive.has(p), pid, now: () => startedAt });
    this.inner = new InnerServer({ ctx: this.ctx, token: () => this.token });
    alive.add(pid);
  }

  /** Starts the inner server and registers the window. */
  async open(): Promise<this> {
    this.port = await this.inner.start();
    this.registry.register(this.folder, this.port);
    return this;
  }

  /** Closes the inner server but leaves the registry entry behind, as a crashed window does. */
  async crash(): Promise<void> {
    await this.inner.stop();
  }

  async close(): Promise<void> {
    await this.inner.stop();
    this.registry.unregister();
  }

  /** The dispatcher this window uses while it holds the fixed port. */
  dispatcher(timeoutMs = 2000) {
    return createDispatcher({ ownFolder: this.folder, ctx: this.ctx, registry: this.registry, platform: "posix", token: () => this.token, timeoutMs });
  }

  get typeId(): string {
    return this.types.list()[0].id;
  }
}

/** Reads a key of a success's data; `undefined` for a refusal. */
export function at(result: ToolResult, key: string): unknown {
  return result.ok ? (result.data as Record<string, unknown>)[key] : undefined;
}

/** Asserts that a result is a refusal with this code, and returns it. */
export function refused(result: ToolResult, code: string): Extract<ToolResult, { ok: false }> {
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  const failure = result as Extract<ToolResult, { ok: false }>;
  assert.strictEqual(failure.code, code, failure.message);
  return failure;
}

/** POSTs a raw body to a window's inner server `/call`, with the given headers. */
export function postCall(port: number, body: string, headers: Record<string, string> = {}, path = "/call"): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "POST", agent: false, headers: { "content-length": Buffer.byteLength(body), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
