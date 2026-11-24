/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";
import { TestEndpoint } from "./mcpEndpoint";
import { TestWindow } from "./mcpWindow";

/** The median of a list of durations, in milliseconds. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Times `count` runs of `run`, in milliseconds each. */
async function time(count: number, run: () => Promise<unknown>): Promise<number[]> {
  const durations: number[] = [];
  for (let i = 0; i < count; i++) {
    const started = process.hrtime.bigint();
    await run();
    durations.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  return durations;
}

describe("MCP round trip: official v2 client -> router -> inner server -> result", () => {
  let endpoint: TestEndpoint;
  let other: TestWindow;

  beforeEach(async () => {
    endpoint = await new TestEndpoint(501).start();
    other = await new TestWindow("/work/other", 502, endpoint.registry.dir, endpoint.alive).open();
  });

  afterEach(async () => {
    await other.close();
    await endpoint.stop();
  });

  it("answers a local read and a forwarded read, and records the medians", async () => {
    const client = await endpoint.connect();
    for (let i = 0; i < 20; i++) {
      other.items.create({ typeId: other.typeId, title: `Note ${i}` });
      endpoint.win.items.create({ typeId: endpoint.win.typeId, title: `Note ${i}` });
    }
    await endpoint.call(client, "list_notes", {});
    await endpoint.call(client, "list_notes", { workspace: "/work/other" });

    const local = await time(50, () => endpoint.call(client, "list_notes", { limit: 20 }));
    const forwarded = await time(50, () => endpoint.call(client, "list_notes", { workspace: "/work/other", limit: 20 }));
    const extra = median(forwarded) - median(local);

    console.log(`      round trip, local window:      median ${median(local).toFixed(2)} ms`);
    console.log(`      round trip, forwarded window:  median ${median(forwarded).toFixed(2)} ms (forwarding adds about ${extra.toFixed(2)} ms)`);
    assert.ok(median(local) < 200, `local median ${median(local)} ms`);
    assert.ok(median(forwarded) < 250, `forwarded median ${median(forwarded)} ms`);
  });

  it("forwards a write to the other window and not to this one", async () => {
    const client = await endpoint.connect();
    const answer = await endpoint.call(client, "add_note", { workspace: "/work/other", title: "Across" });
    assert.notStrictEqual(answer.isError, true, JSON.stringify(answer));
    assert.strictEqual(other.storage.getData().items.length, 1);
    assert.strictEqual(endpoint.win.storage.getData().items.length, 0);
  });
});
