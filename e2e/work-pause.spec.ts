import { buildData, clickMoreMenuItem, expect, readData, runCommand, showSidebar, test, waitForData } from "./helpers";

test("pausing work locks the sidebar behind the hand-off note, and resuming unlocks it", async ({ launch }) => {
  const session = await launch({ data: buildData([{ title: "A note" }]) });
  const sidebar = await showSidebar(session.page);
  await expect(sidebar.locator(".card")).toHaveCount(1);

  // With no saved note, "Pause work" opens the editor first.
  await runCommand(session.page, "MindStream: Pause work and show note");
  await expect(sidebar.locator("#work-pause-input")).toBeVisible();
  await sidebar.locator("#work-pause-input").fill("Stopped before the release build. Next: run the checks.");
  await sidebar.locator("#work-pause-save").click();

  await expect(sidebar.locator("body")).toHaveClass(/work-pause-locked/);
  await expect(sidebar.locator("#work-pause-view")).toContainText("Stopped before the release build");
  await waitForData(session, (d) => d.workPauseNote?.paused === true);
  expect(readData(session).workPauseNote?.text).toContain("run the checks");

  // The lock is on the commands too: with work paused, creating a note does nothing.
  await runCommand(session.page, "MindStream: Quick Note").catch(() => undefined);
  await expect(sidebar.locator("#modal")).toBeHidden();

  // The only way out is the More menu: the resume command is hidden from the palette on purpose.
  await clickMoreMenuItem(session.page, "Work paused - click to resume");
  await expect(sidebar.locator("body")).not.toHaveClass(/work-pause-locked/);
  await expect(sidebar.locator(".card")).toHaveCount(1);
  await waitForData(session, (d) => d.workPauseNote?.paused === false);
});

test("a paused project opens locked, even after a restart", async ({ launch }) => {
  const data = buildData([{ title: "Behind the lock" }]);
  data.workPauseNote = { text: "Pick up at the storage tests.", updatedAt: "2026-11-01T10:00:00.000Z", paused: true };
  const session = await launch({ data });
  const sidebar = await showSidebar(session.page);

  await expect(sidebar.locator("body")).toHaveClass(/work-pause-locked/);
  await expect(sidebar.locator("#work-pause-view")).toContainText("Pick up at the storage tests.");
});
