import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import { ENC, Seed } from "./seed"

// e2e journey 4 (§10, T18, WF-E7, WF-G1, WF-G2): finish a module's last
// lesson, come back the next day, take its checkpoint after the reviews, and
// end on the mastery summary.

let seed: Seed
test.beforeEach(async ({ request }) => {
  seed = new Seed().reset()
  await request.post("/api/test/clock", { data: { days: 0 } })
})
// The server is shared by every spec, so never leave its clock moved.
test.afterEach(async ({ request }) => {
  await request.post("/api/test/clock", { data: { days: 0 } })
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

const confidence = (page: Page, name: "Sure" | "Not sure" | "Guess") =>
  page
    .getByRole("group", { name: "How sure are you?" })
    .getByRole("button", { name, exact: true })
const feedback = (page: Page) => page.getByRole("region", { name: "Feedback" })
const item = (page: Page, name: string) =>
  page.getByRole("heading", { name, exact: true })
const next = (page: Page) => page.getByRole("button", { name: "Next" }).click()

test("journey 4: finish a module, then its checkpoint the next day @phone", async ({
  page,
}) => {
  // Lesson 1 done before; Lesson 2 waits at its last step.
  seed.completeLesson(ENC.id, ENC.lessons[0], -1).shownUp(-1)
  seed.startLesson(ENC.id, ENC.lessons[1], { step: "answers", index: 0 }, [])

  await page.goto("/")
  await page.getByRole("button", { name: "Start session" }).click()
  await expect(page).toHaveURL(/\/session\//)
  await page.getByRole("button", { name: "Skip this step" }).click()
  await expect(
    page.getByRole("heading", { name: "Lesson 2 complete" })
  ).toBeVisible()
  await expect(page.getByText("Checkpoint 1 is open.")).toBeVisible()
  // Stop here: the checkpoint waits for the next day.
  await page
    .getByRole("button", { name: "Exit session, progress saved" })
    .click()
  await expect(
    page.getByText("Lesson 2. Next time, Checkpoint 1.")
  ).toBeVisible()

  // The next day: Lesson 2's concepts are due first, then the checkpoint.
  await page.request.post("/api/test/clock", { data: { days: 1 } })
  await page.goto("/")
  await expect(
    page.getByText("3 reviews, then Checkpoint 1").first()
  ).toBeVisible()
  await page.getByRole("button", { name: "Start session" }).click()
  await expect(page.locator("header h1")).toHaveText(
    "Reviews then Checkpoint 1"
  )
  for (let n = 1; n <= 3; n++) {
    await expect(item(page, `Review ${n} of 3 · ${ENC.title}`)).toBeVisible()
    await page.getByRole("button", { name: "Show answer" }).click()
    await page.getByRole("button", { name: "Remembered" }).click()
  }

  // The checkpoint (WF-G1): no intro screen.
  await expect(page.locator("header h1")).toHaveText("Checkpoint 1")
  await expect(page.locator("header")).toContainText("open")
  await expect(item(page, "1 of 6 · Lessons 1–2")).toBeVisible()
  expect(await axe(page)).toEqual([])
  // A wrong Sure comes back three exercises later; the total stays 6.
  await page.getByText("The AES source code").click()
  await confidence(page, "Sure").click()
  await expect(feedback(page)).toContainText("Not quite · you said Sure")
  await expect(feedback(page)).toContainText(
    "You'll see this again later this session"
  )
  await page.reload()
  await expect(feedback(page)).toContainText("Not quite · you said Sure")
  await next(page)

  await expect(item(page, "2 of 6 · Lessons 1–2")).toBeVisible()
  await page
    .getByRole("textbox", { name: "Type the missing word" })
    .fill("1024")
  await confidence(page, "Sure").click()
  await expect(feedback(page)).toContainText("Right")
  await next(page)

  await expect(item(page, "3 of 6 · Lessons 1–2")).toBeVisible()
  await page.getByText("The AES product").click()
  await confidence(page, "Not sure").click()
  await expect(feedback(page)).toContainText("Right, but you weren't sure")
  await next(page)

  await expect(item(page, "Retry · 3 of 6 · Lessons 1–2")).toBeVisible()
  await page.getByText("A copy of the shared key").click()
  await confidence(page, "Sure").click()
  await expect(feedback(page)).toContainText("Right")
  await next(page)

  await expect(item(page, "4 of 6 · Lessons 1–2")).toBeVisible()
  await page
    .getByText("Comparing its SHA-256 hash with the published one")
    .click()
  await confidence(page, "Sure").click()
  await next(page)

  // Spot the error: both parts before confidence.
  await expect(item(page, "5 of 6 · Lessons 1–2")).toBeVisible()
  await expect(
    page.getByText("Part 1 · Which sentence is wrong?")
  ).toBeVisible()
  await expect(page.getByText("Part 2 · Pick the fix")).toBeVisible()
  expect(await axe(page)).toEqual([])
  await page
    .getByText(
      "A password hash can be reversed by anyone who holds the site's key."
    )
    .click()
  await expect(confidence(page, "Sure")).toBeDisabled()
  await page
    .getByText(
      "A password hash uses no key and can only be attacked by guessing."
    )
    .click()
  await confidence(page, "Sure").click()
  await expect(feedback(page)).toContainText("Right")
  await next(page)

  // A short answer, marked by ticking.
  await expect(item(page, "6 of 6 · Lessons 1–2")).toBeVisible()
  await page
    .getByRole("textbox", {
      name: "Why is it safe to trust a SHA-256 checksum but not an MD5 one?",
    })
    .fill("MD5 has collisions, SHA-256 has none known")
  await page.getByRole("button", { name: "Submit" }).click()
  for (const point of [
    "MD5 is broken by collisions",
    "A tampered file could match the hash",
    "SHA-256 has no known practical collisions",
  ])
    await page.getByRole("checkbox", { name: point }).click()
  await next(page)

  // The mastery summary (WF-G2): the retry does not count.
  await expect(
    page.getByRole("heading", { name: "Module 1 mastery" })
  ).toBeVisible()
  await expect(page.getByText("5 of 6 right")).toBeVisible()
  await expect(page.locator("header")).toContainText("done")
  const meters = page.locator("[data-slot=mastery-meter]")
  await expect(meters).toHaveCount(6)
  // Lesson 1 was never reviewed; Lesson 2 was, this morning.
  await expect(meters.filter({ hasText: "Not yet reviewed" })).toHaveCount(3)
  await expect(meters.filter({ hasText: "Good" })).toHaveCount(3)
  expect(await axe(page)).toEqual([])
  await page.reload()
  await expect(
    page.getByRole("heading", { name: "Module 1 mastery" })
  ).toBeVisible()

  expect(
    seed.attempts("checkpoint").map((a) => [a.exercise_id, a.is_retry])
  ).toEqual([
    ["x-secrets-key", 0],
    ["x-secrets-bits", 0],
    ["x-secrets-vendor", 0],
    ["x-secrets-key", 1],
    ["x-secrets-download", 0],
    ["x-secrets-spot", 0],
    ["x-secrets-short", 0],
  ])

  // Continue moves on to the next target: Lesson 3.
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.locator("header h1")).toContainText("Lesson 3")
})
