// npm run requests:export   (§11.1)
//
// Writes one file per open course request to `.pipeline/requests/<id>.json`,
// using PLATO_URL and PLATO_PASSCODE, and removes files for requests that are
// no longer open. Run it before the course-creation skill. PLATO_PIPELINE_DIR
// moves `.pipeline/` (tests only).

import { join, resolve } from "node:path"

import { exportRequests } from "./lib/requests-export"

const baseUrl = process.env.PLATO_URL
if (!baseUrl || process.argv.length > 2) {
  console.error(
    "usage: PLATO_URL=<app url> PLATO_PASSCODE=<passcode> npm run requests:export"
  )
  process.exit(2)
}

const pipelineDir = process.env.PLATO_PIPELINE_DIR
  ? resolve(process.env.PLATO_PIPELINE_DIR)
  : join(import.meta.dirname, "..", ".pipeline")
const result = await exportRequests({
  baseUrl,
  passcode: process.env.PLATO_PASSCODE || undefined,
  outDir: join(pipelineDir, "requests"),
})
if (!result.ok) {
  console.error(result.message)
  process.exit(1)
}

const n = result.written.length
console.log(
  `Exported ${n} open request${n === 1 ? "" : "s"} to .pipeline/requests/.`
)
if (result.removed.length)
  console.log(
    `Removed ${result.removed.length} that ${result.removed.length === 1 ? "is" : "are"} no longer open.`
  )
