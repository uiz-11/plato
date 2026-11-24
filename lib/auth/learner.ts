import "server-only"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { readAuthConfig } from "./config"
import { isAuthorized, SESSION_COOKIE } from "./session"

/** Whether the current request is the learner's (cookie or bearer passcode). */
export async function isLearner(): Promise<boolean> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
  return isAuthorized(
    {
      cookie: cookieStore.get(SESSION_COOKIE)?.value,
      authorization: headerList.get("authorization"),
    },
    readAuthConfig(),
    // Wall-clock time, as in proxy.ts: the test clock moves learning days,
    // not cookie expiry.
    Date.now()
  )
}

/**
 * The real gate (§8.5): every DAL function and Server Action calls this first.
 * `proxy.ts` only redirects early. Without a valid cookie or bearer passcode it
 * redirects to /unlock, which ends the render or the action.
 */
export async function requireLearner(): Promise<void> {
  if (!(await isLearner())) redirect("/unlock")
}
