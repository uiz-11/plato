// Copies the static assets beside the standalone server, which does not copy
// them itself (next.config `output: 'standalone'`). Run after `next build`.
import { cpSync, existsSync } from "node:fs"

const out = ".next/standalone"
if (!existsSync(out)) {
  console.error(`${out} is missing: run \`next build\` first`)
  process.exit(1)
}
cpSync("public", `${out}/public`, { recursive: true })
cpSync(".next/static", `${out}/.next/static`, { recursive: true })
