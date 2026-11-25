import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

import { locked } from "./auth"
import { LEAP, Seed } from "./seed"

// One row per screen. Each screen task adds its rows (§10).
const screens: Array<{ name: string; path: string; locked?: boolean }> = [
  { name: "unlock", path: "/unlock", locked: true },
  { name: "today", path: "/" },
  { name: "new request", path: "/new" },
  { name: "library", path: "/library" },
  { name: "syllabus", path: "/courses/how-encryption-works/syllabus" },
  { name: "answers", path: "/courses/how-encryption-works/answers" },
  { name: "sources", path: "/courses/how-encryption-works/sources" },
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

// Player screens need a session, so each row seeds one and opens it.
const CHECKPOINT = { unit: "checkpoint", moduleId: "the-rule" }
const playerScreens: Array<{ name: string; seed: (s: Seed) => string }> = [
  {
    name: "checkpoint exercise",
    seed: (s) => {
      s.completeLesson(LEAP.id, LEAP.lessons[0], -1)
      return s.session(
        LEAP.id,
        { ...CHECKPOINT, index: 0 },
        { checkpointQueue: LEAP.checkpoints }
      )
    },
  },
  {
    name: "mastery summary",
    seed: (s) => {
      s.completeCourse(LEAP, -1)
      return s.session(
        LEAP.id,
        { ...CHECKPOINT, index: LEAP.checkpoints.length },
        { checkpointQueue: LEAP.checkpoints }
      )
    },
  },
  {
    name: "course complete",
    seed: (s) => {
      s.completeCourse(LEAP, -1)
      return s.session(LEAP.id, { unit: "end", screen: "course-complete" })
    },
  },
  {
    name: "session complete",
    seed: (s) => {
      s.completeCourse(LEAP, -1)
      return s.session(LEAP.id, { unit: "end", screen: "summary" })
    },
  },
]

test.describe("player screens", () => {
  let seed: Seed
  test.beforeEach(() => {
    seed = new Seed().reset()
  })
  test.afterAll(() => {
    seed.reset().close()
  })

  for (const screen of playerScreens) {
    test(`${screen.name} has no serious or critical axe violations @phone`, async ({
      page,
    }) => {
      const id = screen.seed(seed)
      await page.goto(`/session/${id}`)
      await expect(page).toHaveURL(`/session/${id}`)
      await expect(
        page.getByRole("heading", { level: 2 }).first()
      ).toBeVisible()
      const { violations } = await new AxeBuilder({ page }).analyze()
      const blocking = violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))
      expect(blocking).toEqual([])
    })
  }
})
