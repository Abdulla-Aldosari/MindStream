/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { randomBytes } from "crypto";
import { PortRole } from "./portHolder";

/**
 * The decisions of the MCP controller, as pure functions (no `vscode`), so they
 * are unit-tested directly. The controller only applies them.
 */

/** The key under which the one token of the user is kept in `SecretStorage`. */
export const TOKEN_SECRET_KEY = "mindstream.mcp.token";
/** The port agents connect to unless the user sets `mindstream.mcp.port`. */
export const DEFAULT_MCP_PORT = 18741;
export const MIN_MCP_PORT = 1024;
export const MAX_MCP_PORT = 65535;
/** Pause between attempts of a window to take over the fixed port. */
export const PORT_RETRY_MS = 3000;
/** How long the connect command waits for a token that does not exist yet before it says MindStream is still starting. */
export const CONNECT_TOKEN_WAIT_MS = 5000;
/** How long a window waits before it warns that another program holds the port (a probe can be refused for a moment). */
export const BLOCKED_WARNING_DELAY_MS = 5000;
/** How often a window re-reads an empty token while it waits for the router window to create it. */
export const TOKEN_WAIT_MS = 500;

/** Why a configured port is not used, or `undefined` when it is a valid port. */
export function portProblem(value: unknown): string | undefined {
  if (!Number.isInteger(value) || (value as number) < MIN_MCP_PORT || (value as number) > MAX_MCP_PORT) {
    return `mindstream.mcp.port must be a whole number from ${MIN_MCP_PORT} to ${MAX_MCP_PORT}`;
  }
  return undefined;
}

/** The configured port, or the default when the setting is missing or not a valid port. */
export function resolvePort(value: unknown): number {
  return portProblem(value) === undefined ? (value as number) : DEFAULT_MCP_PORT;
}

/** A new token: 32 random bytes, base64url (43 characters, URL and header safe). */
export function generateToken(random: (size: number) => Buffer = randomBytes): string {
  return random(32).toString("base64url");
}

/**
 * Whether this window creates the token now: only the window that holds the
 * fixed port, and only while the secret is empty. Every other window only reads
 * it, so two windows never write two different tokens.
 */
export function shouldCreateToken(role: PortRole | undefined, current: string | undefined): boolean {
  return role === "router" && !current;
}

/** The URL every client uses; the same in every window. */
export function endpointUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

/** The headers a client sends: the token as a bearer credential. */
export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export interface StatusView {
  text: string;
  tooltip: string;
}

/**
 * The status bar item, shown only when there is something to act on: another
 * program holds the port, so no agent can reach MindStream. Otherwise
 * `undefined`: the item is hidden (the connect command is in the More menu).
 */
export function statusView(role: PortRole | undefined, port: number): StatusView | undefined {
  if (role !== "blocked") {
    return undefined;
  }
  return {
    text: "$(warning) MCP",
    tooltip: `MindStream MCP: port ${port} is used by another program, so agents cannot reach MindStream. Set mindstream.mcp.port to a free port, then update your agent's MindStream entry.`,
  };
}

/** The warning shown once per session when another program holds the port. */
export function blockedMessage(port: number): string {
  return `MindStream MCP: port ${port} is used by another program, so agents cannot reach MindStream. Set mindstream.mcp.port to a free port, then update your agent's MindStream entry.`;
}

/** The one-per-session warning when a request carries a token that is not the current one. Names no token. */
export const OLD_TOKEN_MESSAGE =
  'MindStream MCP: an AI agent is using an old token, so its calls are refused. Run "Connect an AI agent (MCP)" and paste the copied entry over the agent\'s MindStream entry.';

/** The buttons of the old-token warning and of the regenerate confirmation. */
export const CONNECT_NOW_BUTTON = "Connect an AI agent";

/**
 * The question before the token is replaced. The token is shared by every
 * window of this VS Code (local, WSL, SSH), so every agent entry stops working.
 */
export const REGENERATE_CONFIRMATION =
  "Regenerate the MindStream MCP token? It is shared by all your VS Code windows (local, WSL, and SSH), so every agent you configured, on every machine, stops working until you copy its entry again.";

/** The confirmation after the token was replaced. */
export const REGENERATED_MESSAGE =
  "MindStream MCP token regenerated in all your VS Code windows. Copy each agent's entry again, including agents inside WSL or SSH; agents that still use the old token are refused.";

/** What the Copilot registration offers: one server once the token exists, otherwise none. */
export function copilotServers(token: string | undefined, port: number): { label: string; url: string; headers: Record<string, string> }[] {
  return token ? [{ label: "MindStream", url: endpointUrl(port), headers: authHeaders(token) }] : [];
}
