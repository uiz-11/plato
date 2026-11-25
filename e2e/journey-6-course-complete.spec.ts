import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import { LEAP, Seed } from "./seed"

// e2e journey 6 (§10, T18, WF-G3, WF-E8): finish a fixture course with its
// last checkpoint, see the course-complete screen, then the session summary.

let seed: Seed
test.beforeAll(() => {
  seed = new Seed().reset()
})
test.afterAll(() => {
  seed.reset().close()
})

async function axe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))
}

const confidence = (page: Page) =>
  page
    .getByRole("group", { name: "How sure are you?" })
    .getByRole("button", { name: "Sure", exact: true })
const next = (page: Page) => page.getByRole("button", { name: "Next" }).click()

test("journey 6: finish the course, then course complete and the summary", async ({
  page,
}) => {
  seed.completeLesson(LEAP.id, LEAP.lessons[0], -1).shownUp(-1)
  seed.note(
    LEAP.id,
    "q2",
    "Centuries skip unless divisible by 400",
    "leap-rule"
  )

  await page.goto(`/courses/${LEAP.id}/syllabus`)
  await page.getByRole("button", { name: "Open Checkpoint 1" }).click()
  await expect(page).toHaveURL(/\/session\//)
  await expect(page.locator("header h1")).toHaveText("Checkpoint 1")

  await expect(
    page.getByRole("heading", { name: "1 of 4 · Lesson 1" })
  ).toBeVisible()
  await page
    .getByRole("textbox", { name: "Type the missing word" })
    .fill("2400")
  await confidence(page).click()
  await next(page)

  await page.getByRole("radio", { name: "97" }).click()
  await confidence(page).click()
  await next(page)

  await page.getByText("It dropped ten days at once").click()
  await confidence(page).click()
  await next(page)

  await page
    .getByRole("textbox", {
      name: "In one sentence, why does the calendar need leap years at all?",
    })
    .fill("the seasons take 365.24 days so the calendar drifts")
  await page.getByRole("button", { name: "Submit" }).click()
  await page
    .getByRole("checkbox", {
      name: "The year of seasons is not a whole number of days",
    })
    .click()
  await next(page)

  const mastery = page.getByRole("heading", { name: "Module 1 mastery" })
  // Arriving from the last exercise focuses the heading; a reload does not.
  await expect(mastery).toBeFocused()
  await page.reload()
  await expect(mastery).toBeVisible()
  await expect(mastery).not.toBeFocused()
  await expect(page.getByText("3 of 4 right")).toBeVisible()
  await page.getByRole("button", { name: "Continue" }).click()

  // Course complete (WF-G3): ends on the key questions, not a score.
  await expect(
    page.getByRole("heading", { name: "Course complete" })
  ).toBeVisible()
  await expect(page.locator("header h1")).toHaveText(LEAP.title)
  await expect(page.locator("header")).toContainText("complete")
  await expect(
    page.getByText(
      "1 lesson · 1 checkpoint · reviews continue for all 3 concepts"
    )
  ).toBeVisible()
  const questions = page.locator("[data-slot=celebration] li")
  await expect(questions).toHaveCount(3)
  await expect(questions.nth(0)).toContainText("0 notes")
  await expect(questions.nth(1)).toContainText(
    "Why was 1900 not a leap year when 2000 was?"
  )
  await expect(questions.nth(1)).toContainText("1 note")
  expect(await axe(page)).toEqual([])
  // A reload keeps the end screen.
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Course complete" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Continue" }).click()

  // Session complete (WF-E8).
  await expect(
    page.getByRole("heading", { name: "Session complete", level: 2 })
  ).toBeVisible()
  await expect(
    page.getByText("Checkpoint 1. Next time, just reviews.")
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Keep going" })).toHaveCount(0)
  expect(await axe(page)).toEqual([])
  await page.getByRole("button", { name: "Back to Today" }).click()
  await expect(page).toHaveURL(/\/$/)

  // The course is Complete: its page has a badge and no main button.
  await page.goto(`/courses/${LEAP.id}/syllabus`)
  await expect(
    page.locator("[data-slot=course-header] [data-slot=badge]")
  ).toHaveText("complete")
})

test("the budget rule ends a checkpoint between exercises", async ({
  page,
}) => {
  seed.reset()
  seed.completeLesson(LEAP.id, LEAP.lessons[0], -1)
  await page.goto(`/courses/${LEAP.id}/syllabus`)
  await page.getByRole("button", { name: "Open Checkpoint 1" }).click()
  await expect(page).toHaveURL(/\/session\//)
  const id = page.url().split("/session/")[1]!

  await page
    .getByRole("textbox", { name: "Type the missing word" })
    .fill("2400")
  await confidence(page).click()
  // 10 seconds left: too little for the next exercise (45 s, so half is 22.5).
  seed.activeMs(id, 15 * 60_000 - 10_000)
  await page.reload()
  await next(page)

  await expect(
    page.getByRole("heading", { name: "Session complete", level: 2 })
  ).toBeVisible()
  await expect(
    page.getByText("1 exercise of Checkpoint 1. Next time, Checkpoint 1.")
  ).toBeVisible()
  expect(JSON.parse(seed.sessionRow(id).position)).toEqual({
    unit: "end",
    screen: "summary",
  })
})
