import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { describe, expect, it } from "vitest"

import { config } from "./proxy"

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
