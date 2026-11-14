import { defineConfig } from "@playwright/test";

// Every test launches its own real VS Code window with the built extension
// (`npm run compile` first; `npm run test:e2e` does it). Windows are heavy, so
// the tests run one at a time.
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
});
