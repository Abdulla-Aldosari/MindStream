/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as vscode from "vscode";
import { IncomingMessage, ServerResponse } from "http";
import { NotesService } from "../notesService";
import { NotesQuery } from "./notesQuery";
import { InnerServer } from "./innerServer";
import { McpHttpServer } from "./mcpHttpServer";
import { createDispatcher } from "./mcpRouter";
import { createMindStreamMcpHandler, createNodeMcpHandler } from "./mcpServerCore";
import { PortHold, PortRole, holdFixedPort } from "./portHolder";
import { RouterRegistry, processExists } from "./routerRegistry";
import { CLIENTS, COPILOT_AUTOMATIC_MESSAGE } from "./clientList";
import { runConnect } from "./mcpConnectFlow";
import { AGENT_RULES, AGENT_RULES_COPIED_MESSAGE } from "./agentRules";
import { currentPlatform } from "./workspaceMatch";
import {
  BLOCKED_WARNING_DELAY_MS,
  CONNECT_NOW_BUTTON,
  CONNECT_TOKEN_WAIT_MS,
  OLD_TOKEN_MESSAGE,
  REGENERATE_CONFIRMATION,
  REGENERATED_MESSAGE,
  PORT_RETRY_MS,
  TOKEN_SECRET_KEY,
  TOKEN_WAIT_MS,
  authHeaders,
  blockedMessage,
  copilotServers,
  endpointUrl,
  generateToken,
  portProblem,
  resolvePort,
  shouldCreateToken,
  statusView,
} from "./mcpControllerLogic";

export interface McpControllerDeps {
  context: vscode.ExtensionContext;
  /** The folder this window serves (the one `resolveWorkspaceFolder` picked). */
  folder: vscode.WorkspaceFolder;
  notes: NotesService;
  query: NotesQuery;
  /** The existing "MindStream" output channel. */
  output: vscode.OutputChannel;
}

/** The Node handler of the SDK takes structural request types; this adapts it to `http` without a cast. */
function asHttpHandler(handler: ReturnType<typeof createNodeMcpHandler>): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return (req, res) => handler(req, res);
}

/**
 * The only file of `src/mcp/` that imports `vscode`. It starts, in every window
 * with a workspace folder and with no user action: this window's inner server
 * and its registry entry, the attempt to hold the fixed port (the window that
 * holds it is the router), the one token of the user, the status bar item, and
 * the Copilot registration. Every decision it makes is a function of
 * `mcpControllerLogic.ts`, tested without VS Code.
 */
export class McpController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly registry: RouterRegistry;
  private readonly inner: InnerServer;
  private readonly server: McpHttpServer;
  private readonly status: vscode.StatusBarItem;
  private readonly definitionsChanged = new vscode.EventEmitter<void>();
  private hold: PortHold | undefined;
  private role: PortRole | undefined;
  private token = "";
  private readonly version: string;
  private blockedShown = false;
  private oldTokenShown = false;
  private tokenTimer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private readonly deps: McpControllerDeps) {
    const { context, folder, notes, query } = deps;
    this.registry = new RouterRegistry({
      dir: vscode.Uri.joinPath(context.globalStorageUri, "router").fsPath,
      platform: currentPlatform(),
      isAlive: processExists,
    });
    const tokenOf = () => this.token;
    this.inner = new InnerServer({ ctx: { notes, query }, token: tokenOf, log: (line) => this.log(line) });
    const dispatch = createDispatcher({
      ownFolder: folder.uri.fsPath,
      ctx: { notes, query },
      registry: this.registry,
      platform: currentPlatform(),
      token: tokenOf,
      log: (line) => this.log(line),
    });
    const version = String((context.extension.packageJSON as { version?: unknown }).version ?? "0.0.0");
    const handler = createNodeMcpHandler(
      createMindStreamMcpHandler(dispatch, { version }, (err) => this.log(`MCP error: ${err.message}`)),
      (err) => this.log(`MCP error: ${err.message}`)
    );
    this.server = new McpHttpServer({
      handler: asHttpHandler(handler),
      token: tokenOf,
      onWrongToken: () => this.warnOldToken(),
      log: (line) => this.log(line),
    });
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
    this.status.command = "mindstream.mcp.connect";
    this.version = version;
    this.disposables.push(this.status, this.definitionsChanged);
  }

  private log(line: string): void {
    this.deps.output.appendLine(`[mcp] ${line}`);
  }

  /** The fixed port: the setting's value, the same in every window; the default when it is not a valid port. */
  get port(): number {
    return resolvePort(vscode.workspace.getConfiguration("mindstream").get<unknown>("mcp.port"));
  }

  /** The token, or an empty text until the window that holds the port has created it. */
  get currentToken(): string {
    return this.token;
  }

  /** The URL of every client's entry. */
  get url(): string {
    return endpointUrl(this.port);
  }

  /** The authorization header of the current token, for the connection setup. */
  get headers(): Record<string, string> {
    return authHeaders(this.token);
  }

  /** Shows the status bar item while another program holds the port, and hides it otherwise. */
  private refreshStatus(): void {
    const view = statusView(this.role, this.port);
    if (!view) {
      this.status.hide();
      return;
    }
    this.status.text = view.text;
    this.status.tooltip = view.tooltip;
    this.status.show();
  }

  /** Starts everything: the inner server, the registry entry, the token, the port, and the Copilot registration. */
  async start(): Promise<void> {
    const { context, folder } = this.deps;
    this.registry.watch();
    const innerPort = await this.inner.start();
    this.registry.register(folder.uri.fsPath, innerPort);
    this.log(`serving ${folder.uri.fsPath} (inner port ${innerPort})`);
    this.token = (await context.secrets.get(TOKEN_SECRET_KEY)) ?? "";
    this.beginHold();
    this.disposables.push(
      vscode.lm.registerMcpServerDefinitionProvider("mindstream.mcp", {
        onDidChangeMcpServerDefinitions: this.definitionsChanged.event,
        provideMcpServerDefinitions: () => this.copilotDefinitions(),
      }),
      context.secrets.onDidChange((event) => {
        if (event.key === TOKEN_SECRET_KEY) {
          void this.readToken();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("mindstream.mcp.port")) {
          void this.restartHold();
        }
      }),
      vscode.commands.registerCommand("mindstream.mcp.regenerateToken", () => this.regenerateToken()),
      vscode.commands.registerCommand("mindstream.mcp.connect", () => this.connect()),
      vscode.commands.registerCommand("mindstream.mcp.copyRules", () => this.copyAgentRules())
    );
    this.refreshStatus();
  }

  private beginHold(): void {
    const problem = portProblem(vscode.workspace.getConfiguration("mindstream").get<unknown>("mcp.port"));
    if (problem) {
      this.log(`${problem}; using ${this.port}`);
    }
    this.hold = holdFixedPort(this.server, this.port, {
      retryMs: PORT_RETRY_MS,
      token: () => this.token,
      onRoleChange: (role, port) => this.onRole(role, port),
      log: (line) => this.log(line),
    });
  }

  private async restartHold(): Promise<void> {
    await this.hold?.stop();
    this.role = undefined;
    this.blockedShown = false;
    this.beginHold();
    this.refreshStatus();
    this.definitionsChanged.fire();
  }

  private onRole(role: PortRole, port: number): void {
    this.role = role;
    if (role === "router") {
      void this.ensureToken();
    } else if (!this.token) {
      this.waitForToken();
    }
    if (role === "blocked") {
      this.warnBlockedLater(port);
    }
    this.refreshStatus();
  }

  /** Creates the token when this is the router window and none exists; otherwise reads the stored one. */
  private async ensureToken(): Promise<void> {
    const stored = await this.deps.context.secrets.get(TOKEN_SECRET_KEY);
    if (shouldCreateToken(this.role, stored)) {
      const created = generateToken();
      await this.deps.context.secrets.store(TOKEN_SECRET_KEY, created);
      this.token = created;
      this.log("created the MCP token");
    } else {
      this.token = stored ?? "";
    }
    this.definitionsChanged.fire();
  }

  private async readToken(): Promise<void> {
    this.token = (await this.deps.context.secrets.get(TOKEN_SECRET_KEY)) ?? "";
    this.definitionsChanged.fire();
  }

  /** A window that is not the router re-reads an empty token until the router window has created it. */
  private waitForToken(): void {
    if (this.tokenTimer || this.disposed) {
      return;
    }
    const tick = async () => {
      this.tokenTimer = undefined;
      await this.readToken();
      if (!this.token && !this.disposed) {
        this.tokenTimer = setTimeout(() => void tick(), TOKEN_WAIT_MS);
      }
    };
    this.tokenTimer = setTimeout(() => void tick(), TOKEN_WAIT_MS);
  }

  /** "Connect an AI agent (MCP)": picks a client and copies its configuration. It never writes a file, and a read does not need work to be running. */
  private connect(): Promise<string | undefined> {
    return runConnect(
      {
        state: () => ({ token: this.token, role: this.role, port: this.port, url: this.url }),
        waitForToken: async () => {
          for (let waited = 0; !this.token && waited < CONNECT_TOKEN_WAIT_MS; waited += TOKEN_WAIT_MS) {
            await new Promise((resolve) => setTimeout(resolve, TOKEN_WAIT_MS));
            await this.readToken();
          }
          return this.token;
        },
        pickClient: async (clients) =>
          (
            await vscode.window.showQuickPick(
              clients.map((c) => ({ label: c.label, description: c.description, id: c.id })),
              { title: "Connect an AI agent (MCP)", placeHolder: "Which agent do you use?" }
            )
          )?.id,
        copy: (text) => Promise.resolve(vscode.env.clipboard.writeText(text)),
        info: async (message, ...buttons) => vscode.window.showInformationMessage(message, ...buttons),
        warn: async (message, ...buttons) => vscode.window.showWarningMessage(message, ...buttons),
      },
      CLIENTS,
      COPILOT_AUTOMATIC_MESSAGE
    );
  }

  /** Copies the rules snippet for the agent's rules file. It carries no token and no address, so it is the same for every project. */
  private async copyAgentRules(): Promise<void> {
    await vscode.env.clipboard.writeText(AGENT_RULES);
    void vscode.window.showInformationMessage(AGENT_RULES_COPIED_MESSAGE);
  }

  /** Replaces the token; every configured client then gets 401 until its entry is updated. */
  private async regenerateToken(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(REGENERATE_CONFIRMATION, { modal: true }, "Regenerate");
    if (choice !== "Regenerate") {
      return;
    }
    const created = generateToken();
    await this.deps.context.secrets.store(TOKEN_SECRET_KEY, created);
    this.token = created;
    this.log("regenerated the MCP token");
    this.definitionsChanged.fire();
    // The agents still sending the old token are expected now: no extra warning for them.
    this.oldTokenShown = true;
    void vscode.window.showInformationMessage(REGENERATED_MESSAGE, CONNECT_NOW_BUTTON).then((choice) => {
      if (choice === CONNECT_NOW_BUTTON) {
        void this.connect();
      }
    });
  }

  /** Once per session: an agent sends a token that is not the current one, so it is refused until its entry is copied again. */
  private warnOldToken(): void {
    if (this.oldTokenShown || this.disposed) {
      return;
    }
    this.oldTokenShown = true;
    void vscode.window.showWarningMessage(OLD_TOKEN_MESSAGE, CONNECT_NOW_BUTTON).then((choice) => {
      if (choice === CONNECT_NOW_BUTTON) {
        void this.connect();
      }
    });
  }

  /**
   * One warning per session. It waits a few seconds first: while the router
   * window is still creating the token, a probe can be refused for a moment,
   * which is not another program holding the port.
   */
  private warnBlockedLater(port: number): void {
    if (this.blockedShown) {
      return;
    }
    setTimeout(() => {
      if (this.role !== "blocked" || this.blockedShown || this.disposed) {
        return;
      }
      this.blockedShown = true;
      void vscode.window.showWarningMessage(blockedMessage(port), "Open Settings", "Show Output").then((choice) => {
        if (choice === "Open Settings") {
          void vscode.commands.executeCommand("workbench.action.openSettings", "mindstream.mcp.port");
        } else if (choice === "Show Output") {
          this.deps.output.show();
        }
      });
    }, BLOCKED_WARNING_DELAY_MS);
  }

  /** Copilot sees the server through the registration API; the headers carry the literal token (a `${input:}` one is not forwarded to Copilot). */
  private async copilotDefinitions(): Promise<vscode.McpHttpServerDefinition[]> {
    const servers = copilotServers(this.token || undefined, this.port);
    return Promise.all(servers.map(async (s) => new vscode.McpHttpServerDefinition(s.label, await vscode.env.asExternalUri(vscode.Uri.parse(s.url)), s.headers, this.version)));
  }

  /** Stops both servers and removes this window's registry entry. Safe to call twice. */
  async shutdown(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.tokenTimer) {
      clearTimeout(this.tokenTimer);
    }
    await this.hold?.stop();
    await this.inner.stop();
    this.registry.unregister();
    this.log("stopped");
  }

  dispose(): void {
    void this.shutdown();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }
}
