import { createHash, createHmac, timingSafeEqual } from "node:crypto"

// The passcode gate's primitives (§8.5). No Next.js or server-only imports, so
// `proxy.ts` can use them.

export const SESSION_COOKIE = "plato_session"
/** The cookie holds an expiry one year out (§8.5). */
export const SESSION_MAX_AGE_S = 365 * 24 * 60 * 60

function mac(expiresAt: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`plato-session.v1.${expiresAt}`)
    .digest("base64url")
}

/** The cookie value: `<expiry ms>.<HMAC of the expiry>`. */
export function signSession(expiresAt: number, secret: string): string {
  if (!Number.isSafeInteger(expiresAt) || expiresAt < 0)
    throw new Error("expiresAt must be a non-negative integer")
  return `${expiresAt}.${mac(expiresAt, secret)}`
}

/** True when `value` was signed with `secret` and has not expired at `now`. */
export function verifySession(
  value: string | undefined,
  secret: string,
  now: number
): boolean {
  if (!value) return false
  const match = /^(\d{1,16})\.([A-Za-z0-9_-]{43})$/.exec(value)
  if (!match) return false
  const expiresAt = Number(match[1])
  if (!Number.isSafeInteger(expiresAt)) return false
  const given = Buffer.from(match[2])
  const expected = Buffer.from(mac(expiresAt, secret))
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return false
  return expiresAt > now
}

/**
 * Compares a submitted passcode with the configured one in constant time.
 * Hashing first gives equal-length inputs, so the length is not leaked either.
 */
export function passcodeMatches(given: string, passcode: string): boolean {
  const a = createHash("sha256").update(given).digest()
  const b = createHash("sha256").update(passcode).digest()
  return timingSafeEqual(a, b)
}

/**
 * Reads `<token>` from an `Authorization: Bearer <token>` header. The token is
 * the rest of the header, so a passphrase with spaces works too.
 */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer (.+)$/i.exec(header ?? "")
  return match ? match[1] : null
}

export type AuthConfig = { passcode: string; secret: string }

/**
 * Whether a request is the learner's: a valid session cookie, or the passcode
 * as a bearer token (scripts, §11.1). `config` null means the gate is off.
 */
export function isAuthorized(
  request: { cookie?: string; authorization?: string | null },
  config: AuthConfig | null,
  now: number
): boolean {
  if (!config) return true
  if (verifySession(request.cookie, config.secret, now)) return true
  const token = bearerToken(request.authorization)
  return token !== null && passcodeMatches(token, config.passcode)
}

/**
 * Where to go after unlocking. Only a local path is accepted, so the form
 * cannot be used to send the learner to another site.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/"
  // Browsers drop tabs and newlines from URLs, so "/\t/evil.example" would
  // become "//evil.example". Control characters are never a valid path.
  if (/[\x00-\x1f\x7f\\]/.test(next)) return "/"
  // Resolve as a browser would and keep only same-origin results.
  const base = "http://plato.invalid"
  let url: URL
  try {
    url = new URL(next, base)
  } catch {
    return "/"
  }
  if (url.origin !== base) return "/"
  // Resolving collapses dot segments, so "/.//evil" comes out as "//evil",
  // which a browser reads as another host. Check the result, not the input.
  const path = url.pathname + url.search + url.hash
  if (path.startsWith("//")) return "/"
  if (url.pathname.replace(/\/+$/, "") === "/unlock") return "/"
  return path
}
