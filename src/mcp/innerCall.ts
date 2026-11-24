/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as http from "http";
import { invalid } from "../noteInput";
import { ToolFailure } from "./mcpTypes";

/** Largest `/call` body the inner server reads. It is not behind the SDK, so it bounds the body itself. */
export const MAX_INNER_BODY_BYTES = 1024 * 1024;

/** The body of `POST /call`: what the router forwards to the window that owns the folder. */
export interface InnerCall {
  protocol: number;
  name: string;
  /** The tool's arguments without `workspace`. */
  args: unknown;
}

/** Writes a JSON answer with its length. */
export function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

/** Reads the body; resolves `undefined` (and stops reading) when it is over the limit. */
export function readBody(req: http.IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INNER_BODY_BYTES) {
        resolve(undefined);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Parses a `/call` body; a malformed one is refused as `INVALID_INPUT`. */
export function parseCall(text: string): InnerCall {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid("the call is not valid JSON", "Send { protocol, name, args } as JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("the call must be an object", "Send { protocol, name, args }.");
  }
  const call = value as Record<string, unknown>;
  if (typeof call.name !== "string") {
    throw invalid("the call has no tool name", "Send the tool's name as text.");
  }
  return { protocol: call.protocol as number, name: call.name, args: call.args };
}

/** The refusal for a window of another MindStream version. It is answered before anything runs, so nothing was changed. */
export function versionMismatch(): ToolFailure {
  return {
    ok: false,
    code: "WORKSPACE_NOT_RESPONDING",
    message: "Not run: the VS Code window of this folder runs another version of MindStream. Nothing was changed. Reload the VS Code windows of MindStream.",
  };
}
