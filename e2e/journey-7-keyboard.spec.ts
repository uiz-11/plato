import { expect, test, type Locator, type Page } from "@playwright/test"

import { axe } from "./audit"
import { ENC, LEAP, Seed } from "./seed"

// e2e journey 7 (§10, T19, WF-J): one review, one exercise, the ticks and a
// sticky note, using only the keyboard. Focus follows each new item, Tab
// order follows the screen, and results, tick counts and step changes are
// announced politely.

let seed: Seed
test.beforeEach(() => {
  seed = new Seed().reset()
})
test.afterAll(() => {
  seed.reset().close()
})

/** Presses Tab until `target` has focus, as a keyboard user would. */
async function tabTo(page: Page, target: Locator, max = 40) {
  await expect(target).toBeVisible()
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return
    await page.keyboard.press("Tab")
  }
  await expect(target).toBeFocused()
}

/** The player's polite live region (WF-J). */
const announcer = (page: Page) => page.locator("[data-slot=player-announcer]")

test("journey 7: a review, an exercise, the ticks and a sticky note by keyboard @phone", async ({
  page,
}) => {
  // One review due, and Lesson 1 waiting at Recall.
  seed.completeLesson(LEAP.id, LEAP.lessons[0], -3).shownUp(-3)
  seed.schedule(LEAP.id, "c-gregorian-rule", { due: 0, last: -3 })
  seed.startLesson(ENC.id, ENC.lessons[0], { step: "recall", phase: "write" })

  await page.goto("/")
  await tabTo(page, page.getByRole("button", { name: "Start session" }))
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/session\//)

  // The review (WF-D1): Show answer, then the rating by its shortcut key.
  await expect(
    page.getByRole("heading", { name: `Review 1 of 1 · ${LEAP.title}` })
  ).toBeVisible()
  await tabTo(page, page.getByRole("button", { name: "Show answer" }))
  await page.keyboard.press("Enter")
  // Focus moves to what replaced Show answer: the first rating.
  await expect(page.getByRole("button", { name: "Forgot" })).toBeFocused()
  await page.keyboard.press("3")

  // The lesson arrives at Recall: focus is on its heading, not lost to the
  // page, and the step change is announced.
  const write = page.getByRole("heading", { name: "What do you remember?" })
  await expect(write).toBeFocused()
  await expect(announcer(page)).toHaveText("Step 4 of 5 · Recall")
  await expect.poll(() => seed.reviewGrades()).toEqual(["remembered"])
  await page.keyboard.press("Tab")
  await expect(
    page.getByRole("textbox", { name: "What do you remember?" })
  ).toBeFocused()
  await page.keyboard.type("the method can be public; more bits, more keys")
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Check" })).toBeFocused()
  await page.keyboard.press("Enter")

  // The ticks (WF-E5): Space ticks, and each count is announced.
  await expect(
    page.getByRole("heading", { name: "Tick what you recalled" })
  ).toBeFocused()
  const tick = (name: string) => page.getByRole("checkbox", { name })
  await tabTo(
    page,
    tick(
      "A cipher's security should rest on the key alone, never on keeping the method secret."
    )
  )
  await page.keyboard.press("Space")
  await expect(announcer(page)).toHaveText("1 of 3 recalled")
  await page.keyboard.press("Tab")
  await expect(
    tick(
      "Each extra key bit doubles the number of keys a brute-force attacker must try."
    )
  ).toBeFocused()
  await page.keyboard.press("Space")
  await expect(announcer(page)).toHaveText("2 of 3 recalled")
  await page.keyboard.press("Tab")
  await expect(
    page.getByRole("button", { name: "Practice what you missed (2)" })
  ).toBeFocused()
  await page.keyboard.press("Enter")

  // The exercise (WF-F, WF-J): its heading has focus; the options are a
  // radio group moved with the arrow keys, then Tab reaches the confidence
  // buttons.
  await expect(
    page.getByRole("heading", { name: "Exercise 1 of 2 · multiple choice" })
  ).toBeFocused()
  await page.keyboard.press("Tab")
  const radio = (name: string) => page.getByRole("radio", { name })
  await expect(radio("The same key Alice used")).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(radio("Alice's public key")).toBeChecked()
  await page.keyboard.press("ArrowUp")
  await expect(radio("The same key Alice used")).toBeChecked()
  await page.keyboard.press("Tab")
  const sure = page
    .getByRole("group", { name: "How sure are you?" })
    .getByRole("button", { name: "Sure", exact: true })
  await expect(sure).toBeFocused()
  await page.keyboard.press("Enter")

  // After submitting: focus on the result, which is announced, then "Why?",
  // "In the brief" and Next in that order.
  const feedback = page.getByRole("region", { name: "Feedback" })
  await expect(feedback.locator("[tabindex='-1']")).toBeFocused()
  await expect(feedback).toContainText("Right")
  await expect(announcer(page)).toHaveText("Right")
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Why?" })).toBeFocused()
  await page.keyboard.press("Tab")
  const inBrief = page.getByRole("button", { name: "In the brief" })
  await expect(inBrief).toBeFocused()
  // The brief opens and closes from the keyboard, and focus comes back.
  await page.keyboard.press("Enter")
  const sheet = page.getByRole("dialog", { name: "In the brief" })
  await expect(sheet).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(sheet).toBeHidden()
  await expect(inBrief).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Next" })).toBeFocused()
  await page.keyboard.press("Enter")

  // A short answer: write, Submit, then focus reads what was written and the
  // sample before the checklist; the tick line is announced.
  await expect(
    page.getByRole("heading", { name: "Exercise 2 of 2 · short answer" })
  ).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(
    page.getByRole("textbox", {
      name: "Why do cryptographers publish their algorithms instead of keeping them secret?",
    })
  ).toBeFocused()
  await page.keyboard.type("so experts can find the weak spots")
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Submit" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { name: "You wrote" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(
    page.getByRole("checkbox", { name: "Public study finds weaknesses" })
  ).toBeFocused()
  await page.keyboard.press("Space")
  await expect(announcer(page)).toHaveText("1 of 2 · Partly recalled")
  await tabTo(page, page.getByRole("button", { name: "Next" }))
  await page.keyboard.press("Enter")

  // A sticky note (WF-E6): the step change is announced and the board's
  // heading has focus. Tab order matches the screen: Skip, then Stick it.
  await expect(
    page.getByRole("heading", { name: "Add to your answers" })
  ).toBeFocused()
  await expect(announcer(page)).toHaveText("Step 5 of 5 · Add to your answers")
  expect(await axe(page)).toEqual([])
  await page.keyboard.press("Tab")
  await expect(
    page.getByRole("textbox", { name: "Your note for Q2" })
  ).toBeFocused()
  await page.keyboard.type("one shared key, so it must stay secret")
  await page.keyboard.press("Tab")
  await expect(
    page.getByRole("button", { name: "Skip this step" })
  ).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Stick it" })).toBeFocused()
  await page.keyboard.press("Enter")

  // The next board takes focus; skipping it completes the lesson.
  await expect(
    page.getByRole("textbox", { name: "Your note for Q1" })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Add to your answers" })
  ).toBeFocused()
  await tabTo(page, page.getByRole("button", { name: "Skip this step" }))
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("heading", { name: "Lesson 1 complete" })
  ).toBeFocused()
  expect(seed.notes(ENC.id)).toEqual(["one shared key, so it must stay secret"])
})

test("skip and Undo by keyboard leave focus on the lesson @phone", async ({
  page,
}) => {
  seed.startLesson(ENC.id, ENC.lessons[0], { step: "read" })
  await page.goto("/")
  await tabTo(page, page.getByRole("button", { name: "Start session" }))
  await page.keyboard.press("Enter")
  const title = page.locator("header h1")
  await expect(title).toHaveText("Lesson 1 · Locks with one key")
  const unitHeading = page
    .locator("[data-slot=player-main]")
    .locator("h1, h2")
    .first()

  // ⋯ → Mark as skipped: the next lesson's heading takes focus, and the
  // closing menu does not hand it back to ⋯.
  await tabTo(page, page.getByRole("button", { name: "More" }))
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menu")).toBeVisible()
  // Menus move by arrow keys: Hide timer first, then Mark as skipped.
  await expect(page.getByRole("menuitem", { name: "Hide timer" })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(
    page.getByRole("menuitem", { name: "Mark as skipped" })
  ).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(title).toHaveText("Lesson 2 · Fingerprints for data")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(unitHeading).toBeFocused()

  // Undo in the toast: once the toast has gone, focus is on the lesson, not
  // lost to the page.
  const toast = page.locator("[data-sonner-toast]").filter({
    hasText: "Lesson 1 skipped",
  })
  const undo = toast.getByRole("button", { name: "Undo" })
  // Alt+T moves focus to the toasts (Sonner's hotkey), then Tab to Undo.
  await page.keyboard.press("Alt+T")
  await tabTo(page, undo, 5)
  await page.keyboard.press("Enter")
  await expect(title).toHaveText("Lesson 1 · Locks with one key")
  await expect(toast).toHaveCount(0)
  await expect(unitHeading).toBeFocused()
})

test("a skip dropped while another step finishes gives focus back to ⋯", async ({
  page,
}) => {
  seed.startLesson(ENC.id, ENC.lessons[0], { step: "read" })
  await page.goto("/")
  await tabTo(page, page.getByRole("button", { name: "Start session" }))
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "Done reading" })).toBeVisible()

  const more = page.getByRole("button", { name: "More" })
  await tabTo(page, more)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitem", { name: "Hide timer" })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  const skip = page.getByRole("menuitem", { name: "Mark as skipped" })
  await expect(skip).toBeFocused()

  // Done reading starts finishing, and the skip is chosen in the same task,
  // before the busy state reaches the menu: the player drops the skip.
  await page.evaluate(() => {
    const done = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Done reading"
    )!
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (i) => i.textContent === "Mark as skipped"
    ) as HTMLElement
    done.click()
    item.click()
  })

  // Read finished, the skip did not, and focus is back on ⋯, not lost.
  await expect(
    page.getByRole("textbox", { name: "What do you remember?" })
  ).toBeVisible()
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(more).toBeFocused()
  expect(seed.lessonRow(ENC.id, ENC.lessons[0])?.skipped).toBe(0)
})
