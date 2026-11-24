import { afterEach, describe, expect, it, vi } from "vitest"

import { clockOffsetDays, DAY_MS, now, setClockOffsetDays } from "./clock"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  delete (globalThis as { __platoClockOffsetMs?: number }).__platoClockOffsetMs
})

describe("clock", () => {
  it("returns the real time without test hooks", () => {
    vi.stubEnv("PLATO_TEST_HOOKS", "")
    vi.useFakeTimers({ now: 1_000_000 })
    expect(now()).toBe(1_000_000)
    expect(() => setClockOffsetDays(1)).toThrow(/Test hooks/)
  })

  it("moves now() by the test offset", () => {
    vi.stubEnv("PLATO_TEST_HOOKS", "1")
    vi.useFakeTimers({ now: 1_000_000 })
    setClockOffsetDays(2)
    expect(now()).toBe(1_000_000 + 2 * DAY_MS)
    expect(clockOffsetDays()).toBe(2)
    // Setting replaces the offset rather than adding to it.
    setClockOffsetDays(1)
    expect(now()).toBe(1_000_000 + DAY_MS)
  })

  it("ignores a leftover offset once test hooks are off", () => {
    vi.stubEnv("PLATO_TEST_HOOKS", "1")
    vi.useFakeTimers({ now: 1_000_000 })
    setClockOffsetDays(3)
    vi.stubEnv("PLATO_TEST_HOOKS", "")
    expect(now()).toBe(1_000_000)
  })
})
