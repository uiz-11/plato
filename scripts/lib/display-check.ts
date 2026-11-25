// The display check (§11.4): loads the preview route of a course at 1280×800
// and 390×844, in light mode, and reports what displays badly:
//
// - horizontal page scroll;
// - anything that sticks out of the column or is cut off inside a box that
//   scrolls or clips, except `pre` and `.katex-display`, which may scroll
//   sideways. Inline math, tables and figures must fit the column;
// - a `.katex-error`;
// - a figure that did not render;
// - console errors and uncaught page errors.
//
// Each failing element gets a screenshot in `outDir`, for the pipeline to
// inspect. `startApp` runs the standalone server with test hooks on, so the
// preview route exists.

import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

import { chromium, type Browser, type Page } from "@playwright/test"

// The phone has touch but not `isMobile`: with it, Chromium zooms out a page
// that is too wide, which moves the elements a screenshot should show. The
// layout is the same, since it follows the 390px width.
export const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800, touch: false },
  { name: "phone", width: 390, height: 844, touch: true },
] as const

export type FailureKind =
  | "page-scroll"
  | "math"
  | "table"
  | "figure"
  | "overflow"
  | "katex-error"
  | "console"
  | "load"

export type DisplayFailure = {
  /** `desktop` (1280×800) or `phone` (390×844). */
  viewport: (typeof VIEWPORTS)[number]["name"]
  kind: FailureKind
  /** The item's id (`<lesson>/brief`, `<lesson>/exercise/<id>`, …), if any. */
  item: string | null
  /** "Lesson 2 brief", or "page". */
  label: string
  detail: string
  /** The failing element's screenshot, when there is one. */
  screenshot: string | null
}

export type DisplayCheckResult = {
  courseId: string
  ok: boolean
  /** How many items were checked at each viewport. */
  items: number
  failures: DisplayFailure[]
}

export type App = {
  baseURL: string
  /** Sent with every request: the passcode as a bearer token (§8.5). */
  headers: Record<string, string>
  stop(): Promise<void>
}

export const SERVER = ".next/standalone/server.js"

/**
 * Starts the standalone server (`npm run build` first) on a free port with
 * test hooks on, a throwaway database, and `contentDir` as its content.
 */
export async function startApp(opts: {
  contentDir: string
  repo?: string
}): Promise<App> {
  // The free port is released before the server binds it, so another
  // process can take it in between: try again on a fresh one.
  for (let attempt = 1; ; attempt++) {
    try {
      return await startOnce(opts)
    } catch (error) {
      if (!(error instanceof PortTaken) || attempt === 3) throw error
    }
  }
}

class PortTaken extends Error {}

async function startOnce({
  contentDir,
  repo = process.cwd(),
}: {
  contentDir: string
  repo?: string
}): Promise<App> {
  const server = join(repo, SERVER)
  if (!existsSync(server))
    throw new Error(`${SERVER} is missing: run \`npm run build\` first`)
  const port = await freePort()
  const dbDir = mkdtempSync(join(tmpdir(), "plato-display-check-"))
  const passcode = randomBytes(24).toString("hex")
  const child = spawn(process.execPath, [server], {
    cwd: repo,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      PLATO_DB_PATH: join(dbDir, "plato.db"),
      PLATO_CONTENT_DIR: resolve(contentDir),
      PLATO_PASSCODE: passcode,
      PLATO_COOKIE_SECRET: randomBytes(24).toString("hex"),
      PLATO_TEST_HOOKS: "1",
      PLATO_TIME_ZONE: "UTC",
    },
  })
  let output = ""
  child.stdout!.on("data", (d) => (output += d))
  child.stderr!.on("data", (d) => (output += d))

  const stop = async () => {
    await kill(child)
    rmSync(dbDir, { recursive: true, force: true })
  }
  const baseURL = `http://127.0.0.1:${port}`
  try {
    await waitUntilUp(`${baseURL}/unlock`, child, () => output)
  } catch (error) {
    await stop()
    throw error
  }
  return { baseURL, headers: { authorization: `Bearer ${passcode}` }, stop }
}

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer()
    s.once("error", fail)
    s.listen(0, "127.0.0.1", () => {
      const address = s.address()
      s.close(() =>
        typeof address === "object" && address
          ? ok(address.port)
          : fail(new Error("no free port"))
      )
    })
  })
}

async function waitUntilUp(
  url: string,
  child: ChildProcess,
  output: () => string,
  timeoutMs = 60_000
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const message = `the server exited with code ${child.exitCode}:\n${output()}`
      throw output().includes("EADDRINUSE")
        ? new PortTaken(message)
        : new Error(message)
    }
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`the server did not start within ${timeoutMs / 1000}s`)
}

function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve()
  return new Promise((ok) => {
    const force = setTimeout(() => child.kill("SIGKILL"), 5_000)
    child.once("exit", () => {
      clearTimeout(force)
      ok()
    })
    child.kill("SIGTERM")
  })
}

/**
 * Checks one course on a running app. Screenshots go in `outDir`, which is
 * emptied first so it holds only this run's.
 */
export async function displayCheck({
  app,
  courseId,
  outDir,
  browser: shared,
}: {
  app: Pick<App, "baseURL" | "headers">
  courseId: string
  outDir: string
  /** Reuse a browser across courses; one is launched otherwise. */
  browser?: Browser
}): Promise<DisplayCheckResult> {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const browser = shared ?? (await chromium.launch())
  const failures: DisplayFailure[] = []
  let items = 0
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.touch,
        colorScheme: "light",
        extraHTTPHeaders: app.headers,
      })
      try {
        const page = await context.newPage()
        const result = await checkViewport(page, app.baseURL, courseId, vp)
        items = Math.max(items, result.items)
        // On a phone each item's action bar is pinned to the bottom of the
        // window, over whatever scrolls under it. Unpinned, it keeps its
        // place in the item, so the layout measured above is unchanged.
        if (result.failures.some((f) => f.mark !== null))
          await page.addStyleTag({
            content:
              '[data-slot="action-bar"] { position: static !important; }',
          })
        let n = 0
        for (const f of result.failures) {
          let screenshot: string | null = null
          if (f.mark !== null || f.kind === "page-scroll") {
            const file = join(
              outDir,
              `${vp.name}-${String(++n).padStart(2, "0")}-${slug(f.item ?? "page")}-${f.kind}.png`
            )
            try {
              if (f.mark === null) await page.screenshot({ path: file })
              else
                await page
                  .locator(`[data-display-failure="${f.mark}"]`)
                  .screenshot({ path: file, timeout: 5_000 })
              screenshot = file
            } catch {
              // An element with no box to capture (display: contents).
            }
          }
          failures.push({
            viewport: vp.name,
            kind: f.kind,
            item: f.item,
            label: f.label,
            detail: f.detail,
            screenshot,
          })
        }
      } finally {
        await context.close()
      }
    }
  } finally {
    if (!shared) await browser.close()
  }
  return { courseId, ok: failures.length === 0, items, failures }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

type Found = {
  kind: FailureKind
  item: string | null
  label: string
  detail: string
  /** `data-display-failure` on the element to screenshot. */
  mark: string | null
}

async function checkViewport(
  page: Page,
  baseURL: string,
  courseId: string,
  vp: (typeof VIEWPORTS)[number]
): Promise<{ items: number; failures: Found[] }> {
  const errors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))

  const url = `${baseURL}/dev/preview/${encodeURIComponent(courseId)}`
  const res = await page.goto(url, { waitUntil: "networkidle" })
  if (!res || res.status() !== 200)
    return {
      items: 0,
      failures: [
        {
          kind: "load",
          item: null,
          label: "page",
          detail: `${url} answered ${res?.status() ?? "nothing"}${
            res?.status() === 404
              ? ": no such course, or test hooks are off"
              : ""
          }`,
          mark: null,
        },
      ],
    }
  await page.evaluate(() => document.fonts.ready)
  // Client effects (drafts, action bars) settle after hydration.
  await page.waitForTimeout(250)

  // tsx compiles with esbuild's keepNames, which wraps the functions inside
  // `measure` in `__name(...)`: a helper the page does not have.
  await page.evaluate("globalThis.__name ??= (fn) => fn")
  const measured = await page.evaluate(measure)
  const failures: Found[] = [...measured.failures]
  for (const text of errors)
    failures.push({
      kind: "console",
      item: null,
      label: "page",
      detail: text,
      mark: null,
    })
  if (measured.items === 0)
    failures.push({
      kind: "load",
      item: null,
      label: "page",
      detail: `the preview showed no items at ${vp.width}×${vp.height}`,
      mark: null,
    })
  return { items: measured.items, failures }
}

/** Runs in the page. Self-contained: Playwright serializes it. */
function measure(): { items: number; failures: Found[] } {
  const failures: Found[] = []
  let marks = 0
  const mark = (el: Element) => {
    const id = String(marks++)
    el.setAttribute("data-display-failure", id)
    return id
  }
  const px = (n: number) => `${Math.round(n)}px`
  const kindOf = (el: Element): FailureKind =>
    el.matches(".katex, .katex-display") || el.querySelector(".katex")
      ? "math"
      : el.matches("table") || el.querySelector("table")
        ? "table"
        : // Only authored figures: icons are svgs too.
          el.closest("figure") || el.querySelector("figure")
          ? "figure"
          : "overflow"
  const describe = (el: Element) => {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim()
    const tag = el.tagName.toLowerCase()
    const cls = el.classList.contains("katex") ? ".katex" : ""
    return `<${tag}${cls}>${text ? ` "${text.length > 60 ? `${text.slice(0, 57)}…` : text}"` : ""}`
  }

  const root = document.documentElement
  if (root.scrollWidth > root.clientWidth + 1)
    failures.push({
      kind: "page-scroll",
      item: null,
      label: "page",
      detail: `the page scrolls sideways: ${px(root.scrollWidth)} wide in a ${px(root.clientWidth)} window`,
      mark: null,
    })

  const items = [...document.querySelectorAll("[data-display-item]")]
  for (const item of items) {
    const id = item.getAttribute("data-display-item")
    const label = item.getAttribute("data-display-label") ?? id ?? "item"
    const col = item.getBoundingClientRect()
    const found: { el: Element; kind: FailureKind; detail: string }[] = []

    for (const el of item.querySelectorAll("*")) {
      const parent = el.parentElement
      // What a `pre` or display math holds may scroll inside it; inline math
      // and figures are measured as a whole.
      const outer = parent?.closest("pre, .katex-display, .katex, svg")
      if (outer && item.contains(outer)) continue
      if (el.closest(".sr-only")) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      const style = getComputedStyle(el)
      if (style.position === "fixed") continue

      const past = Math.max(col.left - r.left, r.right - col.right)
      if (past > 1) {
        found.push({
          el,
          kind: kindOf(el),
          detail: `${describe(el)} is ${px(r.width)} wide and sticks out ${px(past)} past the ${px(col.width)} column`,
        })
        continue
      }
      if (el.scrollWidth <= el.clientWidth + 1) continue
      // `pre` and display math may scroll sideways, but only if they do:
      // overflowing visibly, their content spills past the column.
      if (el.matches("pre, .katex-display")) {
        if (style.overflowX === "visible")
          found.push({
            el,
            kind: kindOf(el),
            detail: `${describe(el)} holds ${px(el.scrollWidth)} of content in a ${px(el.clientWidth)} box and does not scroll, so it spills past the column`,
          })
      } else if (["auto", "scroll", "hidden", "clip"].includes(style.overflowX))
        found.push({
          el,
          kind: kindOf(el),
          detail: `${describe(el)} holds ${px(el.scrollWidth)} of content in a ${px(el.clientWidth)} box, so it is cut off or scrolls sideways`,
        })
    }
    // One failure per problem: the outermost element that shows it.
    for (const f of found)
      if (!found.some((g) => g.el !== f.el && g.el.contains(f.el)))
        failures.push({
          kind: f.kind,
          item: id,
          label,
          detail: f.detail,
          mark: mark(f.el),
        })

    for (const err of item.querySelectorAll(".katex-error"))
      failures.push({
        kind: "katex-error",
        item: id,
        label,
        detail: `math did not render: ${err.getAttribute("title") ?? describe(err)}`,
        mark: mark(err),
      })

    for (const fig of item.querySelectorAll("figure")) {
      const art = fig.querySelector("svg, img")
      const r = art?.getBoundingClientRect()
      const broken =
        !art ||
        !r ||
        r.width < 1 ||
        r.height < 1 ||
        (art instanceof HTMLImageElement &&
          (!art.complete || art.naturalWidth === 0))
      if (broken)
        failures.push({
          kind: "figure",
          item: id,
          label,
          detail: `${describe(fig)} did not render${art ? "" : ": it has no image"}`,
          mark: mark(fig),
        })
    }
  }
  return { items: items.length, failures }
}

/** The report the CLI and `content:check` print. */
export function formatDisplayCheck(
  result: DisplayCheckResult,
  cwd = process.cwd()
): string {
  const size = (v: DisplayFailure["viewport"]) => {
    const vp = VIEWPORTS.find((x) => x.name === v)!
    return `${vp.width}×${vp.height}`
  }
  const lines = result.failures.map(
    (f) =>
      `  ${size(f.viewport).padEnd(9)} ${f.label}: ${f.kind}: ${f.detail}${
        f.screenshot
          ? `\n            screenshot: ${relativeTo(cwd, f.screenshot)}`
          : ""
      }`
  )
  const head = result.ok
    ? `display-check ${result.courseId}: passed (${result.items} items at ${VIEWPORTS.map((v) => `${v.width}×${v.height}`).join(" and ")})`
    : `display-check ${result.courseId}: ${result.failures.length} failure${result.failures.length === 1 ? "" : "s"}`
  return [head, ...lines].join("\n")
}

function relativeTo(cwd: string, file: string) {
  const rel = relative(cwd, file)
  return rel && !rel.startsWith("..") && !isAbsolute(rel)
    ? rel.split(sep).join("/")
    : file
}

/** A course id: a lowercase slug, as `getCourse` accepts (§5.1). */
export const COURSE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Where a course's screenshots go: `.pipeline/screens/<course-id>/`. Throws
 * for anything but a course id, since `displayCheck` empties the folder.
 */
export function screensDir(repo: string, courseId: string): string {
  if (!COURSE_ID.test(courseId))
    throw new Error(`"${courseId}" is not a course id`)
  return join(repo, ".pipeline", "screens", courseId)
}
