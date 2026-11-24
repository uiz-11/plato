import { notFound } from "next/navigation"

import { clockOffsetDays, now, setClockOffsetDays } from "@/lib/clock"
import { testHooksEnabled } from "@/lib/test-hooks"

// Test hooks only (§10.1): moves `now()` so an e2e test can reach the next day.
// `{ days }` sets the offset from the real clock; it does not add to it.

// Ten years either way covers any journey and keeps `now()` a safe integer.
const MAX_DAYS = 3650

function state() {
  return Response.json({ days: clockOffsetDays(), now: now() })
}

export function GET() {
  if (!testHooksEnabled()) notFound()
  return state()
}

export async function POST(request: Request) {
  if (!testHooksEnabled()) notFound()
  const body: unknown = await request.json().catch(() => null)
  const days =
    typeof body === "object" && body !== null && "days" in body
      ? body.days
      : undefined
  if (
    typeof days !== "number" ||
    !Number.isFinite(days) ||
    Math.abs(days) > MAX_DAYS
  )
    return Response.json(
      { error: `Expected { days: number } with |days| <= ${MAX_DAYS}` },
      { status: 400 }
    )
  setClockOffsetDays(days)
  return state()
}
