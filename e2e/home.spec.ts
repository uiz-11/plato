import { expect, test } from "@playwright/test"

test("serves the placeholder home page", async ({ page }) => {
  await page.goto("/")
  // /unlock also has an h1 "Plato", so check where we are.
  await expect(page).toHaveURL("/")
  await expect(page.getByText("Nothing here yet.")).toBeVisible()
  await expect(
    page.getByRole("heading", { level: 1, name: "Plato" })
  ).toBeVisible()
})
