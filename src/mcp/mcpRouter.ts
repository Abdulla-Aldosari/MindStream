/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as http from "http";
import { invalid } from "../noteInput";
import { ToolContext, ToolDispatcher, ToolFailure, ToolResult } from "./mcpTypes";
import { InnerCall } from "./innerCall";
import { PROTOCOL_VERSION, RegistryEntry, RouterRegistry } from "./routerRegistry";
import { Platform, matchWorkspace, requireWorkspace } from "./workspaceMatch";
import { toToolError } from "./toolErrors";
import { findTool } from "./tools";

/** How long a forwarded call may take before the answer is `WORKSPACE_NOT_RESPONDING`. */
export const FORWARD_TIMEOUT_MS = 10_000;

export interface DispatcherOptions {
  /** The folder this window serves. */
  ownFolder: string;
  /** Runs a tool on this window's own notes. */
  ctx: ToolContext;
  registry: RouterRegistry;
  platform: Platform;
  /** The user's token, read for every call so a regenerated one applies at once. */
  token: () => string;
  timeoutMs?: number;
  log?: (line: string) => void;
}

/** The outcome of a forwarded call: an answer; a window that is gone (nothing ran); or no usable answer (the call may have run). */
type Forwarded = { kind: "result"; result: ToolResult } | { kind: "unreachable" } | { kind: "silent"; reason: string };

function openFolders(entries: readonly RegistryEntry[]): string {
  return entries.length ? entries.map((e) => e.folder).join(", ") : "none";
}

function notOpen(workspace: string, entries: readonly RegistryEntry[]): ToolFailure {
  return {
    ok: false,
    code: "WORKSPACE_NOT_OPEN",
    message: `Not run: the folder "${workspace}" is not open in VS Code. Nothing was changed. Open it in VS Code (MindStream serves a folder while its window is open) or check the path. Open folders: ${openFolders(entries)}.`,
  };
}

function notResponding(folder: string, reason: string): ToolFailure {
  return {
    ok: false,
    code: "WORKSPACE_NOT_RESPONDING",
    message: `The VS Code window of "${folder}" did not answer in time (${reason}). The call may or may not have been applied: read the note again before retrying.`,
  };
}

/**
 * POSTs a call to an inner server on a new connection. Never throws: every
 * outcome is a `Forwarded`. Connections are not pooled: an idle pooled socket
 * the inner server closed would fail with `ECONNRESET`, which cannot be told
 * apart from a reset after the call ran. With a new connection, only
 * `ECONNREFUSED` proves that nothing ran; any other failure may come after the
 * call was applied, so it is "silent", never "unreachable", and is not retried.
 */
function forward(entry: RegistryEntry, call: InnerCall, token: string, timeoutMs: number): Promise<Forwarded> {
  return new Promise((resolve) => {
    const body = JSON.stringify(call);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: entry.port,
        path: "/call",
        method: "POST",
        agent: false,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), authorization: `Bearer ${token}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            resolve({ kind: "silent", reason: `status ${res.statusCode}` });
            return;
          }
          try {
            resolve({ kind: "result", result: JSON.parse(text) as ToolResult });
          } catch {
            resolve({ kind: "silent", reason: "the answer was not understood" });
          }
        });
        res.on("error", () => resolve({ kind: "silent", reason: "the connection broke" }));
      }
    );
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED") {
        // A connection that could not even be made means the window is gone: nothing ran.
        resolve({ kind: "unreachable" });
      } else {
        resolve({ kind: "silent", reason: err.code ?? "network error" });
      }
    });
    req.setTimeout(timeoutMs, () => {
      resolve({ kind: "silent", reason: `no answer in ${timeoutMs / 1000} s` });
      req.destroy();
    });
    req.end(body);
  });
}

/** Splits `workspace` off the arguments: the router consumes it, the tool never sees it. */
function splitWorkspace(args: unknown, platform: Platform): { workspace: string; rest: Record<string, unknown> } {
  const input = typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  const { workspace, ...rest } = input;
  return { workspace: requireWorkspace(workspace, platform), rest };
}

/** Adds the matched folder to a success, so the agent can confirm where it wrote. */
function withWorkspace(result: ToolResult, folder: string): ToolResult {
  if (!result.ok) {
    return result;
  }
  const data = typeof result.data === "object" && result.data !== null && !Array.isArray(result.data) ? result.data : {};
  return { ...result, data: { ...data, workspace: folder } };
}

/**
 * The dispatcher of the window that holds the fixed port. A call whose folder is
 * this window's runs here; another open folder's call is forwarded to the
 * window that serves it; any other folder is refused. The router only routes:
 * it never reads or writes another workspace's data file.
 */
export function createDispatcher(options: DispatcherOptions): ToolDispatcher {
  const { ownFolder, ctx, registry, platform, log } = options;
  const timeoutMs = options.timeoutMs ?? FORWARD_TIMEOUT_MS;

  async function runLocal(name: string, rest: Record<string, unknown>): Promise<ToolResult> {
    // The caller checked that the tool exists.
    return findTool(name)!.handler(rest, ctx);
  }

  /** The window that serves `workspace`: this one, another live one, or none. */
  function pick(workspace: string): RegistryEntry | undefined {
    const cached = matchWorkspace(workspace, registry.liveEntries(), platform);
    // A miss re-reads the directory: a window may have opened since the cache was filled.
    return cached ?? matchWorkspace(workspace, registry.liveEntries(true), platform);
  }

  return async (name, args) => {
    if (!findTool(name)) {
      return toToolError(invalid(`"${name}" is not a MindStream tool`, "List the tools and use one of them."), ctx.query);
    }
    let workspace: string;
    let rest: Record<string, unknown>;
    try {
      ({ workspace, rest } = splitWorkspace(args, platform));
    } catch (err) {
      return toToolError(err, ctx.query);
    }
    const entry = pick(workspace);
    if (!entry) {
      return notOpen(workspace, registry.liveEntries());
    }
    if (entry.folder === ownFolder) {
      return withWorkspace(await runLocal(name, rest), entry.folder);
    }
    if (entry.protocol !== PROTOCOL_VERSION) {
      return notResponding(entry.folder, "it runs another version of MindStream; reload the VS Code windows of MindStream");
    }
    const answer = await forward(entry, { protocol: PROTOCOL_VERSION, name, args: rest }, options.token(), timeoutMs);
    if (answer.kind === "result") {
      return withWorkspace(answer.result, entry.folder);
    }
    if (answer.kind === "unreachable") {
      // The window is gone: its entry is stale, and nothing ran.
      registry.drop(entry);
      log?.(`dropped the stale entry of ${entry.folder}`);
      return notOpen(workspace, registry.liveEntries(true));
    }
    log?.(`forwarded call to ${entry.folder} failed: ${answer.reason}`);
    return notResponding(entry.folder, answer.reason);
  };
}
