import { tmpdir } from "node:os"
import { join } from "node:path"

import { defineConfig, devices } from "@playwright/test"

import { E2E_COOKIE_SECRET, E2E_PASSCODE, STORAGE_STATE } from "./e2e/auth"

const root = import.meta.dirname
// Workers re-evaluate this file, so fix the DB path once per run and hand it
// down through the environment.
process.env.PLATO_E2E_DB_PATH ??= join(tmpdir(), `plato-e2e-${Date.now()}.db`)
process.env.PLATO_E2E_EMPTY_DB_PATH ??= join(
  tmpdir(),
  `plato-e2e-empty-${Date.now()}.db`
)

const port = Number(process.env.E2E_PORT ?? 3100)
const baseURL = `http://127.0.0.1:${port}`
// A second server with no published course, for Today's first run (WF-A2):
// `emptyBaseURL` in e2e/auth.ts. Cookies ignore the port, so the stored cookie
// unlocks it too.
const emptyPort = port + 1

// e2e runs against the standalone server, as in production (§10.1).
// Build first: `npm run build`.
export default defineConfig({
  testDir: join(root, "e2e"),
  globalSetup: join(root, "e2e/global-setup.ts"),
  globalTeardown: join(root, "e2e/global-teardown.ts"),
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Every spec starts unlocked (global setup); `test.use(locked)` opts out.
  use: { baseURL, storageState: STORAGE_STATE, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      // Journeys 2, 4 and 7 and the axe spec also run on a phone. Tag them @phone.
      name: "phone",
      grep: /@phone/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    server(port, process.env.PLATO_E2E_DB_PATH, "e2e/fixtures/content"),
    server(
      emptyPort,
      process.env.PLATO_E2E_EMPTY_DB_PATH,
      "e2e/fixtures/empty-content"
    ),
  ],
})

function server(port: number, dbPath: string | undefined, content: string) {
  if (!dbPath) throw new Error("No e2e database path")
  return {
    command: "node .next/standalone/server.js",
    cwd: root,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      PLATO_DB_PATH: dbPath,
      PLATO_CONTENT_DIR: join(root, content),
      PLATO_PASSCODE: E2E_PASSCODE,
      PLATO_COOKIE_SECRET: E2E_COOKIE_SECRET,
      PLATO_TEST_HOOKS: "1",
      // e2e/seed.ts computes learning days in UTC; never inherit the shell's.
      PLATO_TIME_ZONE: "UTC",
    },
  }
}
