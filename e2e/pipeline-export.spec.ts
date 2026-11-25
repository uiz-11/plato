import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

import { exportRequests } from "../scripts/lib/requests-export"
import { E2E_PASSCODE } from "./auth"
import { Seed } from "./seed"

// T20 (§11.1): a request made in the app appears in the pipeline export, and
// a Not built reason shows on Today. The fixture `not-built.json` lists
// NOT_BUILT, so seeding a request with that id makes it Not built.

const TEXT =
  "How do tides work, and why are there two a day? I know a little physics. About 3 hours."
const NOT_BUILT = "5d0c3b8e-7a41-4f2e-9c6d-1e2f3a4b5c6d"
const NOT_BUILT_REASON = "A support request, not a topic to learn"

let seed: Seed
let out: string
test.beforeAll(() => {
  seed = new Seed().reset()
})
test.beforeEach(() => {
  seed.reset()
  out = mkdtempSync(join(tmpdir(), "plato-e2e-export-"))
})
test.afterEach(() => rmSync(out, { recursive: true, force: true }))
test.afterAll(() => {
  seed.reset().close()
})

test("a request made in the app appears in the export", async ({
  page,
  baseURL,
}) => {
  seed.request(NOT_BUILT, "Please reset my password for me", 60)

  await page.goto("/new")
  await page.getByLabel("What do you want to learn, and why?").fill(TEXT)
  await page.getByRole("button", { name: "Request course" }).click()
  await expect(page).toHaveURL("/")

  const result = await exportRequests({
    baseUrl: baseURL!,
    passcode: E2E_PASSCODE,
    outDir: out,
  })
  expect(result).toMatchObject({ ok: true })
  // Only the open request: the Not built one is left out.
  const files = readdirSync(out)
  expect(files).toHaveLength(1)
  const exported = JSON.parse(readFileSync(join(out, files[0]), "utf8"))
  expect(exported).toEqual({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    text: TEXT,
    createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
  })
  expect(files[0]).toBe(`${exported.id}.json`)
})

test("the endpoint needs the bearer passcode, not the cookie", async ({
  page,
  playwright,
  baseURL,
}) => {
  // The page's context carries the learner's cookie.
  expect((await page.request.get("/api/pipeline/requests")).status()).toBe(401)
  const api = await playwright.request.newContext({ baseURL })
  try {
    expect((await api.get("/api/pipeline/requests")).status()).toBe(401)
    const ok = await api.get("/api/pipeline/requests", {
      headers: { Authorization: `Bearer ${E2E_PASSCODE}` },
    })
    expect(ok.status()).toBe(200)
    expect(await ok.json()).toEqual([])
  } finally {
    await api.dispose()
  }
})

test("a Not built reason shows on Today @phone", async ({ page }) => {
  seed.request(NOT_BUILT, "Please reset my password for me")
  await page.goto("/")
  const tile = page
    .getByRole("region", { name: "Requested" })
    .locator("[data-slot=request-tile]")
  await expect(tile).toHaveCount(1)
  await expect(tile).toContainText("Please reset my password for me")
  await expect(tile).toContainText(NOT_BUILT_REASON)
  await expect(tile).toContainText("not built")
})
