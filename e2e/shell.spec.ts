import { expect, test } from "@playwright/test"

// The app shell (T12): a sidebar on desktop; on phone, bottom tabs and a "+"
// in the header (§9.4, WF-I1).
test("shows the shell navigation for the viewport @phone", async ({
  page,
  isMobile,
}) => {
  await page.goto("/")
  await expect(page).toHaveURL("/")
  const nav = page.getByRole("navigation", { name: "Main" })
  await expect(nav).toHaveCount(1)
  await expect(nav.getByRole("link", { name: "Today" })).toHaveAttribute(
    "aria-current",
    "page"
  )
  await expect(nav.getByRole("link", { name: "Library" })).toBeVisible()

  const newRequest = page.getByRole("link", { name: "New request" })
  await expect(newRequest).toBeVisible()
  // New request is an action, not a nav destination: the header "+" on
  // phone, a button under the nav on desktop.
  await expect(nav.getByRole("link", { name: "New request" })).toHaveCount(0)
  const box = await newRequest.boundingBox()
  if (isMobile) {
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }
  // No horizontal scroll at either width.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  )
  expect(overflow).toBe(false)
})

test("unknown URLs 404 inside the shell @phone", async ({ page }) => {
  const res = await page.goto("/no-such-page")
  expect(res?.status()).toBe(404)
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" })
  ).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible()
  await page.getByRole("link", { name: "Back to Today" }).click()
  await expect(page).toHaveURL("/")
})
