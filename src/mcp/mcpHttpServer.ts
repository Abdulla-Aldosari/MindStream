/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as http from "http";
import { AddressInfo } from "net";
import { GuardRequest, GuardResult, NONCE_PATTERN, checkPeer, checkRequest, holderProof } from "./httpGuard";
import { sendJson } from "./innerCall";
import { PROTOCOL_VERSION } from "./routerRegistry";

/** The path every MCP client connects to. */
export const MCP_PATH = "/mcp";
/** Answers a holder check `?nonce=<hex>` with `{ protocol, proof }`; the prober never sends the token. */
export const HEALTH_PATH = "/mindstream-health";

/** The Node `(req, res)` handler that serves MCP (from `mcpServerCore`), kept structural so this file has no SDK import. */
export type McpNodeHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

export class PortInUseError extends Error {
  readonly code = "PORT_IN_USE";
  constructor(readonly port: number) {
    super(`port ${port} is already in use`);
    this.name = "PortInUseError";
  }
}

export interface McpHttpServerOptions {
  handler: McpNodeHandler;
  /** The user's token, read for every request so a regenerated one applies at once. */
  token: () => string;
  /** Called for a request refused because it carried a well-formed token that is not the current one. */
  onWrongToken?: () => void;
  /** Receives the status and reason of every refused request: never the token or the body. */
  log?: (line: string) => void;
}

/** The public MCP endpoint: `127.0.0.1:<port>/mcp`, guarded by loopback, Origin, Host and bearer token checks. */
export class McpHttpServer {
  private server: http.Server | undefined;

  constructor(private readonly options: McpHttpServerOptions) {}

  get running(): boolean {
    return this.server !== undefined;
  }

  get port(): number | undefined {
    return (this.server?.address() as AddressInfo | null | undefined)?.port;
  }

  /** The address the server listens on (always the loopback address); `undefined` while stopped. */
  get address(): string | undefined {
    return (this.server?.address() as AddressInfo | null | undefined)?.address;
  }

  /**
   * Listens on `127.0.0.1:<port>` (`0` picks a free port). Rejects with
   * `PortInUseError` when the port is taken, and with the original error otherwise.
   */
  start(port: number): Promise<number> {
    if (this.server) {
      return Promise.reject(new Error("the server is already running"));
    }
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch((err: unknown) => {
          this.options.log?.(`MCP server error: ${err instanceof Error ? err.message : String(err)}`);
          if (res.headersSent) {
            res.end();
          } else {
            sendJson(res, 500, { error: "MindStream could not answer." });
          }
        });
      });
      server.once("error", (err: NodeJS.ErrnoException) => reject(err.code === "EADDRINUSE" ? new PortInUseError(port) : err));
      server.listen(port, "127.0.0.1", () => {
        server.removeAllListeners("error");
        server.on("error", (err) => this.options.log?.(`MCP server error: ${err.message}`));
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
    const guardRequest = { method: req.method, headers: req.headers, remoteAddress: req.socket.remoteAddress };
    const [path, query = ""] = (req.url ?? "").split("?");
    if (path === HEALTH_PATH && req.method === "GET") {
      this.answerHolderCheck(guardRequest, new URLSearchParams(query).get("nonce"), res);
      return;
    }
    const verdict = checkRequest(guardRequest, this.options.token(), this.port ?? 0);
    if (!verdict.ok) {
      if (verdict.wrongToken) {
        this.options.onWrongToken?.();
      }
      this.refuse(res, verdict);
      return;
    }
    if (path !== MCP_PATH) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    await this.options.handler(req, res);
  }

  private refuse(res: http.ServerResponse, verdict: Extract<GuardResult, { ok: false }>): void {
    this.options.log?.(`request refused (${verdict.status}): ${verdict.reason}`);
    sendJson(res, verdict.status, { error: verdict.reason }, verdict.challenge ? { "www-authenticate": verdict.challenge } : {});
  }

  /**
   * The holder check: a window that wants the port asks who holds it. The
   * prober sends a nonce and never the token; this server proves it knows the
   * token with `holderProof`. So a program that took the port learns nothing.
   * The peer checks still apply (loopback, no Origin, Host).
   */
  private answerHolderCheck(request: GuardRequest, nonce: string | null, res: http.ServerResponse): void {
    const peer = checkPeer(request, this.port ?? 0);
    if (!peer.ok) {
      this.refuse(res, peer);
      return;
    }
    if (nonce === null || !NONCE_PATTERN.test(nonce)) {
      sendJson(res, 400, { error: "the holder check needs a nonce" });
      return;
    }
    const token = this.options.token();
    if (!token) {
      sendJson(res, 503, { error: "not ready" });
      return;
    }
    sendJson(res, 200, { protocol: PROTOCOL_VERSION, proof: holderProof(token, nonce) });
  }
}
