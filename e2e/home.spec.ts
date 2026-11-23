import { expect, test } from "@playwright/test"

test("serves the placeholder home page", async ({ page }) => {
  await page.goto("/")
  await expect(
    page.getByRole("heading", { level: 1, name: "Plato" })
  ).toBeVisible()
})
