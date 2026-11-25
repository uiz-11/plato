import { expect, test } from "@playwright/test"

import { ENC, LEAP, Seed } from "./seed"

// The course page (§9.4, WF-C1 to WF-C3): header, tabs, the Syllabus's
// statuses and mastery disclosure, and Sources.

let seed: Seed
test.beforeAll(() => {
  seed = new Seed().reset()
})
test.afterAll(() => {
  seed.reset().close()
})

test("header and tabs stay on every tab @phone", async ({ page }) => {
  await page.goto(`/courses/${ENC.id}`)
  await expect(page).toHaveURL(`/courses/${ENC.id}/syllabus`)
  await expect(page).toHaveTitle(/How encryption keeps secrets/)

  const header = page.locator("[data-slot=course-header]")
  await expect(
    header.getByRole("heading", { level: 1, name: ENC.title })
  ).toBeVisible()
  await expect(header).toContainText("4 lessons · ")
  await expect(header).toContainText(" · as of Nov 2026")
  // A Ready course has no badge.
  await expect(header.locator("[data-slot=badge]")).toHaveCount(0)

  const tabs = page.getByRole("navigation", { name: "Course" })
  for (const [name, path] of [
    ["Answers", "answers"],
    ["Sources", "sources"],
    ["Syllabus", "syllabus"],
  ]) {
    await tabs.getByRole("link", { name }).click()
    await expect(page).toHaveURL(`/courses/${ENC.id}/${path}`)
    await expect(tabs.getByRole("link", { name })).toHaveAttribute(
      "aria-current",
      "page"
    )
    await expect(tabs.locator("[aria-current]")).toHaveCount(1)
    await expect(header).toBeVisible()
  }
})

test("Syllabus shows statuses, the out-of-scope line and mastery", async ({
  page,
}) => {
  seed.reset().completeLesson(ENC.id, ENC.lessons[0], -1)
  for (const c of ENC.firstLessonConcepts)
    seed.schedule(ENC.id, c, { due: 1, last: -1 })
  await page.goto(`/courses/${ENC.id}/syllabus`)

  await expect(page.getByText("1 of 4 completed")).toBeVisible()
  await expect(page.locator("[data-slot=out-of-scope]")).toContainText(
    "How specific ciphers such as AES work inside"
  )
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Module 1 · Shared secrets",
    "Module 2 · Public keys",
  ])
  await expect(
    page.locator("[data-slot=course-header] [data-slot=badge]")
  ).toHaveText("in progress")
  await expect(
    page.getByRole("button", { name: "Continue Lesson 2" })
  ).toBeVisible()

  const lesson1 = page
    .locator("[data-slot=lesson-row]")
    .filter({ hasText: "1. Locks with one key" })
  await expect(lesson1.locator("[data-slot=status-dot]")).toHaveText(
    "Completed"
  )
  await expect(
    page.locator("[data-slot=checkpoint-row]").first()
  ).toContainText("Locked · complete Lesson 2")
  await expect(page.locator("[data-slot=checkpoint-row]").nth(1)).toHaveText(
    /Checkpoint 2\s*Locked$/
  )

  // Collapsed by default; opens to the concepts' meters (WF-C1.3).
  const toggle = lesson1.getByRole("button", { name: "Mastery, Lesson 1" })
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  const list = lesson1.getByRole("list", { name: "Mastery, Lesson 1" })
  await expect(list).toBeHidden()
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(list.getByRole("listitem")).toHaveCount(3)
  await expect(list.locator("[data-slot=mastery-meter]").first()).toHaveText(
    "Not yet reviewed"
  )
})

test("the main button starts a session on this course", async ({ page }) => {
  seed.reset()
  await page.goto(`/courses/${ENC.id}/syllabus`)
  await page.getByRole("button", { name: "Start Lesson 1" }).click()
  await expect(page).toHaveURL(/\/session\/[0-9a-f-]+$/)
  await expect(
    page.getByRole("heading", { name: "Session started" })
  ).toBeVisible()
  expect(seed.sessionCount()).toBe(1)
})

test("a complete course has a badge and no main button", async ({ page }) => {
  seed.reset().completeCourse(LEAP, -2)
  await page.goto(`/courses/${LEAP.id}/syllabus`)
  const header = page.locator("[data-slot=course-header]")
  await expect(header.locator("[data-slot=badge]")).toHaveText("complete")
  await expect(header.getByRole("button")).toHaveCount(0)
  await expect(page.locator("[data-slot=checkpoint-row]")).toContainText("Done")
})

test("Sources are grouped and numbered as in the briefs", async ({ page }) => {
  await page.goto(`/courses/${ENC.id}/sources#s4`)
  const headings = page.getByRole("heading", { level: 2 })
  await expect(headings.first()).toHaveText("Original papers")
  await expect(headings.nth(1)).toHaveText("Standards")

  const s4 = page.locator("#s4")
  await expect(s4).toContainText("NIST · FIPS 197: Advanced Encryption")
  await expect(s4.locator("time")).toHaveText("2023")
  await expect(s4.locator("time")).toHaveAttribute("datetime", "2023-05-09")
  const link = s4.getByRole("link")
  await expect(link).toHaveAttribute("target", "_blank")
  await expect(link).toHaveAttribute("rel", "noopener noreferrer")
  await expect(link).toHaveAttribute(
    "href",
    "https://csrc.nist.gov/pubs/fips/197/final"
  )
  await expect(page.locator("#s1")).toContainText(
    "Communication Theory of Secrecy Systems"
  )
})

test("an unknown course is not found", async ({ page }) => {
  const res = await page.goto("/courses/no-such-course/syllabus")
  expect(res?.status()).toBe(404)
  await expect(
    page.getByRole("heading", { name: "Page not found" })
  ).toBeVisible()
})

test("an unknown session is not found", async ({ page }) => {
  const res = await page.goto("/session/not-a-session")
  expect(res?.status()).toBe(404)
  await expect(
    page.getByRole("heading", { name: "Session not found" })
  ).toBeVisible()
  await page.getByRole("link", { name: "Back to Today" }).click()
  await expect(page).toHaveURL("/")
})
