import { expect, test, type Page } from "@playwright/test"

import { axe, isPhone, tapTargets } from "./audit"
import { emptyBaseURL, locked } from "./auth"
import { ENC, LEAP, Seed } from "./seed"

// The accessibility and phone audit (§10, T19, WF-I, WF-J): one row per
// screen, each run at both viewports. Every screen has no serious or
// critical axe violations, and on a phone its tap targets are at least
// 44 px and 8 px apart.

async function audit(page: Page) {
  expect(await axe(page)).toEqual([])
  if (isPhone(test.info().project.name))
    expect(await tapTargets(page)).toEqual([])
}

// --- Shell screens ----------------------------------------------------------

const shellScreens: Array<{
  name: string
  path: string
  locked?: boolean
  base?: string
  /** Learner state the screen needs; every row starts from none. */
  seed?: (seed: Seed) => void
  /** Opens an overlay on the screen before the audit. */
  then?: (page: Page) => Promise<void>
}> = [
  { name: "unlock", path: "/unlock", locked: true },
  { name: "today", path: "/" },
  {
    name: "today, session length menu",
    path: "/",
    seed: (s) => s.startLesson(LEAP.id, LEAP.lessons[0], { step: "read" }),
    then: async (page) => {
      await page
        .getByRole("button", { name: /^Session length/ })
        .first()
        .click()
      await expect(
        page.getByRole("radiogroup").or(page.getByRole("menu")).first()
      ).toBeVisible()
      await expect(
        page.getByRole("dialog").or(page.getByRole("menu")).first()
      ).toHaveCSS("opacity", "1")
    },
  },
  { name: "today, first run", path: "/", base: emptyBaseURL },
  { name: "new request", path: "/new" },
  { name: "library", path: "/library" },
  { name: "syllabus", path: `/courses/${ENC.id}/syllabus` },
  {
    name: "syllabus, lesson menu",
    path: `/courses/${ENC.id}/syllabus`,
    then: async (page) => {
      await page.getByRole("button", { name: /More/ }).first().click()
      await expect(page.getByRole("menu")).toBeVisible()
      await expect(page.getByRole("menu")).toHaveCSS("opacity", "1")
    },
  },
  { name: "answers", path: `/courses/${ENC.id}/answers` },
  {
    name: "answers, note editor",
    path: `/courses/${ENC.id}/answers`,
    then: async (page) => {
      await page.getByRole("button", { name: "Add note to Q1" }).click()
      await expect(page.getByRole("dialog")).toBeVisible()
      await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1")
    },
  },
  { name: "sources", path: `/courses/${ENC.id}/sources` },
  { name: "not found", path: "/no-such-page" },
]

test.describe("shell screens", () => {
  let seed: Seed
  test.beforeEach(() => {
    seed = new Seed().reset()
  })
  test.afterEach(() => {
    seed.reset().close()
  })

  for (const screen of shellScreens) {
    test.describe(screen.name, () => {
      if (screen.locked) test.use(locked)
      if (screen.base) test.use({ baseURL: screen.base })
      test(`${screen.name} passes the audit @phone`, async ({ page }) => {
        screen.seed?.(seed)
        await page.goto(screen.path)
        // A lost cookie would quietly audit /unlock instead.
        await expect(page).toHaveURL(screen.path)
        await expect(page.getByRole("heading").first()).toBeVisible()
        await screen.then?.(page)
        await audit(page)
      })
    })
  }
})

// --- Player screens ---------------------------------------------------------

const CHECKPOINT = { unit: "checkpoint", moduleId: "the-rule" }
const RECALL = ["e-tropical-recall", "e-julian-recall", "e-gregorian-recall"]
const confidence = (page: Page, name: "Sure" | "Not sure" | "Guess") =>
  page
    .getByRole("group", { name: "How sure are you?" })
    .getByRole("button", { name, exact: true })

/** Starts the session Today offers and waits for its first heading. */
async function startFromToday(page: Page, button = "Start session") {
  await page.goto("/")
  await page.getByRole("button", { name: button }).click()
  await expect(page).toHaveURL(/\/session\//)
}

/** Opens a seeded session by its id. */
async function openSession(page: Page, id: string) {
  await page.goto(`/session/${id}`)
  await expect(page).toHaveURL(`/session/${id}`)
}

/** The leap-years lesson done three days ago, its concepts due today. */
function leapDue(seed: Seed, cursor = 0) {
  seed.completeLesson(LEAP.id, LEAP.lessons[0], -3).shownUp(-3)
  for (const c of LEAP.concepts)
    seed.schedule(LEAP.id, c, { due: 0, last: -3, cursor })
}

const playerScreens: Array<{
  name: string
  /** Seeds the state and opens the screen. */
  open: (page: Page, seed: Seed) => Promise<void>
}> = [
  {
    name: "review prompt",
    open: async (page, seed) => {
      leapDue(seed)
      await startFromToday(page, "Reviews only")
      await expect(
        page.getByRole("button", { name: "Show answer" })
      ).toBeVisible()
    },
  },
  {
    name: "review prompt, rating",
    open: async (page, seed) => {
      leapDue(seed)
      await startFromToday(page, "Reviews only")
      await page.getByRole("button", { name: "Show answer" }).click()
      await expect(page.getByText("How well did you remember?")).toBeVisible()
    },
  },
  {
    name: "player menu",
    open: async (page, seed) => {
      leapDue(seed)
      await startFromToday(page, "Reviews only")
      await page.getByRole("button", { name: "More" }).click()
      await expect(page.getByRole("menu")).toBeVisible()
      await expect(page.getByRole("menu")).toHaveCSS("opacity", "1")
    },
  },
  {
    name: "review exercise",
    open: async (page, seed) => {
      leapDue(seed, 2)
      await startFromToday(page, "Reviews only")
      await expect(confidence(page, "Sure")).toBeVisible()
    },
  },
  {
    name: "warm up",
    open: async (page, seed) => {
      seed
        .completeLesson(ENC.id, ENC.lessons[0], -1)
        .startLesson(ENC.id, ENC.lessons[1], { step: "warmup", index: 0 })
      await startFromToday(page)
      await expect(
        page.getByRole("button", { name: "Show answer" })
      ).toBeVisible()
    },
  },
  {
    name: "guess first",
    open: async (page, seed) => {
      seed.startLesson(ENC.id, ENC.lessons[0], { step: "guess", index: 0 })
      await startFromToday(page)
      await expect(
        page.getByRole("button", { name: "Lock in guess" })
      ).toBeVisible()
    },
  },
  {
    name: "read",
    open: async (page, seed) => {
      seed.startLesson(ENC.id, ENC.lessons[0], { step: "read" })
      await startFromToday(page)
      await expect(
        page.getByRole("button", { name: "Done reading" })
      ).toBeVisible()
    },
  },
  {
    name: "recall, write",
    open: async (page, seed) => {
      seed.startLesson(LEAP.id, LEAP.lessons[0], {
        step: "recall",
        phase: "write",
      })
      await startFromToday(page)
      await expect(page.getByRole("button", { name: "Check" })).toBeVisible()
    },
  },
  {
    name: "recall, tick",
    open: async (page, seed) => {
      seed.startLesson(LEAP.id, LEAP.lessons[0], {
        step: "recall",
        phase: "tick",
      })
      await startFromToday(page)
      await expect(
        page.getByRole("heading", { name: "Tick what you recalled" })
      ).toBeVisible()
    },
  },
  {
    name: "recall exercise, feedback",
    open: async (page, seed) => {
      seed.startLesson(
        LEAP.id,
        LEAP.lessons[0],
        { step: "recall", phase: "exercises", index: 0 },
        RECALL
      )
      await startFromToday(page)
      await page.getByText("The months have different lengths").click()
      await confidence(page, "Sure").click()
      await expect(page.getByRole("region", { name: "Feedback" })).toBeVisible()
    },
  },
  {
    name: "brief sheet",
    open: async (page, seed) => {
      seed.startLesson(
        LEAP.id,
        LEAP.lessons[0],
        { step: "recall", phase: "exercises", index: 0 },
        RECALL
      )
      await startFromToday(page)
      await page.getByText("The months have different lengths").click()
      await confidence(page, "Sure").click()
      await page.getByRole("button", { name: "In the brief" }).click()
      const sheet = page.getByRole("dialog", { name: "In the brief" })
      // Checked once it has faded in: mid-fade, text has too little contrast.
      await expect(sheet).toHaveCSS("opacity", "1")
    },
  },
  {
    name: "short answer, checklist",
    open: async (page, seed) => {
      seed.startLesson(
        LEAP.id,
        LEAP.lessons[0],
        { step: "recall", phase: "exercises", index: 2 },
        RECALL
      )
      await startFromToday(page)
      await page
        .getByRole("textbox", {
          name: "Explain why 2000 was a leap year but 1900 was not.",
        })
        .fill("centuries skip unless divisible by 400")
      await page.getByRole("button", { name: "Submit" }).click()
      await expect(page.getByText("Tick what you covered")).toBeVisible()
    },
  },
  {
    name: "add to your answers",
    open: async (page, seed) => {
      seed.startLesson(
        ENC.id,
        ENC.lessons[0],
        { step: "answers", index: 0 },
        []
      )
      await startFromToday(page)
      await expect(page.getByRole("button", { name: "Stick it" })).toBeVisible()
    },
  },
  {
    name: "lesson complete",
    open: async (page, seed) => {
      seed.startLesson(
        ENC.id,
        ENC.lessons[0],
        { step: "answers", index: 0 },
        []
      )
      await startFromToday(page)
      await page.getByRole("button", { name: "Skip this step" }).click()
      await expect(
        page.getByRole("heading", { name: "Lesson 1 complete" })
      ).toBeVisible()
    },
  },
  {
    name: "checkpoint exercise",
    open: async (page, seed) => {
      seed.completeLesson(LEAP.id, LEAP.lessons[0], -1)
      const id = seed.session(
        LEAP.id,
        { ...CHECKPOINT, index: 0 },
        { checkpointQueue: LEAP.checkpoints }
      )
      await openSession(page, id)
    },
  },
  {
    name: "mastery summary",
    open: async (page, seed) => {
      seed.completeCourse(LEAP, -1)
      const id = seed.session(
        LEAP.id,
        { ...CHECKPOINT, index: LEAP.checkpoints.length },
        { checkpointQueue: LEAP.checkpoints }
      )
      await openSession(page, id)
    },
  },
  {
    name: "course complete",
    open: async (page, seed) => {
      seed.completeCourse(LEAP, -1)
      await openSession(
        page,
        seed.session(LEAP.id, { unit: "end", screen: "course-complete" })
      )
    },
  },
  {
    name: "session complete",
    open: async (page, seed) => {
      seed.completeCourse(LEAP, -1)
      await openSession(
        page,
        seed.session(LEAP.id, { unit: "end", screen: "summary" })
      )
    },
  },
]

test.describe("player screens", () => {
  let seed: Seed
  test.beforeEach(() => {
    seed = new Seed().reset()
  })
  test.afterEach(() => {
    seed.reset().close()
  })

  for (const screen of playerScreens) {
    test(`${screen.name} passes the audit @phone`, async ({ page }) => {
      await screen.open(page, seed)
      await expect(
        page.getByRole("heading", { level: 2 }).first()
      ).toBeVisible()
      await audit(page)
      // A unit arriving from the one before focuses its first heading
      // (ArrivalFocus), so that heading must be focusable.
      await expect(
        page.locator("[data-slot=player-main]").locator("h1, h2").first()
      ).toHaveAttribute("tabindex", "-1")
    })
  }
})
