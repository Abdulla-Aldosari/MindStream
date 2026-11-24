/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

import * as assert from "assert";

// media/dateFormat.js is a side-effect-free browser script that exports its
// helpers for Node-based tests through a guarded `module.exports` block.
const DateFormat = require("../media/dateFormat.js") as {
  formatDate(value: unknown): string;
  formatDateTime(value: unknown): string;
};

describe("DateFormat.formatDate", () => {
  it("formats a date as dd/MM/yyyy with a two-digit day and month", () => {
    assert.strictEqual(DateFormat.formatDate(new Date(2026, 0, 5, 10, 30)), "05/01/2026");
    assert.strictEqual(DateFormat.formatDate(new Date(2026, 10, 23, 23, 59)), "23/11/2026");
  });

  it("reads an ISO string in local time, like the Date it names", () => {
    const iso = "2026-11-01T10:00:00.000Z";
    const d = new Date(iso);
    const expected = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    assert.strictEqual(DateFormat.formatDate(iso), expected);
  });

  it("returns an empty string for an empty or invalid value", () => {
    assert.strictEqual(DateFormat.formatDate(undefined), "");
    assert.strictEqual(DateFormat.formatDate(""), "");
    assert.strictEqual(DateFormat.formatDate("not-a-date"), "");
  });
});

describe("DateFormat.formatDateTime", () => {
  it("formats date and time as dd/MM/yyyy hh:mm:ss AM|PM with a two-digit hour", () => {
    assert.strictEqual(DateFormat.formatDateTime(new Date(2026, 10, 15, 5, 7, 9)), "15/11/2026 05:07:09 AM");
    assert.strictEqual(DateFormat.formatDateTime(new Date(2026, 10, 15, 17, 55, 22)), "15/11/2026 05:55:22 PM");
  });

  it("shows midnight as 12 AM and noon as 12 PM", () => {
    assert.strictEqual(DateFormat.formatDateTime(new Date(2026, 10, 15, 12, 0, 0)), "15/11/2026 12:00:00 PM");
    assert.strictEqual(DateFormat.formatDateTime(new Date(2026, 10, 15, 23, 59, 59)), "15/11/2026 11:59:59 PM");
    assert.strictEqual(DateFormat.formatDateTime(new Date(2026, 10, 15, 0, 0, 0)), "15/11/2026 12:00:00 AM");
  });

  it("returns an empty string for an empty or invalid value", () => {
    assert.strictEqual(DateFormat.formatDateTime(undefined), "");
    assert.strictEqual(DateFormat.formatDateTime("not-a-date"), "");
  });
});
