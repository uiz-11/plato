import type { AuthConfig } from "./session"

export const MIN_PASSCODE_LENGTH = 20

/**
 * The passcode gate's settings from the environment (§8.5, §12.1).
 *
 * - Production requires `PLATO_PASSCODE` (at least 20 characters) and
 *   `PLATO_COOKIE_SECRET`.
 * - Development with neither set turns the gate off (returns null).
 * - Setting one in development requires the other, with the same rules.
 *
 * Throws with a message naming what is wrong.
 */
export function readAuthConfig(
  env: Record<string, string | undefined> = process.env
): AuthConfig | null {
  const passcode = env.PLATO_PASSCODE ?? ""
  const secret = env.PLATO_COOKIE_SECRET ?? ""
  const production = env.NODE_ENV === "production"
  if (!production && !passcode && !secret) return null

  const problems: string[] = []
  if (!passcode) problems.push("PLATO_PASSCODE is not set")
  else if (passcode.length < MIN_PASSCODE_LENGTH)
    problems.push(
      `PLATO_PASSCODE must be at least ${MIN_PASSCODE_LENGTH} characters`
    )
  if (!secret) problems.push("PLATO_COOKIE_SECRET is not set")
  if (problems.length) throw new Error(problems.join("; "))
  return { passcode, secret }
}

/**
 * Start-up check (instrumentation.ts). The server refuses to start with a
 * missing or short passcode rather than serving an open or broken gate.
 */
export function checkAuthConfigOrExit(): void {
  try {
    readAuthConfig()
  } catch (error) {
    console.error(
      "Auth configuration is invalid:",
      error instanceof Error ? error.message : error
    )
    process.exit(1)
  }
}
