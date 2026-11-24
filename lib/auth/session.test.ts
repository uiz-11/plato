import { describe, expect, it } from "vitest"

import {
  bearerToken,
  isAuthorized,
  passcodeMatches,
  safeNextPath,
  signSession,
  verifySession,
} from "./session"

const SECRET = "test-cookie-secret"
const NOW = 1_700_000_000_000
const config = { passcode: "a-passcode-of-twenty-plus", secret: SECRET }

describe("session cookie signing", () => {
  it("verifies a cookie it signed until it expires", () => {
    const value = signSession(NOW + 1000, SECRET)
    expect(value).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/)
    expect(verifySession(value, SECRET, NOW)).toBe(true)
    expect(verifySession(value, SECRET, NOW + 999)).toBe(true)
    expect(verifySession(value, SECRET, NOW + 1000)).toBe(false)
  })

  it("rejects a cookie signed with another secret", () => {
    const value = signSession(NOW + 1000, "another-secret")
    expect(verifySession(value, SECRET, NOW)).toBe(false)
  })

  it("rejects a cookie whose expiry was changed", () => {
    const [, sig] = signSession(NOW + 1000, SECRET).split(".")
    expect(verifySession(`${NOW + 10_000_000}.${sig}`, SECRET, NOW)).toBe(false)
  })

  it.each([
    undefined,
    "",
    "garbage",
    `${NOW + 1000}`,
    `${NOW + 1000}.`,
    `abc.${"a".repeat(43)}`,
    `${NOW + 1000}.${"a".repeat(42)}`,
    `${NOW + 1000}.${"a".repeat(43)}`,
    `99999999999999999.${"a".repeat(43)}`,
  ])("rejects the malformed value %j", (value) => {
    expect(verifySession(value, SECRET, NOW)).toBe(false)
  })

  it("refuses to sign a bad expiry", () => {
    expect(() => signSession(1.5, SECRET)).toThrow()
    expect(() => signSession(-1, SECRET)).toThrow()
  })
})

describe("passcodeMatches", () => {
  it("matches only the exact passcode", () => {
    expect(passcodeMatches(config.passcode, config.passcode)).toBe(true)
    expect(passcodeMatches(config.passcode + " ", config.passcode)).toBe(false)
    expect(passcodeMatches("short", config.passcode)).toBe(false)
    expect(passcodeMatches("", config.passcode)).toBe(false)
  })
})

describe("bearerToken", () => {
  it.each([
    ["Bearer abc", "abc"],
    ["bearer abc", "abc"],
    ["Bearer a passphrase with spaces", "a passphrase with spaces"],
    ["Bearer", null],
    ["Bearer ", null],
    ["Basic abc", null],
    [null, null],
    [undefined, null],
  ])("reads %j as %j", (header, token) => {
    expect(bearerToken(header)).toBe(token)
  })
})

describe("isAuthorized", () => {
  it("lets everything through when the gate is off", () => {
    expect(isAuthorized({}, null, NOW)).toBe(true)
  })

  it("accepts a valid cookie", () => {
    const cookie = signSession(NOW + 1000, SECRET)
    expect(isAuthorized({ cookie }, config, NOW)).toBe(true)
  })

  it("accepts the passcode as a bearer token", () => {
    const authorization = `Bearer ${config.passcode}`
    expect(isAuthorized({ authorization }, config, NOW)).toBe(true)
  })

  it("refuses no credentials, a wrong bearer token or an expired cookie", () => {
    expect(isAuthorized({}, config, NOW)).toBe(false)
    expect(isAuthorized({ authorization: "Bearer wrong" }, config, NOW)).toBe(
      false
    )
    const cookie = signSession(NOW - 1, SECRET)
    expect(isAuthorized({ cookie }, config, NOW)).toBe(false)
    // The secret is not a bearer token.
    expect(
      isAuthorized({ authorization: `Bearer ${SECRET}` }, config, NOW)
    ).toBe(false)
  })
})

describe("safeNextPath", () => {
  it.each([
    ["/", "/"],
    ["/library", "/library"],
    ["/courses/x/syllabus?tab=1", "/courses/x/syllabus?tab=1"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/\t/evil.example", "/"],
    ["/\n/evil.example", "/"],
    ["/\r/evil.example", "/"],
    ["/x\u0000", "/"],
    ["/.//evil.example", "/"],
    ["/..//evil.example", "/"],
    ["/a/..//evil.example", "/"],
    ["/%2e//evil.example", "/"],
    ["/%2e%2e//evil.example/x?y", "/"],
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
    ["/a/../library", "/library"],
    ["/library#top", "/library#top"],
    ["/unlock/", "/"],
    ["https://evil.example", "/"],
    ["library", "/"],
    ["/unlock", "/"],
    ["/unlock?next=/", "/"],
    [undefined, "/"],
    [null, "/"],
  ])("maps %j to %j", (next, path) => {
    expect(safeNextPath(next)).toBe(path)
  })
})
