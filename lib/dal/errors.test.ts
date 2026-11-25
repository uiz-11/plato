import { describe, expect, it } from "vitest"

import { DalError, isTransientDbError } from "./errors"

const sqlite = (code: string) => Object.assign(new Error(code), { code })

describe("isTransientDbError", () => {
  it.each([
    ["SQLITE_BUSY", true],
    ["SQLITE_BUSY_SNAPSHOT", true],
    ["SQLITE_LOCKED", true],
    ["SQLITE_IOERR_WRITE", true],
    ["SQLITE_FULL", true],
    ["SQLITE_CONSTRAINT_PRIMARYKEY", false],
    ["SQLITE_ERROR", false],
  ])("%s → %s", (code, want) => {
    expect(isTransientDbError(sqlite(code))).toBe(want)
  })

  it("is false for anything else", () => {
    expect(isTransientDbError(new DalError("bad_event", "x"))).toBe(false)
    expect(isTransientDbError(new Error("x"))).toBe(false)
    expect(isTransientDbError(null)).toBe(false)
    expect(isTransientDbError({ code: 5 })).toBe(false)
  })
})
