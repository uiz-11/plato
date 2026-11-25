import { readAuthConfig } from "@/lib/auth/config"
import { bearerToken, passcodeMatches } from "@/lib/auth/session"
import { listOpenRequests } from "@/lib/dal/pipeline"

// The pipeline export (§11.1): open course requests for `requests:export`.
// The one production Route Handler (D8). It needs the passcode as a bearer
// token; a session cookie alone is not enough, since only the operator's
// script calls it. With the gate off (development, §8.5) it is open too.

export async function GET(request: Request) {
  const config = readAuthConfig()
  if (config) {
    const token = bearerToken(request.headers.get("authorization"))
    if (token === null || !passcodeMatches(token, config.passcode))
      return Response.json(
        { error: "Send Authorization: Bearer <PLATO_PASSCODE>" },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": "Bearer",
            "Cache-Control": "no-store",
          },
        }
      )
  }
  return Response.json(await listOpenRequests(), {
    headers: { "Cache-Control": "no-store" },
  })
}
