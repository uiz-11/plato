import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NextRequest } from "next/server"

import { config, proxy } from "./proxy"

// The matcher decides what the early redirect covers (§4).
describe("proxy matcher", () => {
  it.each([
    ["/", true],
    ["/library", true],
    ["/courses/x/syllabus", true],
    ["/session/abc", true],
    ["/unlocked", true],
    ["/apiary", true],
    ["/favicon.icox", true],
    ["/_next/staticfoo", true],
    ["/_next/imagefoo", true],
    ["/unlock", false],
    ["/api/pipeline/requests", false],
    ["/api/test/clock", false],
    ["/_next/static/chunks/main.js", false],
    ["/_next/image?url=x", false],
    ["/favicon.ico", false],
  ])("%s → runs: %s", (url, runs) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(runs)
  })
})

describe("proxy", () => {
  beforeEach(() => {
    vi.stubEnv("PLATO_PASSCODE", "a-test-passcode-of-enough-length")
    vi.stubEnv("PLATO_COOKIE_SECRET", "a-test-secret")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("redirects a page request without a cookie to /unlock", () => {
    const res = proxy(new NextRequest("http://x.test/library"))
    expect(res.headers.get("location")).toBe(
      "http://x.test/unlock?next=%2Flibrary"
    )
  })

  it("still redirects a GET that sends the action header", () => {
    const res = proxy(
      new NextRequest("http://x.test/library", {
        headers: { "next-action": "abc" },
      })
    )
    expect(res.headers.get("location")).toBe(
      "http://x.test/unlock?next=%2Flibrary"
    )
  })

  it("lets a Server Action through for requireLearner() to refuse", () => {
    const res = proxy(
      new NextRequest("http://x.test/new", {
        method: "POST",
        headers: { "next-action": "abc" },
      })
    )
    expect(res.headers.get("location")).toBeNull()
    expect(res.status).toBeLessThan(300)
  })
})
