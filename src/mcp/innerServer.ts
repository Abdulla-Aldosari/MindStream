/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as http from "http";
import { AddressInfo } from "net";
import { invalid } from "../noteInput";
import { ToolContext, ToolResult } from "./mcpTypes";
import { checkRequest } from "./httpGuard";
import { parseCall, readBody, sendJson, versionMismatch } from "./innerCall";
import { PROTOCOL_VERSION } from "./routerRegistry";
import { toToolError } from "./toolErrors";
import { findTool } from "./tools";

export interface InnerServerOptions {
  ctx: ToolContext;
  /** The user's token, read for every request so a regenerated one applies at once. */
  token: () => string;
  /** Receives the status and reason of every refused request: never the token or the body. */
  log?: (line: string) => void;
}

/**
 * A window's inner server: `POST /call` on 127.0.0.1, serving only this
 * window's workspace. It never speaks MCP; the router window forwards a call
 * here as `{ protocol, name, args }`. Every request passes the same guard and
 * token as the public endpoint.
 */
export class InnerServer {
  private server: http.Server | undefined;

  constructor(private readonly options: InnerServerOptions) {}

  get port(): number | undefined {
    return (this.server?.address() as AddressInfo | null | undefined)?.port;
  }

  /** Listens on a port picked by the system and resolves with it. */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch((err: unknown) => {
          this.options.log?.(`inner server error: ${err instanceof Error ? err.message : String(err)}`);
          if (res.headersSent) {
            res.end();
          } else {
            sendJson(res, 500, { error: "MindStream could not run the call." });
          }
        });
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        this.server = server;
        resolve((server.address() as AddressInfo).port);
      });
    });
  }

  /** Closes the server and every open connection. Resolves even when it was not running. */
  stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const verdict = checkRequest({ method: req.method, headers: req.headers, remoteAddress: req.socket.remoteAddress }, this.options.token(), this.port ?? 0);
    if (!verdict.ok) {
      this.options.log?.(`inner call refused (${verdict.status}): ${verdict.reason}`);
      sendJson(res, verdict.status, { error: verdict.reason }, verdict.challenge ? { "www-authenticate": verdict.challenge } : {});
      return;
    }
    if (req.method !== "POST" || req.url !== "/call") {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    const text = await readBody(req);
    if (text === undefined) {
      sendJson(res, 413, { error: "the call is too large" });
      return;
    }
    sendJson(res, 200, await this.run(text));
  }

  /** Always a `ToolResult`: a bad call is a refusal, and only a bug is thrown. */
  private async run(text: string): Promise<ToolResult> {
    const { ctx } = this.options;
    try {
      const call = parseCall(text);
      if (call.protocol !== PROTOCOL_VERSION) {
        return versionMismatch();
      }
      const tool = findTool(call.name);
      if (!tool) {
        throw invalid(`"${call.name}" is not a MindStream tool`, "List the tools and use one of them.");
      }
      return await tool.handler(call.args, ctx);
    } catch (err) {
      return toToolError(err, ctx.query);
    }
  }
}
