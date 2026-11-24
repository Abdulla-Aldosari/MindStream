/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import { PortRole } from "./portHolder";
import { ClientChoice, ClientId } from "./clientList";
import { ClientConfig, ClientConfigInput, buildClientConfig } from "./clientConfigs";

/**
 * The connection setup as a flow over small interfaces (no `vscode` import), so
 * every step is unit-tested with fakes. It copies text to the clipboard and
 * tells the user where to paste it; it never writes any file.
 */

/** The server name of every client's entry. */
export const SERVER_NAME = "mindstream";

export interface ConnectIo {
  /** The token and the role of this window, read now. */
  state(): { token: string; role: PortRole | undefined; port: number; url: string };
  /** Waits briefly and re-reads: the router window may not have created the token yet. */
  waitForToken(): Promise<string>;
  pickClient(clients: readonly ClientChoice[]): Promise<ClientId | undefined>;
  copy(text: string): Promise<void>;
  /** Shows a message with buttons and returns the one chosen. */
  info(message: string, ...buttons: string[]): Promise<string | undefined>;
  warn(message: string, ...buttons: string[]): Promise<string | undefined>;
}

export const COPY_ANYWAY_BUTTON = "Copy configuration anyway";

/** Why no configuration can be offered yet (a full sentence), or `undefined` when one can. */
export function noTokenMessage(role: PortRole | undefined, port: number): string {
  if (role === "blocked") {
    return `MindStream MCP: port ${port} is used by another program, so agents cannot reach MindStream. Set mindstream.mcp.port to a free port, then run this command again.`;
  }
  return "MindStream MCP is still starting. Try again in a few seconds.";
}

/** What the user is told after the text is copied. Never contains the token. */
export function copiedMessage(label: string, config: ClientConfig): string {
  return `${label}: configuration copied. ${config.where}`;
}

/**
 * Runs the command: picks a client, copies its configuration, and says where to
 * paste it. Returns the text that was copied, or `undefined` when nothing was.
 * The message after the copy has no button: anything that copies would replace
 * the configuration on the clipboard before the user pastes it (the agent rules
 * have their own command in the More menu).
 */
export async function runConnect(io: ConnectIo, clients: readonly ClientChoice[], copilotMessage: string): Promise<string | undefined> {
  let { token } = io.state();
  if (!token) {
    token = await io.waitForToken();
  }
  const { role, port, url } = io.state();
  if (!token) {
    await io.warn(noTokenMessage(role, port));
    return undefined;
  }
  const id = await io.pickClient(clients);
  if (!id) {
    return undefined;
  }
  const label = clients.find((c) => c.id === id)?.label ?? id;
  const input: ClientConfigInput = { url, token, serverName: SERVER_NAME };
  if (id === "copilot") {
    const choice = await io.info(copilotMessage, COPY_ANYWAY_BUTTON);
    if (choice !== COPY_ANYWAY_BUTTON) {
      return undefined;
    }
  }
  const config = buildClientConfig(id, input);
  await io.copy(config.text);
  await io.info(copiedMessage(label, config));
  return config.text;
}
