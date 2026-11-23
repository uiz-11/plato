import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

// One row per screen. Each screen task adds its rows (§10).
const screens: Array<{ name: string; path: string }> = [
  { name: "home", path: "/" },
]

for (const screen of screens) {
  test(`${screen.name} has no serious or critical axe violations @phone`, async ({
    page,
  }) => {
    await page.goto(screen.path)
    const { violations } = await new AxeBuilder({ page }).analyze()
    const blocking = violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))
    expect(blocking).toEqual([])
  })
}
