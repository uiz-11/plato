import { expect, test } from "@playwright/test"

import { E2E_PASSCODE, locked } from "./auth"

test.describe("locked", () => {
  test.use(locked)

  test("locked → unlock → placeholder home", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL("/unlock")

    const passcode = page.getByLabel("Passcode")
    await passcode.fill("not the passcode")
    await page.getByRole("button", { name: "Unlock" }).click()
    await expect(page.getByText("That passcode isn't right.")).toBeVisible()
    await expect(page).toHaveURL("/unlock")

    await passcode.fill(E2E_PASSCODE)
    await page.getByRole("button", { name: "Unlock" }).click()
    await expect(page).toHaveURL("/")
    await expect(
      page.getByRole("heading", { level: 1, name: "Plato" })
    ).toBeVisible()

    const cookie = (await page.context().cookies()).find(
      (c) => c.name === "plato_session"
    )!
    expect(cookie).toMatchObject({
      name: "plato_session",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    })
    // About one year out (§8.5).
    const days = (cookie.expires * 1000 - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(364)
    expect(days).toBeLessThan(366)
  })

  test("returns to the page that was asked for", async ({ page }) => {
    await page.goto("/library?x=1")
    await expect(page).toHaveURL("/unlock?next=%2Flibrary%3Fx%3D1")
    await page.getByLabel("Passcode").fill(E2E_PASSCODE)
    await page.getByRole("button", { name: "Unlock" }).click()
    // /library arrives with T13; reaching it, 404 or not, means it redirected.
    await expect(page).toHaveURL("/library?x=1")
  })

  test("a forged cookie does not unlock", async ({ page, context }) => {
    await context.addCookies([
      {
        name: "plato_session",
        value: `${Date.now() + 86_400_000}.${"A".repeat(43)}`,
        url: "http://127.0.0.1",
      },
    ])
    await page.goto("/")
    await expect(page).toHaveURL("/unlock")
  })

  test("accepts the passcode as a bearer token", async ({ request }) => {
    const refused = await request.get("/", { maxRedirects: 0 })
    expect(refused.status()).toBe(307)
    expect(refused.headers().location).toMatch(/\/unlock$/)

    const allowed = await request.get("/", {
      maxRedirects: 0,
      headers: { authorization: `Bearer ${E2E_PASSCODE}` },
    })
    expect(allowed.status()).toBe(200)
  })
})

test("an unlocked visit to /unlock goes home", async ({ page }) => {
  await page.goto("/unlock")
  await expect(page).toHaveURL("/")
})

test("next cannot point to another site", async ({ page }) => {
  // "/\t/evil.example" (browsers drop the tab) and "/.//evil.example" (dot
  // segments collapse) would both mean //evil.example.
  for (const next of ["%2F%09%2Fevil.example", "%2F.%2F%2Fevil.example"]) {
    await page.goto(`/unlock?next=${next}`)
    await expect(page).toHaveURL("/")
  }
})
