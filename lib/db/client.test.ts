import { afterEach, describe, expect, it, vi } from "vitest"

import { dbPath } from "./client"

afterEach(() => vi.unstubAllEnvs())

describe("dbPath", () => {
  it("requires PLATO_DB_PATH in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PLATO_DB_PATH", "")
    expect(() => dbPath()).toThrow(/PLATO_DB_PATH is not set/)
  })

  it("requires an absolute path in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PLATO_DB_PATH", "plato.db")
    expect(() => dbPath()).toThrow(/absolute/)
    vi.stubEnv("PLATO_DB_PATH", "/data/plato.db")
    expect(dbPath()).toBe("/data/plato.db")
  })

  it("defaults to plato.db in development", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("PLATO_DB_PATH", "")
    expect(dbPath()).toBe("plato.db")
    vi.stubEnv("PLATO_DB_PATH", "dev/x.db")
    expect(dbPath()).toBe("dev/x.db")
  })
})
