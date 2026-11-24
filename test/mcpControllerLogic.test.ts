/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import {
  DEFAULT_MCP_PORT,
  authHeaders,
  blockedMessage,
  copilotServers,
  endpointUrl,
  generateToken,
  REGENERATE_CONFIRMATION,
  REGENERATED_MESSAGE,
  portProblem,
  resolvePort,
  shouldCreateToken,
  statusView,
} from "../src/mcp/mcpControllerLogic";

describe("mcp port setting", () => {
  it("accepts a whole number from 1024 to 65535", () => {
    for (const value of [1024, 18741, 65535]) {
      assert.strictEqual(portProblem(value), undefined, String(value));
      assert.strictEqual(resolvePort(value), value);
    }
  });

  it("refuses anything else and falls back to the default", () => {
    for (const value of [0, 80, 1023, 65536, -1, 1.5, "18741", undefined, null, NaN]) {
      assert.ok(portProblem(value), String(value));
      assert.strictEqual(resolvePort(value), DEFAULT_MCP_PORT, String(value));
    }
  });

  it("defaults to 18741", () => {
    assert.strictEqual(DEFAULT_MCP_PORT, 18741);
  });
});

describe("mcp token", () => {
  it("is 32 random bytes as base64url, different every time", () => {
    const a = generateToken();
    const b = generateToken();
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.notStrictEqual(a, b);
  });

  it("asks the random source for exactly 32 bytes", () => {
    let asked = 0;
    generateToken((size) => {
      asked = size;
      return Buffer.alloc(size, 1);
    });
    assert.strictEqual(asked, 32);
  });

  it("is created only by the router window, and only while it is empty", () => {
    assert.strictEqual(shouldCreateToken("router", undefined), true);
    assert.strictEqual(shouldCreateToken("router", ""), true);
    assert.strictEqual(shouldCreateToken("router", "existing"), false);
    for (const role of ["follower", "blocked", undefined] as const) {
      assert.strictEqual(shouldCreateToken(role, undefined), false, String(role));
    }
  });

  it("goes into the Authorization header as a bearer credential", () => {
    assert.deepStrictEqual(authHeaders("abc"), { Authorization: "Bearer abc" });
  });
});

describe("mcp endpoint url", () => {
  it("is the loopback address, the port, and /mcp: the same in every window", () => {
    assert.strictEqual(endpointUrl(18741), "http://127.0.0.1:18741/mcp");
    assert.strictEqual(endpointUrl(30000), "http://127.0.0.1:30000/mcp");
  });
});

describe("mcp status bar", () => {
  it("is hidden while agents can reach MindStream: a router, a follower, or before the first attempt", () => {
    for (const role of ["router", "follower", undefined] as const) {
      assert.strictEqual(statusView(role, 18741), undefined, String(role));
    }
  });

  it("shows a warning when another program holds the port, with the port and the setting to change", () => {
    const view = statusView("blocked", 18741);
    assert.strictEqual(view?.text, "$(warning) MCP");
    assert.ok(view?.tooltip.includes("port 18741 is used by another program"));
    assert.ok(view?.tooltip.includes("mindstream.mcp.port"));
  });

  it("gives the blocked notification the port, the setting to change, and that the agent entry must be updated", () => {
    const message = blockedMessage(18741);
    assert.ok(message.includes("port 18741"));
    assert.ok(message.includes("Set mindstream.mcp.port to a free port"));
    assert.ok(message.includes("update your agent's MindStream entry"));
  });
});

describe("mcp token regeneration texts", () => {
  it("say that the token is shared by every window, WSL and SSH included, and name no token", () => {
    for (const text of [REGENERATE_CONFIRMATION, REGENERATED_MESSAGE]) {
      assert.ok(text.includes("WSL"), text);
      assert.ok(text.includes("SSH"), text);
      assert.ok(!/Bearer|[A-Za-z0-9_-]{43}/.test(text), text);
    }
    assert.ok(REGENERATE_CONFIRMATION.includes("shared by all your VS Code windows"));
  });
});

describe("copilot registration", () => {
  it("offers one server with the token as a bearer header, whatever the window's role", () => {
    const servers = copilotServers("tok", 18741);
    assert.deepStrictEqual(servers, [{ label: "MindStream", url: "http://127.0.0.1:18741/mcp", headers: { Authorization: "Bearer tok" } }]);
  });

  it("offers nothing until the token exists", () => {
    assert.deepStrictEqual(copilotServers(undefined, 18741), []);
    assert.deepStrictEqual(copilotServers("", 18741), []);
  });
});
