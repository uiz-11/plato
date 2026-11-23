import { tmpdir } from "node:os"
import { join } from "node:path"

import { defineConfig, devices } from "@playwright/test"

const root = import.meta.dirname
// Workers re-evaluate this file, so fix the DB path once per run and hand it
// down through the environment.
process.env.PLATO_E2E_DB_PATH ??= join(tmpdir(), `plato-e2e-${Date.now()}.db`)

const port = Number(process.env.E2E_PORT ?? 3100)
const baseURL = `http://127.0.0.1:${port}`

// e2e runs against the standalone server, as in production (§10.1).
// Build first: `npm run build`.
export default defineConfig({
  testDir: join(root, "e2e"),
  globalTeardown: join(root, "e2e/global-teardown.ts"),
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
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
  webServer: {
    command: "node .next/standalone/server.js",
    cwd: root,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      PLATO_DB_PATH: process.env.PLATO_E2E_DB_PATH,
      PLATO_CONTENT_DIR: join(root, "e2e/fixtures/content"),
      PLATO_PASSCODE: "e2e-passcode-at-least-20-chars",
      PLATO_COOKIE_SECRET: "e2e-cookie-secret",
      PLATO_TEST_HOOKS: "1",
    },
  },
})
