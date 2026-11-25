import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import { ENC, LEAP, Seed } from "./seed"

// The player core (T15, §8.4): a reviews-only session runs end to end, a
// reload resumes at the same item, and typed text survives a reload.

let seed: Seed
test.beforeEach(() => {
  seed = new Seed().reset()
})
test.afterAll(() => {
  seed.reset().close()
})

/** The leap-years lesson done three days ago, its concepts due today. */
function leapDue() {
  seed.completeLesson(LEAP.id, LEAP.lessons[0], -3).shownUp(-3)
  for (const c of LEAP.concepts) seed.schedule(LEAP.id, c, { due: 0, last: -3 })
}

const sessionId = (page: Page) =>
  new URL(page.url()).pathname.split("/").at(-1)!

async function axe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))
}

const reviewLabel = (n: number) => `Review ${n} of 3 · ${LEAP.title}` as const

test("a reviews-only session runs end to end and resumes after a reload @phone", async ({
  page,
}) => {
  leapDue()
  await page.goto("/")
  await page.getByRole("button", { name: "Reviews only" }).click()
  await expect(page).toHaveURL(/\/session\/[0-9a-f-]{36}$/)

  // WF-D1: the frame, then the first review.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reviews")
  await expect(page.getByText("15 min left")).toBeVisible()
  await expect(
    page.getByRole("heading", { name: reviewLabel(1) })
  ).toBeVisible()
  expect(await axe(page)).toEqual([])

  await page.getByRole("button", { name: "Show answer" }).click()
  await expect(page.getByText("How well did you remember?")).toBeVisible()
  expect(await axe(page)).toEqual([])
  await page.getByRole("button", { name: "Remembered" }).click()
  await expect(
    page.getByRole("heading", { name: reviewLabel(2) })
  ).toBeVisible()

  // A reload resumes at the same item, with the first answer saved.
  await expect.poll(() => seed.reviewGrades()).toEqual(["remembered"])
  await expect
    .poll(() => JSON.parse(seed.sessionRow(sessionId(page)).position))
    .toEqual({ unit: "reviews", index: 1 })
  await page.reload()
  await expect(
    page.getByRole("heading", { name: reviewLabel(2) })
  ).toBeVisible()

  // The keyboard rates too: 1 Forgot, 2 Partly, 3 Remembered.
  await page.getByRole("button", { name: "Show answer" }).click()
  await page.keyboard.press("2")
  await expect(
    page.getByRole("heading", { name: reviewLabel(3) })
  ).toBeVisible()
  await page.getByRole("button", { name: "Show answer" }).click()
  await page.getByRole("button", { name: "Forgot" }).click()

  // WF-E8, plain: the summary and the way home.
  await expect(
    page.getByRole("heading", { name: "Session complete", level: 2 })
  ).toBeVisible()
  await expect(
    page.getByText("3 reviews. Next time, Checkpoint 1.")
  ).toBeVisible()
  expect(seed.reviewGrades()).toEqual(["remembered", "partly", "forgot"])
  expect(seed.sessionRow(sessionId(page)).ended_at).not.toBeNull()
  expect(await axe(page)).toEqual([])

  // The summary survives a reload while it is the latest session.
  await page.reload()
  await expect(
    page.getByText("3 reviews. Next time, Checkpoint 1.")
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Keep going" })).toBeVisible()
  await page.getByRole("button", { name: "Back to Today" }).click()
  await expect(page).toHaveURL("/")
})

test("× ends the session early with its summary", async ({ page }) => {
  leapDue()
  await page.goto("/")
  await page.getByRole("button", { name: "Reviews only" }).click()
  await expect(
    page.getByRole("heading", { name: reviewLabel(1) })
  ).toBeVisible()

  // ⋯ hides and shows the timer.
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Hide timer" }).click()
  await expect(page.getByText("15 min left")).toHaveCount(0)
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Show timer" }).click()
  await expect(page.getByText("15 min left")).toBeVisible()

  await page
    .getByRole("button", { name: "Exit session, progress saved" })
    .click()
  await expect(
    page.getByText("Nothing recorded. Next time, Checkpoint 1.")
  ).toBeVisible()
  const id = sessionId(page)

  // Once a newer session exists, the old URL goes to Today.
  await page.getByRole("button", { name: "Keep going" }).click()
  await expect(page).not.toHaveURL(new RegExp(id))
  await page.goto(`/session/${id}`)
  await expect(page).toHaveURL("/")
})

test("typed text survives a reload @phone", async ({ page }) => {
  seed.startLesson(ENC.id, ENC.lessons[0], { step: "recall", phase: "write" })
  await page.goto("/")
  await page.getByRole("button", { name: "Start session" }).click()
  await expect(page).toHaveURL(/\/session\//)
  await expect(
    page.getByRole("heading", { name: "What do you remember?" })
  ).toBeVisible()
  await expect(page.getByText("Picking up where you stopped")).toBeVisible()
  expect(await axe(page)).toEqual([])

  const box = page.getByRole("textbox", { name: "What do you remember?" })
  await box.fill("one shared secret key")
  await page.reload()
  await expect(box).toHaveValue("one shared secret key")

  // On blur it reaches the server too, so another device would see it.
  await box.focus()
  await box.blur()
  const key = `recall:${ENC.id}:${ENC.lessons[0]}`
  await expect.poll(() => seed.draft(key)).toBe("one shared secret key")

  // Check moves to the ticks and turns the draft into the Recall text.
  await page.getByRole("button", { name: "Check" }).click()
  await expect(
    page.getByRole("heading", { name: "Tick what you recalled" })
  ).toBeVisible()
  await expect(page.getByText("one shared secret key")).toBeVisible()
  await expect.poll(() => seed.draft(key)).toBeUndefined()
  expect(await axe(page)).toEqual([])
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Tick what you recalled" })
  ).toBeVisible()
  await expect(page.getByText("one shared secret key")).toBeVisible()
})

test("× saves typed text that never left the field", async ({ page }) => {
  seed.startLesson(ENC.id, ENC.lessons[0], { step: "recall", phase: "write" })
  await page.goto("/")
  await page.getByRole("button", { name: "Start session" }).click()
  const box = page.getByRole("textbox", { name: "What do you remember?" })
  await box.pressSequentially("ciphers")
  await page
    .getByRole("button", { name: "Exit session, progress saved" })
    .click()
  await expect(page.getByText(/^Part of Lesson 1\. Next time,/)).toBeVisible()
  expect(seed.draft(`recall:${ENC.id}:${ENC.lessons[0]}`)).toBe("ciphers")
})

test("a tab that falls behind catches up instead of looping", async ({
  page,
  context,
}) => {
  leapDue()
  await page.goto("/")
  await page.getByRole("button", { name: "Reviews only" }).click()
  await expect(
    page.getByRole("heading", { name: reviewLabel(1) })
  ).toBeVisible()

  // A second tab answers two reviews; the first still shows Review 1.
  const other = await context.newPage()
  await other.goto(page.url())
  for (const n of [1, 2]) {
    await expect(
      other.getByRole("heading", { name: reviewLabel(n) })
    ).toBeVisible()
    await other.getByRole("button", { name: "Show answer" }).click()
    await other.getByRole("button", { name: "Remembered" }).click()
  }
  await expect(
    other.getByRole("heading", { name: reviewLabel(3) })
  ).toBeVisible()
  await expect.poll(() => seed.reviewGrades()).toHaveLength(2)

  // The first tab's answer is stale: it is ignored, and the tab moves to
  // where the session really is.
  await page.getByRole("button", { name: "Show answer" }).click()
  await page.getByRole("button", { name: "Forgot" }).click()
  await expect(
    page.getByRole("heading", { name: reviewLabel(3) })
  ).toBeVisible()
  expect(seed.reviewGrades()).toEqual(["remembered", "remembered"])

  // From there it carries on normally.
  await page.getByRole("button", { name: "Show answer" }).click()
  await page.getByRole("button", { name: "Partly" }).click()
  await expect(
    page.getByText("3 reviews. Next time, Checkpoint 1.")
  ).toBeVisible()
  expect(seed.reviewGrades()).toEqual(["remembered", "remembered", "partly"])
})
