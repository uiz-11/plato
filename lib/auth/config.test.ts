import { describe, expect, it } from "vitest"

import { readAuthConfig } from "./config"

const passcode = "a-passcode-of-twenty-plus"
const secret = "a-cookie-secret"

describe("readAuthConfig", () => {
  it("turns the gate off in development with nothing set", () => {
    expect(readAuthConfig({ NODE_ENV: "development" })).toBeNull()
    expect(readAuthConfig({ NODE_ENV: "test" })).toBeNull()
  })

  it("returns both values when they are valid", () => {
    for (const NODE_ENV of ["production", "development"])
      expect(
        readAuthConfig({
          NODE_ENV,
          PLATO_PASSCODE: passcode,
          PLATO_COOKIE_SECRET: secret,
        })
      ).toEqual({ passcode, secret })
  })

  it("requires both in production", () => {
    expect(() => readAuthConfig({ NODE_ENV: "production" })).toThrow(
      "PLATO_PASSCODE is not set; PLATO_COOKIE_SECRET is not set"
    )
    expect(() =>
      readAuthConfig({ NODE_ENV: "production", PLATO_PASSCODE: passcode })
    ).toThrow("PLATO_COOKIE_SECRET is not set")
    expect(() =>
      readAuthConfig({ NODE_ENV: "production", PLATO_COOKIE_SECRET: secret })
    ).toThrow("PLATO_PASSCODE is not set")
  })

  it("refuses a passcode shorter than 20 characters", () => {
    expect(() =>
      readAuthConfig({
        NODE_ENV: "production",
        PLATO_PASSCODE: "x".repeat(19),
        PLATO_COOKIE_SECRET: secret,
      })
    ).toThrow(/at least 20 characters/)
    expect(
      readAuthConfig({
        NODE_ENV: "production",
        PLATO_PASSCODE: "x".repeat(20),
        PLATO_COOKIE_SECRET: secret,
      })
    ).not.toBeNull()
  })

  it("requires the pair in development once either is set", () => {
    expect(() =>
      readAuthConfig({ NODE_ENV: "development", PLATO_PASSCODE: passcode })
    ).toThrow("PLATO_COOKIE_SECRET is not set")
    expect(() =>
      readAuthConfig({ NODE_ENV: "development", PLATO_COOKIE_SECRET: secret })
    ).toThrow("PLATO_PASSCODE is not set")
  })
})
