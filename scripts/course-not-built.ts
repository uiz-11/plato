// npm run course:not-built <requestId> "<reason>"   (§11.2)
//
// Records a decision not to build a requested course. The learner sees the
// reason (spec F1), so it is one plain sentence.

import { contentRoot } from "@/lib/content/load"

import { exitOnContentError } from "./lib/findings"
import { recordNotBuilt } from "./lib/manifest"

const [requestId, reason, ...extra] = process.argv.slice(2)
if (!requestId || !reason || extra.length) {
  console.error('usage: npm run course:not-built <request-id> "<reason>"')
  process.exit(2)
}

const result = exitOnContentError(() =>
  recordNotBuilt(contentRoot(), requestId, reason, new Date())
)
if (!result.ok) {
  console.error(result.message)
  process.exit(1)
}
console.log(
  `Recorded request ${requestId} as not built.\nCommit not-built.json, then open a pull request.`
)
