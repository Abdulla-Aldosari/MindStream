import * as fs from "node:fs";
import { buildData, expect, notification, readData, runCommand, showSidebar, test, waitForData } from "./helpers";

const BROKEN = '{"items": [ {"title": "my notes"'; // a truncated file

test("a broken data file warns, and the file is never overwritten", async ({ launch }) => {
  const session = await launch({ rawData: BROKEN });
  const sidebar = await showSidebar(session.page);

  await expect(notification(session.page, /not valid/)).toBeVisible();
  await expect(notification(session.page, /Saving is turned off/)).toBeVisible();

  // Saving a note is refused: the editor keeps what was typed and the file stays as it was.
  await sidebar.locator(".empty-create-btn").click();
  await sidebar.locator("#f-title").fill("Must not be lost");
  await sidebar.locator("#modal-save").click();

  await expect(notification(session.page, /Nothing was changed/)).toBeVisible();
  await expect(sidebar.locator("#modal")).toBeVisible();
  await expect(sidebar.locator("#f-title")).toHaveValue("Must not be lost");
  await expect(sidebar.locator("#modal-save")).toBeEnabled();
  expect(fs.readFileSync(session.dataFile, "utf8")).toBe(BROKEN);
  expect(fs.existsSync(`${session.dataFile}.tmp`)).toBe(false);
});

test("fixing the file turns saving back on and a note can then be saved", async ({ launch }) => {
  const session = await launch({ rawData: BROKEN });
  const sidebar = await showSidebar(session.page);
  await expect(notification(session.page, /Saving is turned off/)).toBeVisible();

  fs.writeFileSync(session.dataFile, JSON.stringify(buildData([{ title: "Recovered note" }]), null, 2), "utf8");
  await expect(notification(session.page, /Saving is back on/)).toBeVisible();
  await expect(sidebar.locator(".card", { hasText: "Recovered note" })).toBeVisible();

  await runCommand(session.page, "MindStream: Quick Note");
  await expect(sidebar.locator("#modal")).toBeVisible();
  await sidebar.locator("#f-title").fill("Saved after the fix");
  await sidebar.locator("#modal-save").click();

  await expect(sidebar.locator("#modal")).toBeHidden();
  await waitForData(session, (d) => d.items.some((n) => n.title === "Saved after the fix"));
  expect(readData(session).items.map((n) => n.title)).toEqual(["Recovered note", "Saved after the fix"]);
});

test("deleting a broken file turns saving back on", async ({ launch }) => {
  const session = await launch({ rawData: BROKEN });
  await showSidebar(session.page);
  await expect(notification(session.page, /Saving is turned off/)).toBeVisible();

  fs.rmSync(session.dataFile);

  await expect(notification(session.page, /Saving is back on/)).toBeVisible();
});

test("an empty data file is a new project: a note can be saved", async ({ launch }) => {
  const session = await launch({ rawData: "" });
  const sidebar = await showSidebar(session.page);

  await sidebar.locator(".empty-create-btn").click();
  await sidebar.locator("#f-title").fill("First note in an empty file");
  await sidebar.locator("#modal-save").click();

  await expect(sidebar.locator("#modal")).toBeHidden();
  await waitForData(session, (d) => d.items.length === 1);
  expect(readData(session).items[0].title).toBe("First note in an empty file");
});
