/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { randomBytes } from "crypto";
import * as http from "http";
import { verifyHolderProof } from "./httpGuard";
import { HEALTH_PATH, McpHttpServer, PortInUseError } from "./mcpHttpServer";

/**
 * - `router`: this window holds the fixed port and serves the endpoint.
 * - `follower`: another MindStream window holds it (normal; this one retries).
 * - `blocked`: another program holds it, so agents cannot reach MindStream.
 */
export type PortRole = "router" | "follower" | "blocked";

export interface HoldFixedPortOptions {
  /** Pause between attempts. */
  retryMs: number;
  /** The user's token, sent to the holder check. */
  token: () => string;
  onRoleChange?: (role: PortRole, port: number) => void;
  log?: (line: string) => void;
}

export interface PortHold {
  /** The current role, or `undefined` before the first attempt ends. */
  readonly role: PortRole | undefined;
  /** Stops retrying and releases the port when held. Resolves even when called twice. */
  stop(): Promise<void>;
}

/**
 * What answers on `127.0.0.1:<port>`: a MindStream window of this user (it
 * proves it knows the token) or something else. The token is never sent: the
 * holder may be any program, so it gets only a random nonce.
 */
export function probePortHolder(port: number, token: string, timeoutMs = 2000): Promise<"mindstream" | "other"> {
  if (!token) {
    // Without a token no proof can be checked; nothing is sent.
    return Promise.resolve("other");
  }
  const nonce = randomBytes(16).toString("hex");
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: `${HEALTH_PATH}?nonce=${nonce}`, method: "GET", agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { proof?: unknown };
          resolve(res.statusCode === 200 && verifyHolderProof(token, nonce, body.proof) ? "mindstream" : "other");
        } catch {
          resolve("other");
        }
      });
      res.on("error", () => resolve("other"));
    });
    req.on("error", () => resolve("other"));
    req.setTimeout(timeoutMs, () => {
      resolve("other");
      req.destroy();
    });
    req.end();
  });
}

/**
 * Tries to take the fixed port and, while another window holds it, retries
 * every `retryMs`, so a window takes it over within seconds after the router
 * window closes or crashes. The operating system lets exactly one succeed, so
 * there is no election. A port held by a program that is not MindStream is
 * reported as `blocked`, and the attempts go on in case it frees.
 */
export function holdFixedPort(server: McpHttpServer, port: number, options: HoldFixedPortOptions): PortHold {
  let role: PortRole | undefined;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  /** The attempt in progress: `stop()` waits for it, so a listen that succeeds late never leaves the port taken. */
  let current: Promise<void> = Promise.resolve();

  const setRole = (next: PortRole) => {
    if (next !== role) {
      role = next;
      options.log?.(`MCP port ${port}: ${next}`);
      options.onRoleChange?.(next, port);
    }
  };

  const attempt = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      await server.start(port);
      if (stopped) {
        await server.stop();
        return;
      }
      setRole("router");
      return;
    } catch (err) {
      if (!(err instanceof PortInUseError)) {
        options.log?.(`MCP port ${port}: ${err instanceof Error ? err.message : String(err)}`);
      } else {
        const holder = await probePortHolder(port, options.token());
        if (!stopped) {
          setRole(holder === "mindstream" ? "follower" : "blocked");
        }
      }
    }
    if (!stopped) {
      timer = setTimeout(() => {
        current = attempt();
      }, options.retryMs);
    }
  };

  current = attempt();
  return {
    get role() {
      return role;
    },
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      await current;
      await server.stop();
    },
  };
}
