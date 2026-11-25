import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import { LEAP, Seed } from "./seed"

// Exercises (T16, §9.3, WF-D2, WF-F1 to WF-F3): each of the five types
// answers, marks and resumes after a reload, in reviews and in Recall.

let seed: Seed
test.beforeEach(() => {
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

const LESSON = LEAP.lessons[0]
const confidence = (page: Page, name: "Sure" | "Not sure" | "Guess") =>
  page
    .getByRole("group", { name: "How sure are you?" })
    .getByRole("button", { name, exact: true })
const feedback = (page: Page) => page.getByRole("region", { name: "Feedback" })

test("Recall exercises: multiple choice, scenario, short answer and a retry @phone", async ({
  page,
}) => {
  seed.startLesson(
    LEAP.id,
    LESSON,
    { step: "recall", phase: "exercises", index: 0 },
    ["e-tropical-recall", "e-julian-recall", "e-gregorian-recall"]
  )
  await page.goto("/")
  await page.getByRole("button", { name: "Start session" }).click()
  await expect(page).toHaveURL(/\/session\//)

  // Multiple choice, wrong and Sure (WF-F1): re-queued.
  await expect(
    page.getByRole("heading", { name: "Exercise 1 of 3 · multiple choice" })
  ).toBeVisible()
  await expect(confidence(page, "Sure")).toBeDisabled()
  expect(await axe(page)).toEqual([])
  await page.getByText("The months have different lengths").click()
  await confidence(page, "Sure").click()
  await expect(feedback(page)).toContainText("Not quite · you said Sure")
  await expect(feedback(page)).toContainText(
    "You'll see this again later this session"
  )
  await expect(feedback(page)).toContainText("so each 365-day year falls short")
  await expect(
    page.getByRole("heading", { name: "Exercise 1 of 4 · multiple choice" })
  ).toBeVisible()
  expect(await axe(page)).toEqual([])
  await expect
    .poll(() => seed.recallQueue(LEAP.id, LESSON))
    .toEqual([
      "e-tropical-recall",
      "e-julian-recall",
      "e-gregorian-recall",
      "e-tropical-recall",
    ])

  // A reload shows the same feedback, picks marked in text.
  await page.reload()
  await expect(feedback(page)).toContainText("Not quite · you said Sure")
  await expect(feedback(page)).toContainText(
    "You'll see this again later this session"
  )
  await expect(page.getByText("Your answer", { exact: true })).toBeVisible()
  await expect(page.getByText("Correct", { exact: true })).toBeVisible()

  // "In the brief" opens the brief in a sheet (R3).
  await page.getByRole("button", { name: "In the brief" }).click()
  const sheet = page.getByRole("dialog", { name: "In the brief" })
  await expect(sheet).toBeVisible()
  await expect(
    sheet.getByRole("heading", { name: "The leap-year rule", level: 1 })
  ).toBeVisible()
  // Checked once it has faded in: mid-fade, text has too little contrast.
  await expect(sheet).toHaveCSS("opacity", "1")
  // …scrolled to the exercise's anchor, below the sheet's header.
  const anchor = page.locator("#brief-sheet-a-tropical-year")
  await expect
    .poll(async () => {
      const [a, s] = await Promise.all([
        anchor.boundingBox(),
        sheet.boundingBox(),
      ])
      return a && s ? Math.round(a.y - s.y) : null
    })
    .toBeLessThan(80)
  expect(await axe(page)).toEqual([])
  await page.keyboard.press("Escape")
  await expect(sheet).toBeHidden()
  await page.getByRole("button", { name: "Next" }).click()

  // Scenario, right with Guess (WF-F3): counts as not learned yet.
  await expect(
    page.getByRole("heading", { name: "Exercise 2 of 4 · scenario" })
  ).toBeVisible()
  await expect(page.getByText("for 1,000 years")).toBeVisible()
  await page.getByText("It moves earlier by about 8 days").click()
  await confidence(page, "Guess").click()
  await expect(feedback(page)).toContainText(
    "Right, but you guessed · Counts as not learned yet"
  )
  await expect(feedback(page)).toContainText(
    "Julian years run about 11 minutes"
  )
  await page.reload()
  await expect(feedback(page)).toContainText("Right, but you guessed")
  await page.getByRole("button", { name: "Next" }).click()

  // Short answer (WF-F2): typed text survives a reload, then Submit shows
  // the sample and the checklist, which a reload also keeps.
  await expect(
    page.getByRole("heading", { name: "Exercise 3 of 4 · short answer" })
  ).toBeVisible()
  const box = page.getByRole("textbox", {
    name: "Explain why 2000 was a leap year but 1900 was not.",
  })
  await expect(page.getByRole("button", { name: "Submit" })).toBeDisabled()
  await box.fill("centuries skip unless divisible by 400")
  await page.reload()
  await expect(box).toHaveValue("centuries skip unless divisible by 400")
  await page.getByRole("button", { name: "Submit" }).click()
  await expect(page.getByText("Sample answer")).toBeVisible()
  await expect(page.getByText("Tick what you covered")).toBeVisible()
  await expect(feedback(page)).toContainText("divisible by 4, except by 100")
  const point = page.getByRole("checkbox", {
    name: "Divisible by 400 makes them leap years again",
  })
  await point.click()
  // Shown beside Next, and announced (WF-J).
  await expect(page.getByRole("status")).toHaveText("1 of 2 · Partly recalled")
  await expect(page.getByText("1 of 2 · Partly recalled").first()).toBeVisible()
  // A reload keeps the checklist as it was, ticks included.
  await page.reload()
  await expect(page.getByText("Tick what you covered")).toBeVisible()
  await expect(
    page.getByText("centuries skip unless divisible by 400")
  ).toBeVisible()
  await expect(point).toBeChecked()
  await expect(page.getByText("1 of 2 · Partly recalled")).toBeVisible()
  expect(await axe(page)).toEqual([])
  await page.getByRole("button", { name: "Next" }).click()

  // The retry, right and Sure: just "Right", the explanation behind Why?
  await expect(
    page.getByRole("heading", { name: "Exercise 4 of 4 · multiple choice" })
  ).toBeVisible()
  await page
    .getByText("The seasons take about a quarter of a day longer than 365 days")
    .click()
  await page.keyboard.press("1")
  await expect(feedback(page)).toContainText("Right")
  await expect(feedback(page)).not.toContainText("falls short")
  await page.getByRole("button", { name: "Why?" }).click()
  await expect(feedback(page)).toContainText("falls short")
  await page.getByRole("button", { name: "Next" }).click()

  await expect
    .poll(() => JSON.parse(seed.lessonRow(LEAP.id, LESSON)!.position!))
    .toEqual({ step: "answers", index: 0 })
  expect(seed.attempts("recall")).toEqual([
    {
      exercise_id: "e-tropical-recall",
      correct: 0,
      confidence: "sure",
      self_mark: null,
      grade: "forgot",
      is_retry: 0,
    },
    {
      exercise_id: "e-julian-recall",
      correct: 1,
      confidence: "guess",
      self_mark: null,
      grade: "forgot",
      is_retry: 0,
    },
    {
      exercise_id: "e-gregorian-recall",
      correct: null,
      confidence: null,
      self_mark: "partial",
      grade: "partly",
      is_retry: 0,
    },
    {
      exercise_id: "e-tropical-recall",
      correct: 1,
      confidence: "sure",
      self_mark: null,
      grade: "remembered",
      is_retry: 1,
    },
  ])
  expect(seed.draft(`short:${LEAP.id}:e-gregorian-recall`)).toBeUndefined()
})

test("review exercises: multiple choice, spot the error and fill in the blank @phone", async ({
  page,
}) => {
  // Each concept's next version is its review exercise (§7.4). They come
  // in id order: c-gregorian-rule (mc), c-julian (spot), c-tropical-year (fill).
  seed.completeLesson(LEAP.id, LESSON, -3).shownUp(-3)
  seed.schedule(LEAP.id, "c-gregorian-rule", { due: 0, last: -3, cursor: 2 })
  seed.schedule(LEAP.id, "c-julian", { due: 0, last: -3, cursor: 1 })
  seed.schedule(LEAP.id, "c-tropical-year", { due: 0, last: -3, cursor: 1 })
  await page.goto("/")
  await page.getByRole("button", { name: "Reviews only" }).click()
  await expect(page).toHaveURL(/\/session\//)
  const label = (n: number) => `Review ${n} of 3 · ${LEAP.title}`

  // Multiple choice, answered from the keyboard: arrows pick, 2 is Not sure.
  await expect(page.getByRole("heading", { name: label(1) })).toBeVisible()
  await expect(confidence(page, "Not sure")).toBeDisabled()
  await page.getByRole("radio", { name: "2400" }).click()
  // With the ⋯ menu open, the number keys belong to the menu.
  await page.getByRole("button", { name: "More" }).click()
  await expect(page.getByRole("menu")).toBeVisible()
  await page.keyboard.press("1")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toBeHidden()
  await expect(feedback(page)).toHaveCount(0)
  await page.getByRole("radio", { name: "2400" }).click()
  await page.keyboard.press("2")
  await expect(feedback(page)).toContainText("Right, but you weren't sure")
  await page.reload()
  await expect(feedback(page)).toContainText("Right, but you weren't sure")
  await page.getByRole("button", { name: "Next" }).click()

  // Spot the error (WF-G1 shape): confidence waits for both parts.
  await expect(page.getByRole("heading", { name: label(2) })).toBeVisible()
  await expect(
    page.getByText("Part 1 · Which sentence is wrong?")
  ).toBeVisible()
  await page
    .getByText(
      "Its average year was about 11 minutes shorter than the seasons."
    )
    .click()
  await expect(confidence(page, "Sure")).toBeDisabled()
  await page.getByText("Its average year matched the seasons exactly.").click()
  expect(await axe(page)).toEqual([])
  await confidence(page, "Sure").click()
  await expect(feedback(page)).toContainText("Not quite · you said Sure")
  // A wrong Sure grows the block.
  await expect(
    page.getByRole("heading", { name: `Review 2 of 4 · ${LEAP.title}` })
  ).toBeVisible()
  await page.reload()
  await expect(feedback(page)).toContainText("Not quite · you said Sure")
  await page.getByRole("button", { name: "Next" }).click()

  // Fill in the blank (WF-D2): Submit waits for a word; case and
  // punctuation do not matter.
  await expect(
    page.getByRole("heading", { name: `Review 3 of 4 · ${LEAP.title}` })
  ).toBeVisible()
  const blank = page.getByRole("textbox", { name: "Type the missing word" })
  await blank.fill("  ")
  await expect(confidence(page, "Sure")).toBeDisabled()
  await blank.fill("Tropical!")
  await confidence(page, "Sure").click()
  await expect(feedback(page)).toContainText("Right")
  await expect(page.getByRole("button", { name: "Why?" })).toBeVisible()
  await page.reload()
  await expect(page.getByText("Tropical!")).toBeVisible()
  await page.getByRole("button", { name: "Next" }).click()

  // The retry of the spot-the-error item, then the end of the block.
  await expect(
    page.getByRole("heading", { name: `Review 4 of 4 · ${LEAP.title}` })
  ).toBeVisible()
  await page
    .getByText(
      "Its average year was about 11 minutes shorter than the seasons."
    )
    .click()
  await page
    .getByText("Its average year was about 11 minutes longer than the seasons.")
    .click()
  await confidence(page, "Sure").click()
  await expect(feedback(page)).toContainText("Right")
  await page.getByRole("button", { name: "Next" }).click()
  await expect(
    page.getByRole("heading", { name: "Session complete", level: 2 })
  ).toBeVisible()

  expect(
    seed.attempts("review").map((a) => [a.exercise_id, a.grade, a.is_retry])
  ).toEqual([
    ["e-gregorian-review", "partly", 0],
    ["e-julian-review", "forgot", 0],
    ["e-tropical-review", "remembered", 0],
    ["e-julian-review", "remembered", 1],
  ])
})
