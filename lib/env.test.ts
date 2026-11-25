import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { checkEnvOrExit, startupProblems, startupWarnings } from "./env"

let dir: string
let content: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "plato-env-"))
  content = join(dir, "content")
  mkdirSync(content)
  writeFileSync(join(content, "published.json"), '{ "courses": [] }')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const production = () => ({
  NODE_ENV: "production",
  PLATO_DB_PATH: join(dir, "data", "plato.db"),
  PLATO_PASSCODE: "a-passcode-of-twenty-plus",
  PLATO_COOKIE_SECRET: "a-cookie-secret",
  PLATO_CONTENT_DIR: content,
})

describe("startupProblems", () => {
  it("passes a complete production environment", () => {
    expect(startupProblems(production())).toEqual([])
    expect(
      startupProblems({ ...production(), PLATO_TIME_ZONE: "Europe/Berlin" })
    ).toEqual([])
  })

  it("passes development with nothing set but content", () => {
    expect(
      startupProblems({ NODE_ENV: "development", PLATO_CONTENT_DIR: content })
    ).toEqual([])
  })

  it("reports every problem at once", () => {
    expect(
      startupProblems({
        NODE_ENV: "production",
        PLATO_PASSCODE: "short",
        PLATO_TIME_ZONE: "Mars/Olympus",
        PLATO_CONTENT_DIR: join(dir, "nowhere"),
      })
    ).toEqual([
      "PLATO_PASSCODE must be at least 20 characters; PLATO_COOKIE_SECRET is not set",
      'PLATO_TIME_ZONE is not a known time zone: "Mars/Olympus"',
      "PLATO_DB_PATH is not set",
      `PLATO_CONTENT_DIR has no published.json: ${join(dir, "nowhere")}`,
    ])
  })

  it("requires an absolute database path in production", () => {
    expect(
      startupProblems({ ...production(), PLATO_DB_PATH: "plato.db" })
    ).toEqual(['PLATO_DB_PATH must be an absolute path, got "plato.db"'])
  })
})

describe("startupWarnings", () => {
  it("warns in production when the database is not on a mounted volume", () => {
    // A temp directory is on the same device as its parent.
    mkdirSync(join(dir, "data"))
    const [warning] = startupWarnings(production())
    expect(warning).toMatch(/not on its own mounted volume/)
    expect(warning).toContain(join(dir, "data"))
  })

  it("says nothing outside production or when the path is invalid", () => {
    expect(
      startupWarnings({ ...production(), NODE_ENV: "development" })
    ).toEqual([])
    expect(startupWarnings({ NODE_ENV: "production" })).toEqual([])
  })
})

describe("checkEnvOrExit", () => {
  it("exits with the problems listed", () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never)
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    checkEnvOrExit({ ...production(), PLATO_COOKIE_SECRET: "" })
    expect(exit).toHaveBeenCalledWith(1)
    expect(error.mock.calls[0][0]).toMatch(
      /Plato cannot start[\s\S]*- PLATO_COOKIE_SECRET is not set/
    )
  })

  it("returns when the environment is valid", () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    checkEnvOrExit(production())
    expect(exit).not.toHaveBeenCalled()
  })
})
