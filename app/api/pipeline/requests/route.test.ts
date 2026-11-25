import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { clearContentCache } from "@/lib/content/load"
import type { Db } from "@/lib/db/client"
import { courseRequest } from "@/lib/db/schema"
import { draftContent, lockGate, setupDal } from "@/test/dal"

import { GET } from "./route"

// The pipeline export (§11.1): only open requests, and only with the bearer
// passcode when the gate is on.

// `requireLearner()` reads the same request's headers through next/headers.
const incoming = vi.hoisted(() => ({ headers: new Headers() }))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => incoming.headers,
}))

const PASSCODE = "a-test-passcode-of-enough-length"
const OPEN = "11111111-1111-4111-8111-111111111111"
const NEWER = "22222222-2222-4222-8222-222222222222"
const PUBLISHED = "33333333-3333-4333-8333-333333333333"
const NOT_BUILT = "44444444-4444-4444-8444-444444444444"
const AT = Date.parse("2026-11-24T10:00:00Z")

let db: Db
let close: () => void
beforeEach(() => {
  ;({ db, close } = setupDal())
  incoming.headers = new Headers()
})
afterEach(() => close())

function call(headers: Record<string, string> = {}) {
  incoming.headers = new Headers(headers)
  return GET(
    new Request("http://plato.test/api/pipeline/requests", { headers })
  )
}

function seed() {
  db.insert(courseRequest)
    .values([
      { id: NEWER, text: "Newer request text", createdAt: AT + 1000 },
      { id: OPEN, text: "Older request text", createdAt: AT },
      { id: PUBLISHED, text: "Already built", createdAt: AT - 1000 },
      { id: NOT_BUILT, text: "Reset my password", createdAt: AT - 2000 },
    ])
    .run()
  const root = draftContent()
  writeFileSync(
    join(root, "published.json"),
    JSON.stringify({
      courses: [
        {
          id: "leap-years",
          requestId: PUBLISHED,
          publishedAt: "2026-11-23T00:00:00Z",
        },
      ],
    })
  )
  writeFileSync(
    join(root, "not-built.json"),
    JSON.stringify([
      {
        requestId: NOT_BUILT,
        reason: "A support request, not a topic to learn",
        decidedAt: "2026-11-24T00:00:00Z",
      },
    ])
  )
  vi.stubEnv("PLATO_CONTENT_DIR", root)
  clearContentCache()
}

describe("GET /api/pipeline/requests", () => {
  it("returns open requests only, oldest first", async () => {
    seed()
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual([
      {
        id: OPEN,
        text: "Older request text",
        createdAt: "2026-11-24T10:00:00.000Z",
      },
      {
        id: NEWER,
        text: "Newer request text",
        createdAt: "2026-11-24T10:00:01.000Z",
      },
    ])
  })

  it("returns an empty list with no requests", async () => {
    expect(await (await call()).json()).toEqual([])
  })

  describe("with the gate on", () => {
    beforeEach(() => {
      lockGate()
      seed()
    })

    it("accepts the passcode as a bearer token", async () => {
      const res = await call({ Authorization: `Bearer ${PASSCODE}` })
      expect(res.status).toBe(200)
      expect((await res.json()).map((r: { id: string }) => r.id)).toEqual([
        OPEN,
        NEWER,
      ])
    })

    it.each([
      ["no header", {}],
      ["a wrong passcode", { Authorization: "Bearer not-the-passcode" }],
      ["another scheme", { Authorization: `Basic ${PASSCODE}` }],
      ["a cookie only", { Cookie: "plato_session=anything" }],
    ])("refuses %s with 401", async (_, headers) => {
      const res = await call(headers)
      expect(res.status).toBe(401)
      expect(res.headers.get("www-authenticate")).toBe("Bearer")
      expect(res.headers.get("cache-control")).toBe("no-store")
      expect(await res.json()).not.toBeInstanceOf(Array)
    })
  })
})
