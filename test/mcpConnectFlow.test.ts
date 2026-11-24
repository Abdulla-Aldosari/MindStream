/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { CLIENTS, COPILOT_AUTOMATIC_MESSAGE, ClientId } from "../src/mcp/clientList";
import { COPY_ANYWAY_BUTTON, ConnectIo, SERVER_NAME, noTokenMessage, runConnect } from "../src/mcp/mcpConnectFlow";
import { PortRole } from "../src/mcp/portHolder";

const TOKEN = "Zk3-test_token-not-a-real-secret-0123456789";

interface Fake {
  io: ConnectIo;
  copied: string[];
  infos: string[];
  /** The buttons each info message offered, in order. */
  offered: string[][];
  warnings: string[];
}

/** Fake dialogs: `picks` is the client chosen, `buttons` the buttons pressed in order. */
function fake(options: { token?: string; laterToken?: string; role?: PortRole; pick?: ClientId; buttons?: (string | undefined)[] }): Fake {
  const state = { token: options.token ?? TOKEN };
  const out: Fake = { io: undefined as unknown as ConnectIo, copied: [], infos: [], offered: [], warnings: [] };
  const buttons = [...(options.buttons ?? [])];
  out.io = {
    state: () => ({ token: state.token, role: options.role ?? "router", port: 18741, url: "http://127.0.0.1:18741/mcp" }),
    waitForToken: async () => {
      state.token = options.laterToken ?? "";
      return state.token;
    },
    pickClient: async () => options.pick,
    copy: async (text) => void out.copied.push(text),
    info: async (message, ...offered) => {
      out.infos.push(message);
      out.offered.push(offered);
      return buttons.shift();
    },
    warn: async (message) => {
      out.warnings.push(message);
      return undefined;
    },
  };
  return out;
}

describe("the connection setup command", () => {
  it("copies the chosen client's configuration and says where to paste it", async () => {
    const f = fake({ pick: "cursor" });
    const text = await runConnect(f.io, CLIENTS, COPILOT_AUTOMATIC_MESSAGE);
    assert.strictEqual(f.copied.length, 1);
    assert.strictEqual(text, f.copied[0]);
    assert.ok(f.copied[0].includes("http://127.0.0.1:18741/mcp"));
    assert.ok(f.copied[0].includes(`Bearer ${TOKEN}`));
    assert.ok(f.infos[0].startsWith("Cursor: configuration copied."));
    assert.ok(f.infos[0].includes("~/.cursor/mcp.json"));
  });

  it("uses one entry name for every client", async () => {
    const f = fake({ pick: "codex" });
    await runConnect(f.io, CLIENTS, COPILOT_AUTOMATIC_MESSAGE);
    assert.ok(f.copied[0].includes(`[mcp_servers.${SERVER_NAME}]`));
  });

  it("never puts the token in a message", async () => {
    for (const pick of CLIENTS.map((c) => c.id)) {
      const f = fake({ pick, buttons: [COPY_ANYWAY_BUTTON] });
      await runConnect(f.io, CLIENTS, COPILOT_AUTOMATIC_MESSAGE);
      for (const message of [...f.infos, ...f.warnings]) {
        assert.ok(!message.includes(TOKEN), `${pick}: ${message}`);
      }
    }
  });

  it("does nothing when the user closes the picker", async () => {
    const f = fake({ pick: undefined });
    assert.strictEqual(await runConnect(f.io, CLIENTS, COPILOT_AUTOMATIC_MESSAGE), undefined);
    assert.deepStrictEqual(f.copied, []);
    assert.deepStrictEqual(f.infos, []);
  });

  it("offers no button after the copy, so nothing can replace the configuration on the clipboard", async () => {
    for (const pick of CLIENTS.map((c) => c.id)) {
      const f = fake({ pick, buttons: [COPY_ANYWAY_BUTTON] });
      await runConnect(f.io, CLIENTS, COPILOT_AUTOMATIC_MESSAGE);
      assert.strictEqual(f.copied.length, 1, pick);
      const afterCopy = f.offered[f.offered.length - 1];
      assert.ok(f.infos[f.infos.length - 1].includes("configuration copied"), pick);
      assert.deepStrictEqual(afterCopy, [], pick);
    }
  });
});

describe("the connection setup command: Copilot", () => {
  it("explains that nothing needs to be pasted, and copies nothing unless asked", async () => {
    const f = fake({ pick: "copilot", buttons: [undefined] });
    assert.strictEqual(await runConnect(f.io, CLIENTS, COPILOT_AUTOMATIC_MESSAGE), undefined);
    assert.strictEqual(f.infos[0], COPILOT_AUTOMATIC_MESSAGE);
    assert.deepStrictEqual(f.copied, []);
  });

  it("offers to copy the configuration anyway, for the Copilot CLI file", async () => {
    const f = fake({ pick: "copilot", buttons: [COPY_ANYWAY_BUTTON, undefined] });
    const text = await runConnect(f.io, CLIENTS, COPILOT_AUTOMATIC_MESSAGE);
    assert.ok(text?.includes('"type": "http"'));
    assert.strictEqual(f.copied.length, 1);
    assert.ok(f.infos[1].includes("~/.copilot/mcp-config.json"));
  });
});

describe("the connection setup command: no token yet", () => {
  it("waits for the token and goes on when the router window has created it", async () => {
    const f = fake({ token: "", laterToken: TOKEN, pick: "generic" });
    const text = await runConnect(f.io, CLIENTS, COPILOT_AUTOMATIC_MESSAGE);
    assert.ok(text?.includes(TOKEN));
    assert.deepStrictEqual(f.warnings, []);
  });

  it("warns that MindStream is still starting when the token never appears, and copies nothing", async () => {
    const f = fake({ token: "", laterToken: "", pick: "generic" });
    assert.strictEqual(await runConnect(f.io, CLIENTS, COPILOT_AUTOMATIC_MESSAGE), undefined);
    assert.deepStrictEqual(f.warnings, [noTokenMessage("router", 18741)]);
    assert.deepStrictEqual(f.copied, []);
  });

  it("reports another program holding the port, with the fix", async () => {
    const f = fake({ token: "", laterToken: "", role: "blocked", pick: "generic" });
    await runConnect(f.io, CLIENTS, COPILOT_AUTOMATIC_MESSAGE);
    assert.ok(f.warnings[0].includes("used by another program"));
    assert.ok(f.warnings[0].includes("mindstream.mcp.port"));
    assert.deepStrictEqual(f.copied, []);
  });
});
