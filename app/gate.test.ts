import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

// `requireLearner()` is the real gate (§8.5). `proxy.ts` lets Server Action
// POSTs through so the action's own redirect reaches the client, and a client
// can send that header itself. So nothing behind the proxy may rely on it:
// every page and layout must read through the DAL or call `requireLearner()`,
// and every Server Action must call it first.

const APP = join(import.meta.dirname)

function files(dir: string, names: readonly string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return files(path, names)
    return names.includes(e.name) ? [path] : []
  })
}

const rel = (path: string) => relative(APP, path)

/** Files that render no learner data, with the reason. */
const UNGATED: Record<string, string> = {
  "layout.tsx": "root html, fonts and theme",
  "(shell)/layout.tsx": "navigation only",
  "(player)/layout.tsx": "a full-window wrapper",
  "(shell)/[...missing]/page.tsx": "calls notFound()",
  "unlock/page.tsx": "the gate itself",
}

const GATED = /requireLearner\(\)|from "@\/lib\/dal\//

describe("every page and layout is gated", () => {
  const routes = files(APP, ["page.tsx", "layout.tsx"])

  it("finds the routes", () => {
    expect(routes.length).toBeGreaterThan(Object.keys(UNGATED).length)
  })

  it.each(routes.map(rel))("%s", (path) => {
    const source = readFileSync(join(APP, path), "utf8")
    if (path in UNGATED) {
      // Listed as ungated, so it must not start reading learner data.
      expect(source, `${path}: ${UNGATED[path]}`).not.toMatch(
        /from "@\/lib\/(dal|db)\//
      )
      return
    }
    expect(source).toMatch(GATED)
  })
})

describe("every Server Action calls requireLearner() first", () => {
  const actions = readdirSync(join(APP, "actions"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(APP, "actions", f))

  const cases = actions.flatMap((file) => {
    const source = readFileSync(file, "utf8")
    // Each exported function, from its name to the next export.
    return [
      ...source.matchAll(
        /export async function (\w+)([\s\S]*?)(?=\nexport |$(?![\s\S]))/g
      ),
    ].map(([, name, body]) => ({ file: rel(file), name, body }))
  })

  it("finds the actions", () => {
    expect(cases.length).toBeGreaterThan(5)
  })

  it.each(cases)("$file $name", ({ name, body }) => {
    // The one action that cannot: it is how the learner gets a cookie.
    if (name === "unlock") return
    const first = body.match(/await\s+([\w.]+)\(/)?.[1]
    expect(first).toBe("requireLearner")
  })
})
