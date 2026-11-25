import { expect, test } from "@playwright/test"

import { Seed } from "./seed"

// e2e journey 1 (§10): a request shows as Requested on Today (spec F1,
// WF-B1, WF-B2) and in the Library (WF-H1).

const TEXT =
  "My mum asked if mRNA vaccines change your DNA and I couldn't answer. I did high school biology. About 5 hours."

let seed: Seed
test.beforeAll(() => {
  seed = new Seed().reset()
})
test.afterAll(() => {
  seed.reset().close()
})

test("journey 1: request a course, then see it as Requested", async ({
  page,
}) => {
  await page.goto("/")
  await page.getByRole("link", { name: "New request" }).click()
  await expect(page).toHaveURL("/new")
  await expect(
    page.getByRole("heading", { level: 1, name: "New request" })
  ).toBeVisible()

  const box = page.getByLabel("What do you want to learn, and why?")
  await expect(box).toBeFocused()
  await expect(
    page.getByText("Say what you know, how deep to go, how long you have")
  ).toBeVisible()

  // Too short: an inline error, and nothing is sent.
  await box.fill("mRNA")
  await page.getByRole("button", { name: "Request course" }).click()
  const error = page.locator("#request-error")
  await expect(error).toHaveRole("alert")
  await expect(error).toHaveText(
    "Describe what you want to learn in at least 10 characters."
  )
  await expect(box).toHaveAttribute("aria-invalid", "true")
  await expect(page).toHaveURL("/new")

  await box.fill(TEXT)
  await expect(error).toHaveCount(0)
  await page.getByRole("button", { name: "Request course" }).click()

  // Back on Today with the toast (WF-B2).
  await expect(page).toHaveURL("/")
  await expect(
    page.getByText("Request sent. It'll appear under Ready once it's built.")
  ).toBeVisible()
  const requested = page.getByRole("region", { name: "Requested" })
  const tile = requested.locator("[data-slot=request-tile]")
  await expect(tile).toHaveCount(1)
  await expect(tile).toContainText("My mum asked if mRNA vaccines")
  await expect(tile).toContainText("requested")

  // The same request in the Library.
  await page.goto("/library")
  await expect(
    page
      .getByRole("region", { name: "Requested" })
      .locator("[data-slot=request-tile]")
  ).toContainText("My mum asked if mRNA vaccines")
})

test("Cancel returns to Today without sending", async ({ page }) => {
  seed.reset()
  await page.goto("/new")
  await page
    .getByLabel("What do you want to learn, and why?")
    .fill("Something I changed my mind about")
  await page.getByRole("link", { name: "Cancel" }).click()
  await expect(page).toHaveURL("/")
  await expect(page.getByRole("region", { name: "Requested" })).toHaveCount(0)
})

test("an expired cookie sends the learner to /unlock, not an error", async ({
  page,
}) => {
  seed.reset()
  await page.goto("/new")
  await page
    .getByLabel("What do you want to learn, and why?")
    .fill("Something to learn after my cookie ran out")
  await page.context().clearCookies()
  await page.getByRole("button", { name: "Request course" }).click()
  await expect(page).toHaveURL(/\/unlock/)
  await expect(page.getByText("Couldn't send your request")).toHaveCount(0)
})
