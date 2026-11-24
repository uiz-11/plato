// npm run course:publish <id>   (§5.6, §11.2 stage 6)
//
// Runs `course:validate --publish` and appends the manifest entry. The
// operator then commits the course and the manifest and opens a PR.

import { contentRoot } from "@/lib/content/load"

import { exitOnContentError, formatFindings, summaryLine } from "./lib/findings"
import { publishCourse } from "./lib/manifest"

const [id, ...extra] = process.argv.slice(2)
if (!id || extra.length || id.startsWith("-")) {
  console.error("usage: npm run course:publish <course-id>")
  process.exit(2)
}

const result = exitOnContentError(() =>
  publishCourse(contentRoot(), id, new Date())
)
if (result.findings.length) console.log(formatFindings(result.findings))
if (!result.ok) {
  console.error(result.message ?? summaryLine(id, result.findings))
  console.error(`Not published.`)
  process.exit(1)
}
console.log(
  `Published "${id}"${result.entry.requestId ? ` for request ${result.entry.requestId}` : ""}.\n` +
    `Commit courses/${id}/ and published.json, then open a pull request.`
)
