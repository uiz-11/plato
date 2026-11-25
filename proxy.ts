import { NextResponse, type NextRequest } from "next/server"

import { readAuthConfig } from "@/lib/auth/config"
import { isAuthorized, SESSION_COOKIE } from "@/lib/auth/session"

// Optimistic gate (§4, §8.5): send a visitor without a valid cookie to /unlock
// before anything renders. It is not the security boundary: `requireLearner()`
// checks again in every DAL function and Server Action.
export function proxy(request: NextRequest) {
  // A Server Action is a POST that expects an action response. Redirecting it
  // here would hand the client an HTML page it cannot read, so the form shows
  // a failure instead of /unlock. `requireLearner()` refuses it and redirects
  // in a way the client follows.
  if (request.method === "POST" && request.headers.has("next-action"))
    return NextResponse.next()

  const authorized = isAuthorized(
    {
      cookie: request.cookies.get(SESSION_COOKIE)?.value,
      authorization: request.headers.get("authorization"),
    },
    readAuthConfig(),
    Date.now()
  )
  if (authorized) return NextResponse.next()

  const url = request.nextUrl.clone()
  const next = url.pathname + url.search
  url.pathname = "/unlock"
  url.search = next === "/" ? "" : `?next=${encodeURIComponent(next)}`
  return NextResponse.redirect(url)
}

export const config = {
  // Everything except /unlock, Next's static files and image optimizer, the
  // favicon, and /api/* (Route Handlers authenticate themselves).
  matcher: [
    "/((?!unlock$|unlock/|api$|api/|_next/static/|_next/image$|_next/image/|favicon\\.ico$).*)",
  ],
}
