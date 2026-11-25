import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

import { displayCheck, startApp } from "../scripts/lib/display-check"
import { E2E_PASSCODE, locked } from "./auth"

// T21 (§11.4): the display check passes on the fixture courses, and fails on
// a copy of one whose brief has an inline formula too wide for the column.

const FIXTURES = join(import.meta.dirname, "fixtures/content")

let out: string
test.beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), "plato-e2e-screens-"))
})
test.afterEach(() => rmSync(out, { recursive: true, force: true }))

for (const courseId of ["how-encryption-works", "leap-years"])
  test(`the display check passes on ${courseId}`, async ({
    baseURL,
    browser,
  }) => {
    test.setTimeout(60_000)
    const result = await displayCheck({
      app: {
        baseURL: baseURL!,
        headers: { authorization: `Bearer ${E2E_PASSCODE}` },
      },
      courseId,
      outDir: out,
      browser,
    })
    expect(result.failures).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.items).toBeGreaterThan(0)
  })

test.describe("locked", () => {
  test.use(locked)
  test("the preview route is behind the passcode", async ({ page }) => {
    await page.goto("/dev/preview/leap-years")
    await expect(page).toHaveURL(/\/unlock\?next=/)
  })
})

test("the display check fails on an overflowing formula", async ({
  browser,
}) => {
  test.setTimeout(120_000)
  // A draft copy: the preview loads drafts with test hooks on.
  const content = mkdtempSync(join(tmpdir(), "plato-e2e-content-"))
  try {
    cpSync(
      join(FIXTURES, "courses/leap-years"),
      join(content, "courses/leap-years"),
      { recursive: true }
    )
    writeFileSync(join(content, "published.json"), '{ "courses": [] }\n')
    writeFileSync(join(content, "not-built.json"), "[]\n")
    // `\mathrm` has no break points, so the formula cannot wrap. The same
    // formula as display math scrolls inside its block, which is allowed:
    // only the inline one may be reported.
    const word = `\\mathrm{${"divisiblebyfourbutnotbyonehundred".repeat(4)}}`
    appendFileSync(
      join(content, "courses/leap-years/lessons/leap-rule.md"),
      `\nThe rule as one word: $${word}$.\n\n$$\n${word}\n$$\n`
    )

    const app = await startApp({ contentDir: content })
    try {
      const result = await displayCheck({
        app,
        courseId: "leap-years",
        outDir: out,
        browser,
      })
      expect(result.ok).toBe(false)
      for (const viewport of ["desktop", "phone"]) {
        const math = result.failures.filter(
          (f) => f.viewport === viewport && f.kind === "math"
        )
        expect(math).toHaveLength(1)
        expect(math[0]).toMatchObject({
          item: "leap-rule/brief",
          label: "Lesson 1 brief",
          detail: expect.stringContaining("sticks out"),
        })
        expect(existsSync(math[0].screenshot!)).toBe(true)
      }
      // Nothing else in the course is reported.
      expect(
        result.failures.every((f) => ["math", "page-scroll"].includes(f.kind))
      ).toBe(true)

      // Display math takes focus only while it scrolls: the wide formula
      // does, the fixture's own (which fits) does not.
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        extraHTTPHeaders: app.headers,
      })
      try {
        const page = await context.newPage()
        await page.goto(`${app.baseURL}/dev/preview/leap-years`)
        const brief = page.locator('[data-display-item="leap-rule/brief"]')
        const blocks = brief.locator(".katex-display")
        await expect(blocks.last()).toHaveAttribute("tabindex", "0")
        await expect(blocks.first()).not.toHaveAttribute("tabindex")
        // Each guess is shown as the Guess step shows it, too.
        await expect(
          page.locator('[data-display-item^="leap-rule/guess/"]')
        ).not.toHaveCount(0)
      } finally {
        await context.close()
      }
    } finally {
      await app.stop()
    }
  } finally {
    rmSync(content, { recursive: true, force: true })
  }
})
