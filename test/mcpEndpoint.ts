/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as http from "http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { McpHttpServer } from "../src/mcp/mcpHttpServer";
import { RESULT_JSON_SEPARATOR, createMindStreamMcpHandler, createNodeMcpHandler } from "../src/mcp/mcpServerCore";
import { TEST_TOKEN, TestWindow, makeRegistryDir } from "./mcpWindow";

/** What the result of a tool call looks like to an assertion. */
export interface ToolAnswer {
  isError?: boolean;
  content?: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

/** The sentence of a result's text: the summary, or the refusal message. */
export function sentenceOf(answer: ToolAnswer): string {
  return (answer.content?.[0]?.text ?? "").split(RESULT_JSON_SEPARATOR)[0];
}

/** The data of a result, parsed from the JSON after the sentence: the tool's data, or `{ code, message, current? }` for a refusal. */
export function dataOf<T = Record<string, unknown>>(answer: ToolAnswer): T {
  const text = answer.content?.[0]?.text ?? "";
  const at = text.indexOf(RESULT_JSON_SEPARATOR);
  if (at < 0) {
    throw new Error(`The result has no JSON part: ${text}`);
  }
  return JSON.parse(text.slice(at + RESULT_JSON_SEPARATOR.length)) as T;
}

/** A raw HTTP request to a port, with exactly the headers given (no client library). */
export function raw(port: number, headers: Record<string, string>, body = "", method = "POST", path = "/mcp"): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, agent: false, headers: { "content-length": Buffer.byteLength(body), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

/** A 2025-era JSON-RPC message: no 2026 envelope, as a client of the previous spec sends it. */
export function legacyRequest(method: string, params: object = {}, id = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

/** The `result` of the first JSON-RPC message of an answer, whether it came as JSON or as one SSE event. */
export function legacyResult(text: string): Record<string, unknown> {
  const data = text.trimStart().startsWith("{") ? text : (text.split("\n").find((line) => line.startsWith("data:")) ?? "data: {}").slice(5);
  return (JSON.parse(data) as { result?: Record<string, unknown> }).result ?? {};
}

/**
 * The public endpoint of one simulated window on a port picked by the system,
 * with the official v2 client to drive it. `requests` counts accepted requests.
 */
export class TestEndpoint {
  readonly registry = makeRegistryDir();
  readonly win: TestWindow;
  readonly server: McpHttpServer;
  readonly clients: Client[] = [];
  port = 0;
  requests = 0;
  wrongTokens = 0;

  /** The processes the registry believes are alive: share it with every other window of the test. */
  readonly alive = new Set<number>();

  constructor(pid: number, folder = "/work/a") {
    this.win = new TestWindow(folder, pid, this.registry.dir, this.alive);
    const handler = createNodeMcpHandler(createMindStreamMcpHandler(this.win.dispatcher(), { version: "0.0.0-test" })) as unknown as (
      req: http.IncomingMessage,
      res: http.ServerResponse
    ) => Promise<void>;
    this.server = new McpHttpServer({
      // Counts the requests that passed the guard and reached the MCP handler.
      handler: (req, res) => {
        this.requests++;
        return handler(req, res);
      },
      token: () => this.win.token,
      onWrongToken: () => this.wrongTokens++,
    });
  }

  async start(): Promise<this> {
    await this.win.open();
    this.port = await this.server.start(0);
    return this;
  }

  async stop(): Promise<void> {
    await Promise.all(this.clients.map((c) => c.close().catch(() => undefined)));
    await this.server.stop();
    await this.win.close();
    this.registry.remove();
  }

  /** The headers of an accepted raw request: the right Host and token. */
  headers(): Record<string, string> {
    return { "content-type": "application/json", accept: "application/json, text/event-stream", host: `127.0.0.1:${this.port}`, authorization: `Bearer ${this.win.token}` };
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  /** Connects the official v2 client with the given token. */
  async connect(token = TEST_TOKEN): Promise<Client> {
    const client = new Client({ name: "mindstream-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(this.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    this.clients.push(client);
    return client;
  }

  /** Calls a tool for this window's folder (or another one through `args.workspace`). */
  async call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolAnswer> {
    return (await client.callTool({ name, arguments: { workspace: this.win.folder, ...args } })) as ToolAnswer;
  }
}
