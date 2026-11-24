"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { readAuthConfig } from "@/lib/auth/config"
import {
  passcodeMatches,
  safeNextPath,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  signSession,
} from "@/lib/auth/session"

export type UnlockState = { error: string | null }

// Long enough for any real passcode; refuses absurd bodies before hashing.
const MAX_PASSCODE_INPUT = 1024

/**
 * The one action that does not call `requireLearner()`: it is how the learner
 * gets the cookie (§8.5).
 */
export async function unlock(
  _prev: UnlockState,
  formData: FormData
): Promise<UnlockState> {
  const config = readAuthConfig()
  const next = safeNextPath(formData.get("next"))
  if (!config) redirect(next)

  const passcode = formData.get("passcode")
  if (typeof passcode !== "string" || passcode.length === 0)
    return { error: "Enter your passcode." }
  if (
    passcode.length > MAX_PASSCODE_INPUT ||
    !passcodeMatches(passcode, config.passcode)
  )
    return { error: "That passcode isn't right." }

  const cookieStore = await cookies()
  cookieStore.set(
    SESSION_COOKIE,
    signSession(Date.now() + SESSION_MAX_AGE_S * 1000, config.secret),
    {
      httpOnly: true,
      // Production is served over HTTPS. Development may be plain HTTP, where
      // some browsers drop Secure cookies even on localhost.
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_S,
    }
  )
  redirect(next)
}
