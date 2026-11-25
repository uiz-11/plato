import { expect, test } from "@playwright/test"

import { ENC, Seed } from "./seed"

// e2e journey 5 (§10, spec F7, WF-C2): add, edit and delete an answer note
// on the Answers tab.

let seed: Seed
test.beforeAll(() => {
  seed = new Seed().reset()
})
test.afterAll(() => {
  seed.reset().close()
})

const ANSWERS = `/courses/${ENC.id}/answers`
const Q1 = "How can two strangers agree on a secret over a public channel?"

test("journey 5: add, edit and delete a note", async ({ page }) => {
  await page.goto(`/courses/${ENC.id}/syllabus`)
  await page
    .getByRole("navigation", { name: "Course" })
    .getByRole("link", { name: "Answers" })
    .click()
  await expect(page).toHaveURL(ANSWERS)
  await expect(page.getByText("Your notes. Not graded.")).toBeVisible()

  const q1 = page.getByRole("region", { name: Q1 })
  await expect(q1).toContainText("Lessons 1, 3")
  // No notes yet: only the empty sticky (WF-C2.2).
  await expect(q1.getByRole("button")).toHaveCount(1)

  // Add.
  await q1.getByRole("button", { name: "Add note to Q1" }).click()
  const editor = page.getByRole("dialog")
  await editor.getByLabel("New note · Q1").fill("Each side mixes in a secret")
  await editor.getByRole("button", { name: "Add note" }).click()
  await expect(editor).toHaveCount(0)
  const note = q1.locator("[data-variant=note]")
  await expect(note).toHaveText(/Each side mixes in a secret/)
  expect(seed.notes(ENC.id)).toEqual(["Each side mixes in a secret"])

  // It is saved: a reload still shows it.
  await page.reload()
  await expect(note).toHaveText(/Each side mixes in a secret/)

  // Edit.
  await note.click()
  const box = page.getByRole("dialog").getByLabel("Edit note · Q1")
  await expect(box).toHaveValue("Each side mixes in a secret")
  await box.fill("Each side mixes a private colour into a public one")
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(note).toHaveText(
    /Each side mixes a private colour into a public one/
  )
  expect(seed.notes(ENC.id)).toEqual([
    "Each side mixes a private colour into a public one",
  ])

  // Delete: focus stays in the question, on "Add note".
  await note.click()
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click()
  await expect(note).toHaveCount(0)
  await expect(page.getByText("Note deleted")).toBeVisible()
  await expect(q1.getByRole("button", { name: "Add note to Q1" })).toBeFocused()
  expect(seed.notes(ENC.id)).toEqual([])

  // Undo puts it back; deleting again removes it for good.
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Note deleted" })
    .getByRole("button", { name: "Undo" })
    .click()
  await expect(note).toHaveText(
    /Each side mixes a private colour into a public one/
  )
  expect(seed.notes(ENC.id)).toEqual([
    "Each side mixes a private colour into a public one",
  ])
  await note.click()
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click()
  await expect(note).toHaveCount(0)
  expect(seed.notes(ENC.id)).toEqual([])
})

test("Cmd/Ctrl+Enter saves a note once", async ({ page }) => {
  seed.reset()
  await page.goto(ANSWERS)
  await page.getByRole("button", { name: "Add note to Q1" }).click()
  const box = page.getByRole("dialog").getByLabel("New note · Q1")
  await box.fill("Saved once")

  // Hold the save open, so the second press lands while it is pending.
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  let posts = 0
  await page.route(ANSWERS, async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    posts++
    await held
    await route.continue()
  })
  await box.press("ControlOrMeta+Enter")
  await expect.poll(() => posts).toBe(1)
  await box.press("ControlOrMeta+Enter")
  release()

  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(posts).toBe(1)
  await expect(
    page.getByRole("region", { name: Q1 }).locator("[data-variant=note]")
  ).toHaveCount(1)
  expect(seed.notes(ENC.id)).toEqual(["Saved once"])
})

test("notes stuck in a lesson are labelled with it", async ({ page }) => {
  seed
    .reset()
    .note(ENC.id, "q1", "Paint mixing is one-way", ENC.lessons[2])
    .note(ENC.id, "q1", "Written here")
  await page.goto(ANSWERS)
  const notes = page
    .getByRole("region", { name: Q1 })
    .locator("[data-variant=note]")
  await expect(notes).toHaveCount(2)
  await expect(notes.nth(0)).toContainText("Paint mixing is one-way")
  await expect(notes.nth(0)).toContainText("Lesson 3")
  await expect(notes.nth(1)).toHaveText(/Written here$/)
})

test("an empty note cannot be saved", async ({ page }) => {
  seed.reset()
  await page.goto(ANSWERS)
  await page.getByRole("button", { name: "Add note to Q1" }).click()
  const editor = page.getByRole("dialog")
  await editor.getByLabel("New note · Q1").fill("   ")
  await expect(editor.getByRole("button", { name: "Add note" })).toBeDisabled()
  await editor.getByRole("button", { name: "Cancel" }).click()
  await expect(editor).toHaveCount(0)
  expect(seed.notes(ENC.id)).toEqual([])
})
