// npm run course:validate <id> [--publish] [--json] [--online]   (§5.5)
//
// Structure checks by default (the pipeline's stage-4 gate); `--publish` adds
// the audit checks (stage 5); `--online` checks every URL answers 2xx (never
// in CI). Errors exit 1; warnings are printed. `--json` prints
// `{ courseId, ok, errors, warnings, findings }` for the pipeline's fix loop.

import { join } from "node:path"
import { parseArgs } from "node:util"

import { contentRoot, loadCourseDir } from "@/lib/content/load"
import { checkUrls, validateCourse } from "@/lib/content/validate"

import { formatFindings, summary, summaryLine } from "./lib/findings"

const USAGE =
  "usage: npm run course:validate <course-id> [--publish] [--json] [--online]"

async function main() {
  let args
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        publish: { type: "boolean" },
        json: { type: "boolean" },
        online: { type: "boolean" },
      },
    })
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`)
    return 2
  }
  const [id, ...extra] = args.positionals
  if (!id || extra.length) {
    console.error(USAGE)
    return 2
  }

  const root = contentRoot()
  const result = validateCourse(id, { root, publish: args.values.publish })
  if (args.values.online && result.ok)
    result.findings.push(
      ...(await checkUrls(loadCourseDir(join(root, "courses", id), null, root)))
    )
  else if (args.values.online)
    console.error("--online skipped: URLs are checked once there are no errors")
  const ok = summary(result.findings).errors === 0

  if (args.values.json) {
    console.log(
      JSON.stringify(
        {
          courseId: id,
          ok,
          ...summary(result.findings),
          findings: result.findings,
        },
        null,
        2
      )
    )
  } else {
    if (result.findings.length) console.log(formatFindings(result.findings))
    console.log(summaryLine(id, result.findings))
  }
  return ok ? 0 : 1
}

process.exitCode = await main()
