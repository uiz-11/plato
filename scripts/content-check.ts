// npm run content:check [--base <ref>] [--dir <content dir>]   (§5.6)
//
// Run in CI on every PR: the manifests are append-only, published courses are
// unchanged since the merge base on main, and every newly published course
// passes `course:validate --publish` and the display check (§11.4). The
// display check needs the build (`npm run build`) and a Playwright Chromium;
// it runs only when a course is newly published.

import { realpathSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { parseArgs } from "node:util"

import { validateCourse } from "@/lib/content/validate"

import {
  BaseError,
  checkContent,
  gitTree,
  mergeBase,
  repoRoot,
  workTree,
} from "./lib/content-check"
import {
  displayCheck,
  formatDisplayCheck,
  screensDir,
  startApp,
} from "./lib/display-check"
import { formatFindings, summaryLine } from "./lib/findings"

const USAGE =
  "usage: npm run content:check [--base <ref>] [--dir <content dir>]"

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`)
  process.exit(2)
}

let values: { base?: string; dir?: string }
try {
  values = parseArgs({
    options: {
      base: { type: "string" },
      dir: { type: "string", default: "content" },
    },
  }).values
} catch (error) {
  fail((error as Error).message)
}

const repo = realpathSync(repoRoot(process.cwd()))
let contentDir: string
try {
  contentDir = realpathSync(resolve(values.dir!))
} catch {
  fail(`--dir ${values.dir}: no such folder`)
}
const dir = relative(repo, contentDir).split("\\").join("/")
if (!dir || dir.startsWith("..") || isAbsolute(dir))
  fail(`--dir must be a folder inside the repository (${repo})`)

let base: string
try {
  const found = mergeBase(repo, values.base)
  base = found.base
  if (found.fellBack)
    console.warn(
      `--base ${values.base} is not usable here; comparing with HEAD's parent instead`
    )
} catch (error) {
  if (!(error instanceof BaseError)) throw error
  fail(error.message)
}

const result = checkContent(gitTree(repo, base), workTree(repo), dir)
let failed = result.errors.length > 0
for (const e of result.errors) console.error(e)

const valid: string[] = []
for (const id of result.newlyPublished) {
  const v = validateCourse(id, { root: join(repo, dir), publish: true })
  if (v.findings.length) console.log(formatFindings(v.findings))
  console.log(summaryLine(id, v.findings))
  if (!v.ok) {
    failed = true
    console.log(`display-check ${id}: skipped until the course validates`)
  } else valid.push(id)
}

// One server for every course; content is read from the working tree.
if (valid.length) {
  let app
  try {
    app = await startApp({ contentDir: join(repo, dir), repo })
  } catch (error) {
    console.error(`display-check: ${(error as Error).message}`)
    failed = true
  }
  if (app)
    try {
      for (const id of valid) {
        try {
          const d = await displayCheck({
            app,
            courseId: id,
            outDir: screensDir(repo, id),
          })
          console.log(formatDisplayCheck(d, repo))
          if (!d.ok) failed = true
        } catch (error) {
          // The browser is missing, or a page never loaded.
          console.error(`display-check ${id}: ${(error as Error).message}`)
          failed = true
        }
      }
    } finally {
      await app.stop()
    }
}

console.log(
  failed
    ? "content:check failed."
    : `content:check passed (base ${base.slice(0, 12)}, ${result.newlyPublished.length} newly published).`
)
process.exitCode = failed ? 1 : 0
