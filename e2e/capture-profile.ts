import { _electron } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prepareUserData, resolveVscodeExecutable, saveProfile, vscodeArgs } from "./profile";

/**
 * `npm run e2e:profile`: opens a window the way the tests do, waits while the
 * developer places and sizes it and drags the sidebar to the wanted width, and
 * saves that layout as the local profile once the window is closed.
 */
async function main(): Promise<void> {
  const dirs = {
    workspace: fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-profile-ws-")),
    userData: fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-profile-user-")),
    extensions: fs.mkdtempSync(path.join(os.tmpdir(), "mindstream-profile-ext-")),
  };
  try {
    prepareUserData(dirs.userData);
    const app = await _electron.launch({ executablePath: await resolveVscodeExecutable(), args: vscodeArgs(dirs) });
    await app.firstWindow();
    console.log("Place and size the window, open the MindStream view and drag the sidebar to the width you want, then close the window.");
    await app.waitForEvent("close", { timeout: 0 });
    console.log(`Saved profile: ${saveProfile(dirs.userData)}`);
  } finally {
    Object.values(dirs).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
