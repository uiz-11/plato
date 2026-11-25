// npm run course:display-check <course-id> [--json]   (§11.4)
//
// Renders every brief, exercise and recall prompt of a course (published or
// draft) through the preview route at 1280×800 and 390×844, and fails on
// what displays badly. Screenshots of failing elements go to
// `.pipeline/screens/<course-id>/`. Needs `npm run build` and a Playwright
// Chromium (`npx playwright install chromium`). Content is read from
// PLATO_CONTENT_DIR, or `content/`.

import { join } from "node:path"
import { parseArgs } from "node:util"

import { contentRoot } from "@/lib/content/load"

import {
  COURSE_ID,
  displayCheck,
  formatDisplayCheck,
  screensDir,
  startApp,
} from "./lib/display-check"

const USAGE = "usage: npm run course:display-check <course-id> [--json]"

async function main(): Promise<number> {
  let args
  try {
    args = parseArgs({
      allowPositionals: true,
      options: { json: { type: "boolean" } },
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
  // The id names the screenshots folder, which is emptied first.
  if (!COURSE_ID.test(id)) {
    console.error(`"${id}" is not a course id\n${USAGE}`)
    return 2
  }

  const repo = join(import.meta.dirname, "..")
  let app
  try {
    app = await startApp({ contentDir: contentRoot(), repo })
  } catch (error) {
    console.error(`display-check: ${(error as Error).message}`)
    return 2
  }
  try {
    let result
    try {
      result = await displayCheck({
        app,
        courseId: id,
        outDir: screensDir(repo, id),
      })
    } catch (error) {
      // The browser is missing, or a page never loaded: not a content failure.
      console.error(`display-check: ${(error as Error).message}`)
      return 2
    }
    console.log(
      args.values.json
        ? JSON.stringify(result, null, 2)
        : formatDisplayCheck(result, repo)
    )
    return result.ok ? 0 : 1
  } finally {
    await app.stop()
  }
}

process.exitCode = await main()
