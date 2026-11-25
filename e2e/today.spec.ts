import { expect, test, type Page } from "@playwright/test"

import { emptyBaseURL } from "./auth"
import { ENC, LEAP, Seed } from "./seed"

// Today's session card (§7.8, WF-A2): every state is seeded into the
// database and checked on the page. The engine's card rules have their own
// table-driven tests; these check what the page draws for each.

let seed: Seed
test.beforeAll(() => {
  seed = new Seed()
})
test.beforeEach(() => {
  seed.reset()
})
test.afterAll(() => {
  seed.reset().close()
})

const card = (page: Page) => page.locator("[data-slot=today-card]")

async function openToday(page: Page, state: string) {
  await page.goto("/")
  await expect(page).toHaveURL("/")
  await expect(card(page)).toHaveAttribute("data-state", state)
  return card(page)
}

const startSession = (page: Page) =>
  page.getByRole("button", { name: "Start session" })
const lengthMenu = (page: Page) =>
  page.getByRole("button", { name: /^Session length: \d+ min$/ })

test("1 · back after two weeks: welcome back", async ({ page }) => {
  seed
    .shownUp(-20)
    .completeLesson(ENC.id, ENC.lessons[0], -20)
    .schedule(ENC.id, ENC.firstLessonConcepts[0], { due: -18, last: -20 })
  const c = await openToday(page, "welcome-back")
  await expect(c.getByRole("heading", { name: "Welcome back" })).toBeVisible()
  await expect(
    c.getByText("Overdue reviews are spread over the next few days.")
  ).toBeVisible()
  await expect(startSession(page)).toBeVisible()
  await expect(lengthMenu(page)).toHaveText(/15 min/)
  await expect(page.getByRole("button", { name: /Reviews only/ })).toHaveCount(
    0
  )
})

test("2 · a target and reviews: your session", async ({ page }) => {
  seed.shownUp(-3).shownUp(-1).completeLesson(ENC.id, ENC.lessons[0], -2)
  for (const concept of ENC.firstLessonConcepts)
    seed.schedule(ENC.id, concept, { due: 0, last: -2 })
  const c = await openToday(page, "session")
  await expect(c.getByRole("heading", { name: "Your session" })).toBeVisible()
  await expect(c.getByText("3 reviews, then Lesson 2")).toBeVisible()
  await expect(startSession(page)).toBeVisible()
  await expect(lengthMenu(page)).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Reviews only · ~2 min" })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Full lesson" })).toBeVisible()

  // The counter and the rows below the card.
  await expect(page.locator("[data-slot=shown-up]")).toHaveText(
    "2days you've shown up"
  )
  const inProgress = page.getByRole("region", { name: "In progress" })
  await expect(
    inProgress.getByRole("link", { name: new RegExp(ENC.title) })
  ).toContainText("1 of 4 completed")
  const ready = page.getByRole("region", { name: "Ready" })
  await expect(
    ready.getByRole("link", { name: new RegExp(LEAP.title) })
  ).toContainText("1 lesson")
})

test("3 · a target and no reviews: next", async ({ page }) => {
  seed.completeLesson(ENC.id, ENC.lessons[0], -2)
  for (const concept of ENC.firstLessonConcepts)
    seed.schedule(ENC.id, concept, { due: 1, last: -2 })
  let c = await openToday(page, "next")
  await expect(c.getByRole("heading", { name: "Your session" })).toBeVisible()
  await expect(c.getByText("Next: Lesson 2.", { exact: true })).toBeVisible()

  // After a review today (WF-A2 "No reviews due or daily limit reached").
  seed.attempt("review", ENC.id, {
    offset: 0,
    conceptId: ENC.firstLessonConcepts[0],
  })
  c = await openToday(page, "next")
  await expect(
    c.getByText("Reviews done for today. Next: Lesson 2.")
  ).toBeVisible()
  await expect(startSession(page)).toBeVisible()
  await expect(lengthMenu(page)).toBeVisible()
  await expect(page.getByRole("button", { name: "Full lesson" })).toBeVisible()
  await expect(page.getByRole("button", { name: /Reviews only/ })).toHaveCount(
    0
  )
})

test("4 · reviews due and nothing in progress", async ({ page }) => {
  seed.completeCourse(LEAP, -5)
  for (const concept of LEAP.concepts)
    seed.schedule(LEAP.id, concept, { due: 0, last: -5 })
  const c = await openToday(page, "reviews-due")
  await expect(c.getByRole("heading", { name: "3 reviews due" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Start reviews" })
  ).toBeVisible()
  await expect(startSession(page)).toHaveCount(0)
})

test("5 · only a Ready course: start Lesson 1", async ({ page }) => {
  const c = await openToday(page, "ready")
  await expect(c.getByRole("heading", { name: / is ready$/ })).toBeVisible()
  await expect(c.getByText(/^\d+ lessons? · ~/)).toBeVisible()
  // A double tap starts one session, not two (the button disables).
  await c.getByRole("button", { name: "Start Lesson 1" }).dblclick()
  // The player is T15; the session exists once the URL names it.
  await expect(page).toHaveURL(/\/session\/[0-9a-f-]{36}$/)
  expect(seed.sessionCount()).toBe(1)
})

test("6 · first run: nothing published", async ({ page }) => {
  await page.goto(`${emptyBaseURL}/`)
  await expect(card(page)).toHaveAttribute("data-state", "first-run")
  await expect(
    card(page).getByRole("heading", { name: "What do you want to learn?" })
  ).toBeVisible()
  await expect(
    card(page).getByText(
      "Describe it and Plato builds a course. This takes a while."
    )
  ).toBeVisible()
  await card(page).getByRole("link", { name: "Request course" }).click()
  await expect(page).toHaveURL(`${emptyBaseURL}/new`)
})

test("7 · all caught up", async ({ page }) => {
  seed.completeCourse(LEAP, -5).completeCourse(ENC, -5)
  for (const concept of LEAP.concepts)
    seed.schedule(LEAP.id, concept, { due: 1, last: -5 })
  const c = await openToday(page, "caught-up")
  await expect(c.getByRole("heading", { name: "All caught up" })).toBeVisible()
  await expect(c.getByText("Next reviews tomorrow.")).toBeVisible()
  await expect(c.getByRole("link", { name: "Request course" })).toBeVisible()
})

test("the session length is remembered @phone", async ({ page, isMobile }) => {
  seed.completeLesson(ENC.id, ENC.lessons[0], -2)
  await openToday(page, "next")
  await lengthMenu(page).click()
  if (isMobile) {
    // A bottom sheet holding a radio group (WF-I1.1).
    const sheet = page.getByRole("dialog", { name: "Session length" })
    await sheet.getByRole("radio", { name: "20 min" }).click()
    await expect(sheet).toBeHidden()
  } else {
    await page.getByRole("menuitemradio", { name: "20 min" }).click()
  }
  await expect(lengthMenu(page)).toHaveText(/20 min/)
  await page.reload()
  await expect(lengthMenu(page)).toHaveText(/20 min/)
  // Big enough to tap on a phone (WF-I).
  if (isMobile) {
    for (const b of [startSession(page), lengthMenu(page)]) {
      const box = await b.boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44)
    }
  }
})
