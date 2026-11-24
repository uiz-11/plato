// npm run content:check [--base <ref>] [--dir <content dir>]   (§5.6)
//
// Run in CI on every PR: the manifests are append-only, published courses are
// unchanged since the merge base on main, and every newly published course
// passes `course:validate --publish`.

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

for (const id of result.newlyPublished) {
  const v = validateCourse(id, { root: join(repo, dir), publish: true })
  if (v.findings.length) console.log(formatFindings(v.findings))
  console.log(summaryLine(id, v.findings))
  if (!v.ok) failed = true
}

console.log(
  failed
    ? "content:check failed."
    : `content:check passed (base ${base.slice(0, 12)}, ${result.newlyPublished.length} newly published).`
)
process.exitCode = failed ? 1 : 0
