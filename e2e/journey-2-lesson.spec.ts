import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import { ENC, Seed } from "./seed"

// e2e journey 2 (§10, T17, WF-E1 to WF-E7, WF-I2, WF-I3): start a Ready
// course from Today, go through the lesson to Recall, reload mid-typing and
// find the text restored, then resume the next day and finish the lesson.

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

/** The steps row: a text label on a phone (WF-I2.1), segments on desktop. */
async function expectStep(page: Page, n: number, step: string) {
  if (test.info().project.name === "phone") {
    await expect(page.getByText(`Step ${n} of 5 · ${step}`)).toBeVisible()
  } else {
    await expect(
      page
        .getByRole("list", { name: "Lesson steps" })
        .locator("[aria-current=step]")
    ).toContainText(step === "Add to your answers" ? "Answers" : step)
  }
}

test("journey 2: a lesson from Today, through Recall, resumed the next day @phone", async ({
  page,
}) => {
  // Today: only Ready courses, so it offers Lesson 1 of one.
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: `${ENC.title} is ready` })
  ).toBeVisible()
  await page.getByRole("button", { name: "Start Lesson 1" }).click()
  await expect(page).toHaveURL(/\/session\/[0-9a-f-]{36}$/)

  // Guess first (WF-E2): no warm-up before a first lesson.
  await expect(page.locator("header h1")).toHaveText(
    "Lesson 1 · Locks with one key"
  )
  await expectStep(page, 2, "Guess first")
  await expect(
    page.getByRole("heading", { name: "Guess 1 of 2 · It's fine to be wrong" })
  ).toBeVisible()
  const lock = page.getByRole("button", { name: "Lock in guess" })
  await expect(lock).toBeDisabled()
  expect(await axe(page)).toEqual([])
  await page.getByText("Millions", { exact: true }).click()
  await lock.click()
  await expect(
    page.getByRole("heading", { name: "Guess 2 of 2 · It's fine to be wrong" })
  ).toBeVisible()
  await expect(lock).toBeDisabled()
  await page
    .getByText("A public, well-studied algorithm with a long random key")
    .click()
  await lock.click()

  // Read (WF-E3, WF-I2): the brief reveals each guess, then Beyond.
  await expectStep(page, 3, "Read")
  await expect(
    page.getByRole("heading", { name: "Locks with one key", exact: true })
  ).toBeVisible()
  await expect(page.getByText(/^~\d+ min read$/)).toBeVisible()
  await expect(page.getByText("Why this matters:")).toBeVisible()
  const guessBox = page.getByRole("region", { name: "Your guess" }).first()
  await expect(guessBox).toContainText("Millions")
  await expect(guessBox).toContainText("Your guess")
  await expect(
    page.getByRole("heading", { name: "Beyond this lesson" })
  ).toBeVisible()
  await expect(page.getByText("Simplified:").first()).toBeAttached()
  expect(await axe(page)).toEqual([])
  await page.getByRole("button", { name: "Done reading" }).click()

  // Recall, write (WF-E4): a reload mid-typing restores the text.
  await expectStep(page, 4, "Recall")
  const box = page.getByRole("textbox", { name: "What do you remember?" })
  await box.fill("one key locks and unlocks")
  await page.reload()
  await expect(box).toHaveValue("one key locks and unlocks")
  await expect
    .poll(() => JSON.parse(seed.lessonRow(ENC.id, ENC.lessons[0])!.position!))
    .toEqual({ step: "recall", phase: "write" })

  // Stop here with ×; the lesson waits at Recall.
  await page
    .getByRole("button", { name: "Exit session, progress saved" })
    .click()
  await expect(
    page.getByText("Part of Lesson 1. Next time, Lesson 1 from Recall.")
  ).toBeVisible()

  // The next day, the session resumes where it stopped.
  const moved = await page.request.post("/api/test/clock", {
    data: { days: 1 },
  })
  expect(moved.ok()).toBe(true)
  await page.goto("/")
  await expect(page.getByText("Lesson 1 from Recall").first()).toBeVisible()
  await page.getByRole("button", { name: "Start session" }).click()
  await expect(page).toHaveURL(/\/session\//)
  await expect(page.getByText("Picking up where you stopped")).toBeVisible()
  await expect(box).toHaveValue("one key locks and unlocks")
  await page.getByRole("button", { name: "Check" }).click()

  // Recall, tick (WF-E5): one of three, so two exercises.
  await page
    .getByRole("checkbox", {
      name: "A symmetric cipher uses the same secret key to encrypt and to decrypt.",
    })
    .click()
  await page
    .getByRole("button", { name: "Practice what you missed (2)" })
    .click()

  // Recall exercises (WF-F2, WF-I3).
  await expect(
    page.getByRole("heading", { name: "Exercise 1 of 2 · short answer" })
  ).toBeVisible()
  await page
    .getByRole("textbox", {
      name: "Why do cryptographers publish their algorithms instead of keeping them secret?",
    })
    .fill("experts find the flaws")
  await page.getByRole("button", { name: "Submit" }).click()
  await page
    .getByRole("checkbox", { name: "Public study finds weaknesses" })
    .click()
  await page.getByRole("button", { name: "Next" }).click()
  await expect(
    page.getByRole("heading", { name: "Exercise 2 of 2 · fill in the blank" })
  ).toBeVisible()
  await page
    .getByRole("textbox", { name: "Type the missing word" })
    .fill("doubles")
  await confidence(page, "Sure").click()
  await page.getByRole("button", { name: "Next" }).click()

  // Add to your answers (WF-E6): one board per key question.
  await expectStep(page, 5, "Add to your answers")
  await expect(
    page.getByRole("heading", { name: "Add to your answers" })
  ).toBeVisible()
  const stick = page.getByRole("button", { name: "Stick it" })
  await expect(stick).toBeDisabled()
  const note = page.getByRole("textbox", { name: "Your note for Q2" })
  await note.fill("both sides share one secret key")
  // A sticky note is typed text too: a reload keeps it.
  await page.reload()
  await expect(note).toHaveValue("both sides share one secret key")
  expect(await axe(page)).toEqual([])
  await stick.click()
  await expect(
    page.getByRole("textbox", { name: "Your note for Q1" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Skip this step" }).click()

  // Lesson complete (WF-E7), with the next lesson's hook.
  await expect(
    page.getByRole("heading", { name: "Lesson 1 complete" })
  ).toBeVisible()
  await expect(
    page.getByText(
      "Next, Lesson 2: How can you tell that a file you downloaded is exactly the one its author published?"
    )
  ).toBeVisible()
  expect(await axe(page)).toEqual([])
  expect(seed.notes(ENC.id)).toEqual(["both sides share one secret key"])
  expect(Object.keys(seed.schedules(ENC.id)).sort()).toEqual(
    [...ENC.firstLessonConcepts].sort()
  )

  // Continue: Lesson 2 warms up on Lesson 1 (WF-E1).
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.locator("header h1")).toHaveText(
    "Lesson 2 · Fingerprints for data"
  )
  await expectStep(page, 1, "Warm up")
  await expect(
    page.getByRole("heading", { name: "Warm up 1 of 3 · from Lesson 1" })
  ).toBeVisible()
  expect(await axe(page)).toEqual([])
  await page.getByRole("button", { name: "Show answer" }).click()
  await expect(page.getByText("The same key that encrypted it.")).toBeVisible()
  await page.getByRole("button", { name: "Next" }).click()
  await expect(
    page.getByRole("heading", { name: "Warm up 2 of 3 · from Lesson 1" })
  ).toBeVisible()
  // Warm-ups change nothing in the schedule.
  expect(seed.attempts("review")).toEqual([])
})
