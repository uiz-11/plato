import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { locked } from "./auth"

// One row per screen. Each screen task adds its rows (§10).
const screens: Array<{ name: string; path: string; locked?: boolean }> = [
  { name: "unlock", path: "/unlock", locked: true },
  { name: "today", path: "/" },
  { name: "new request", path: "/new" },
  { name: "library", path: "/library" },
]

for (const screen of screens) {
  test.describe(screen.name, () => {
    if (screen.locked) test.use(locked)
    test(`${screen.name} has no serious or critical axe violations @phone`, async ({
      page,
    }) => {
      await page.goto(screen.path)
      // A lost cookie would quietly audit /unlock instead.
      await expect(page).toHaveURL(screen.path)
      const { violations } = await new AxeBuilder({ page }).analyze()
      const blocking = violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))
      expect(blocking).toEqual([])
    })
  })
}
