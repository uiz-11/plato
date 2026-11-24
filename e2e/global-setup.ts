import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import { chromium, type FullConfig } from "@playwright/test"

import { E2E_PASSCODE, STORAGE_STATE } from "./auth"

// Unlocks once and stores the cookie, so every spec starts unlocked (§10.1).
// Specs that test the gate itself opt out with `test.use(locked)`.
export default async function globalSetup(config: FullConfig) {
  const { baseURL } = config.projects[0].use
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ baseURL })
    await page.goto("/unlock")
    await page.getByLabel("Passcode").fill(E2E_PASSCODE)
    await page.getByRole("button", { name: "Unlock" }).click()
    await page.waitForURL("/")
    mkdirSync(dirname(STORAGE_STATE), { recursive: true })
    await page.context().storageState({ path: STORAGE_STATE })
  } finally {
    await browser.close()
  }
}
