import "server-only"

import { existsSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { readAuthConfig } from "./auth/config"
import { timeZone } from "./clock"
import { contentRoot } from "./content/load"
import { dbPath } from "./db/client"

type Env = Record<string, string | undefined>

/**
 * Everything in the environment (§12.1) that would stop the server from
 * working, as one message each. Empty when the server can start.
 */
export function startupProblems(env: Env = process.env): string[] {
  const problems: string[] = []
  const check = (fn: () => unknown) => {
    try {
      fn()
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }
  check(() => readAuthConfig(env))
  check(() => timeZone(env))
  check(() => dbPath(env))
  const content = contentRoot(env)
  if (!existsSync(join(content, "published.json")))
    problems.push(
      `PLATO_CONTENT_DIR has no published.json: ${content}` +
        (env.PLATO_CONTENT_DIR ? "" : " (the default)")
    )
  return problems
}

/**
 * Settings that work but are probably a mistake in production. The database
 * on a path that is not a mounted volume is lost when the container is
 * replaced (§12.2).
 */
export function startupWarnings(env: Env = process.env): string[] {
  if (env.NODE_ENV !== "production") return []
  let path: string
  try {
    path = resolve(dbPath(env))
  } catch {
    return [] // reported by startupProblems
  }
  const dir = dirname(path)
  if (!existsSync(dir) || !isMountPoint(dir))
    return [
      `PLATO_DB_PATH (${path}) is not on its own mounted volume, so it is lost when the container is replaced. Mount a persistent volume at ${dir}.`,
    ]
  return []
}

/** A directory on a different device from its parent is a mount point. */
function isMountPoint(dir: string): boolean {
  const parent = dirname(dir)
  if (parent === dir) return true // the root itself
  return statSync(dir).dev !== statSync(parent).dev
}

/**
 * Start-up check (instrumentation.ts). Reports every problem at once and
 * refuses to start rather than serving an open gate or failing every request.
 */
export function checkEnvOrExit(env: Env = process.env): void {
  for (const warning of startupWarnings(env))
    console.warn(`Warning: ${warning}`)
  const problems = startupProblems(env)
  if (!problems.length) return
  console.error(
    `Plato cannot start: the environment is invalid (§12.1).\n${problems
      .map((p) => `  - ${p}`)
      .join("\n")}`
  )
  process.exit(1)
}
