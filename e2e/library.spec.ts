import { expect, test } from "@playwright/test"

import { ENC, LEAP, Seed } from "./seed"

// The Library (§9.4, WF-H1): sections in order, course cards open the course
// page, and requests are dashed tiles with nothing to open.

let seed: Seed
test.beforeAll(() => {
  seed = new Seed().reset()
})
test.afterAll(() => {
  seed.reset().close()
})

test("groups courses and requests by status @phone", async ({ page }) => {
  seed.completeCourse(LEAP, -3).completeLesson(ENC.id, ENC.lessons[0], -1)
  await page.goto("/")
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Library" })
    .click()
  await expect(page).toHaveURL("/library")
  await expect(
    page.getByRole("heading", { level: 1, name: "Library" })
  ).toBeVisible()

  const headings = page.getByRole("heading", { level: 2 })
  await expect(headings).toHaveText(["In progress", "Complete"])

  const inProgress = page.getByRole("region", { name: "In progress" })
  await expect(inProgress).toContainText(ENC.title)
  await expect(inProgress).toContainText("1 of 4 completed")
  await expect(page.getByRole("region", { name: "Complete" })).toContainText(
    "1 of 1 completed ✓"
  )

  await page
    .getByRole("region", { name: "Complete" })
    .getByRole("link", { name: new RegExp(LEAP.title) })
    .click()
  await expect(page).toHaveURL(`/courses/${LEAP.id}`)
})

test("lists Ready courses and open requests", async ({ page }) => {
  seed.reset()
  await page.goto("/new")
  await page
    .getByLabel("What do you want to learn, and why?")
    .fill("Climate tipping points, for a curious non-scientist")
  await page.getByRole("button", { name: "Request course" }).click()
  await expect(page).toHaveURL("/")

  await page.goto("/library")
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Ready",
    "Requested",
  ])
  const ready = page.getByRole("region", { name: "Ready" })
  await expect(ready.locator("[data-slot=course-card]")).toHaveCount(2)
  const tile = page
    .getByRole("region", { name: "Requested" })
    .locator("[data-slot=request-tile]")
  await expect(tile).toContainText("Climate tipping points")
  // Nothing to open yet.
  await expect(tile.getByRole("link")).toHaveCount(0)
})
