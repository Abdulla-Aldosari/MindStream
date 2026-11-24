/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as http from "node:http";
import { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, runCommand, type Session } from "./helpers";

/** What the result of a tool call looks like to a test. */
export interface AgentAnswer {
  isError?: boolean;
  content?: { type: string; text: string }[];
}

/** The data of a result: the JSON after the sentence and the blank line (for a refusal, `{ code, message, current? }`). */
export function dataOf<T = Record<string, unknown>>(answer: AgentAnswer): T {
  const text = answer.content?.[0]?.text ?? "";
  const at = text.indexOf("\n\n");
  if (at < 0) {
    throw new Error(`The result has no JSON part: ${text}`);
  }
  return JSON.parse(text.slice(at + 2)) as T;
}

/** A free port: opened and released at once, so a test never touches 18741 on the developer's machine. */
export async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** The status bar item of MindStream's MCP server: shown only while another program holds the port. */
export const mcpStatus = (session: Session) => session.page.locator('.statusbar-item[aria-label*="MindStream MCP"]');

/** The status of a request without a token to the endpoint: 401 once a MindStream window holds the port and has its token. */
function probe(port: number): Promise<number> {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/mcp", method: "POST", agent: false, headers: { "content-length": 0 } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", () => resolve(0));
    req.end();
  });
}

/** Waits until MindStream serves MCP on the port (the server starts with the window, with no visible sign). */
export async function waitForMcp(port: number): Promise<void> {
  await expect.poll(() => probe(port), { timeout: 30_000 }).toBe(401);
}

export const readClipboard = (session: Session) => session.app.evaluate(({ clipboard }) => clipboard.readText());

/** The address and token a user gets from "Connect an AI agent (MCP)" with the Generic client. */
export async function connectionOf(session: Session): Promise<{ url: string; token: string }> {
  await runCommand(session.page, "MindStream: Connect an AI agent (MCP)");
  const entry = session.page.locator(".quick-input-list .quick-input-list-entry", { hasText: "Generic" }).first();
  await entry.waitFor();
  await entry.click();
  await expect.poll(() => readClipboard(session), { timeout: 30_000 }).toMatch(/Bearer \S+/);
  const copied = await readClipboard(session);
  const url = /URL: (\S+)/.exec(copied)?.[1];
  const token = /Authorization: Bearer (\S+)/.exec(copied)?.[1];
  if (!url || !token) {
    throw new Error(`The copied text has no address or token: ${copied}`);
  }
  return { url, token };
}

/** An agent: the official v2 client connected with what the user copied. Close it when done. */
export class Agent {
  private constructor(
    private readonly client: Client,
    private readonly workspace: string
  ) {}

  static async connect(session: Session): Promise<Agent> {
    const { url, token } = await connectionOf(session);
    const client = new Client({ name: "e2e-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return new Agent(client, session.workspace);
  }

  /** Calls a tool for this window's folder, or another one through `args.workspace`. */
  async call(name: string, args: Record<string, unknown> = {}): Promise<AgentAnswer> {
    return (await this.client.callTool({ name, arguments: { workspace: this.workspace, ...args } })) as AgentAnswer;
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
