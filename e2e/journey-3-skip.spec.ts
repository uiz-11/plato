import { expect, test, type Page } from "@playwright/test"

import { lessonSkippedToast } from "../lib/engine/labels"
import { ENC, Seed } from "./seed"

// e2e journey 3, Syllabus part (§10, §7.3, WF-C1.4): skip a lesson from the
// ⋯ menu, undo it from the toast, and unskip it from the menu. The player
// part is added with the player (T17).

let seed: Seed
test.beforeAll(() => {
  seed = new Seed().reset()
})
test.afterAll(() => {
  seed.reset().close()
})

const SYLLABUS = `/courses/${ENC.id}/syllabus`

const row = (page: Page, title: string) =>
  page.locator("[data-slot=lesson-row]").filter({ hasText: title })

async function choose(page: Page, lesson: string, item: string) {
  await page.getByRole("button", { name: `More for ${lesson}` }).click()
  await page.getByRole("menuitem", { name: item }).click()
}

test("journey 3: skip and undo from the Syllabus", async ({ page }) => {
  await page.goto(`/courses/${ENC.id}`)
  await expect(page).toHaveURL(SYLLABUS)
  const main = page.getByRole("button", { name: "Start Lesson 1" })
  await expect(main).toBeVisible()

  // Skip Lesson 2: the row, the badge and the main button follow.
  const lesson2 = row(page, "2. Fingerprints for data")
  await choose(page, "Lesson 2", "Mark as skipped")
  await expect(lesson2.locator("[data-slot=status-dot]")).toHaveText("Skipped")
  await expect(lesson2.locator("[data-shape=dashed]")).toBeVisible()
  await expect(
    page.locator("[data-slot=course-header] [data-slot=badge]")
  ).toHaveText("in progress")
  await expect(
    page.getByRole("button", { name: "Continue Lesson 1" })
  ).toBeVisible()
  expect(seed.lessonRow(ENC.id, ENC.lessons[1])?.skipped).toBe(1)

  // Undo: the skip created the row, so undo deletes it and the course is
  // Ready again.
  const toast = page.locator("[data-sonner-toast]").filter({
    hasText: lessonSkippedToast(2),
  })
  await toast.getByRole("button", { name: "Undo" }).click()
  await expect(lesson2.locator("[data-slot=status-dot]")).toHaveText(
    "Not started"
  )
  await expect(main).toBeVisible()
  await expect(
    page.locator("[data-slot=course-header] [data-slot=badge]")
  ).toHaveCount(0)
  expect(seed.lessonRow(ENC.id, ENC.lessons[1])).toBeUndefined()

  // Skip again and leave it: *Unskip* is in the menu after a reload.
  await choose(page, "Lesson 2", "Mark as skipped")
  await expect(lesson2.locator("[data-slot=status-dot]")).toHaveText("Skipped")
  await page.reload()
  await page.getByRole("button", { name: "More for Lesson 2" }).click()
  await expect(
    page.getByRole("menuitem", { name: "Mark as skipped" })
  ).toHaveCount(0)
  await page.getByRole("menuitem", { name: "Unskip" }).click()
  await expect(lesson2.locator("[data-slot=status-dot]")).toHaveText(
    "Not started"
  )
  expect(seed.lessonRow(ENC.id, ENC.lessons[1])).toBeUndefined()
})

test("skipping a started lesson keeps where it stopped", async ({ page }) => {
  seed.reset().startLesson(ENC.id, ENC.lessons[0], {
    step: "recall",
    phase: "write",
  })
  await page.goto(SYLLABUS)
  const lesson1 = row(page, "1. Locks with one key")
  await expect(lesson1.locator("[data-slot=status-dot]")).toHaveText(
    "In progress · at Recall"
  )

  await choose(page, "Lesson 1", "Mark as skipped")
  await expect(lesson1.locator("[data-slot=status-dot]")).toHaveText("Skipped")
  // Lesson 2 is next now; the skipped lesson waits (§7.6).
  await expect(
    page.getByRole("button", { name: "Continue Lesson 2" })
  ).toBeVisible()

  await choose(page, "Lesson 1", "Unskip")
  await expect(lesson1.locator("[data-slot=status-dot]")).toHaveText(
    "In progress · at Recall"
  )
  expect(seed.lessonRow(ENC.id, ENC.lessons[0])).toMatchObject({
    skipped: 0,
    position: JSON.stringify({ step: "recall", phase: "write" }),
  })
})

test("a completed lesson has no ⋯ menu", async ({ page }) => {
  seed.reset().completeLesson(ENC.id, ENC.lessons[0], -1)
  await page.goto(SYLLABUS)
  await expect(
    page.getByRole("button", { name: /^More for Lesson 1/ })
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: /^More for Lesson 2/ })
  ).toBeVisible()
})
