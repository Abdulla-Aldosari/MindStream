/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as path from "node:path";
import { buildData, clickMoreMenuItem, expect, expectCommandHidden, readData, runCommand, showSidebar, test, waitForData } from "./helpers";
import { Agent, dataOf, freePort, waitForMcp } from "./mcpAgent";

test("while work is paused an agent's write is refused and changes nothing, reads still work, and resuming lets the same call succeed", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({ settings: { "mindstream.mcp.port": port }, data: buildData([{ title: "Existing" }]) });
  const sidebar = await showSidebar(session.page);
  await waitForMcp(port);
  const agent = await Agent.connect(session);
  try {
    await runCommand(session.page, "MindStream: Pause work and show note");
    await sidebar.locator("#work-pause-input").fill("Stopped before the release build.");
    await sidebar.locator("#work-pause-save").click();
    await waitForData(session, (d) => d.workPauseNote?.paused === true);
    const before = JSON.stringify(readData(session));

    const refused = await agent.call("add_note", { title: "Blocked by the lock" });
    expect(refused.isError).toBe(true);
    expect(dataOf(refused).code).toBe("WORK_PAUSED");
    expect(String(dataOf(refused).message)).toContain("Work paused - click to resume");
    expect(JSON.stringify(readData(session))).toBe(before);

    const read = await agent.call("get_work_pause_note");
    expect(read.isError).not.toBe(true);
    expect(dataOf<{ text: string }>(read).text).toContain("Stopped before the release build.");
    expect((await agent.call("list_notes")).isError).not.toBe(true);

    // Same steps as the Work Pause spec: while locked the commands are hidden, and the palette round trip moves focus out of the webview so the More menu opens with its items.
    await expect(sidebar.locator("body")).toHaveClass(/work-pause-locked/);
    await expectCommandHidden(session.page, "MindStream: Quick Note");
    await clickMoreMenuItem(session.page, "Work paused - click to resume");
    await waitForData(session, (d) => d.workPauseNote?.paused === false);
    const accepted = await agent.call("add_note", { title: "Added after resuming" });
    expect(accepted.isError).not.toBe(true);
    await waitForData(session, (d) => d.items.some((n) => n.title === "Added after resuming"));
  } finally {
    await agent.close();
  }
});

test("a folder that is not open is refused with the open folder in the message, and nothing is written", async ({ launch }) => {
  const port = await freePort();
  const session = await launch({ settings: { "mindstream.mcp.port": port }, data: buildData() });
  await waitForMcp(port);
  const agent = await Agent.connect(session);
  try {
    const elsewhere = path.join(path.dirname(session.workspace), "mindstream-not-open");
    const answer = await agent.call("add_note", { workspace: elsewhere, title: "Nowhere" });
    expect(answer.isError).toBe(true);
    expect(dataOf(answer).code).toBe("WORKSPACE_NOT_OPEN");
    // VS Code reports the folder with its own drive-letter case, so compare without case.
    expect(String(dataOf(answer).message).toLowerCase()).toContain(session.workspace.toLowerCase());
    expect(String(dataOf(answer).message)).toContain("Nothing was changed.");
    expect(readData(session).items).toHaveLength(0);

    const relative = await agent.call("list_notes", { workspace: "some/relative/path" });
    expect(dataOf(relative).code).toBe("INVALID_INPUT");
  } finally {
    await agent.close();
  }
});
