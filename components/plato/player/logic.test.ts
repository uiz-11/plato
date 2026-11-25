import { describe, expect, it, vi } from "vitest"

import { chooseDraft, exclusiveRunner } from "./logic"

describe("chooseDraft", () => {
  const draft = (text: string, updatedAt: number) => ({
    key: "recall:c:l",
    text,
    updatedAt,
  })

  it.each([
    ["neither", null, null, null],
    ["only local", draft("a", 1), null, "a"],
    ["only server", null, draft("b", 1), "b"],
    ["a newer local copy", draft("a", 2), draft("b", 1), "a"],
    ["an older local copy", draft("a", 1), draft("b", 2), "b"],
    // Same time: the server's copy is what this local one became.
    ["copies from the same moment", draft("a", 1), draft("b", 1), "b"],
  ])("%s", (_, local, server, want) => {
    expect(chooseDraft(local, server)?.text ?? null).toBe(want)
  })
})

describe("exclusiveRunner", () => {
  it("drops a call made while another runs", async () => {
    const onBusy = vi.fn()
    const run = exclusiveRunner(onBusy)
    let release!: () => void
    const first = run(() => new Promise<void>((r) => (release = r)))
    const second = vi.fn(async () => {})
    expect(await run(second)).toBe(false)
    expect(second).not.toHaveBeenCalled()
    release()
    expect(await first).toBe(true)
    expect(onBusy.mock.calls).toEqual([[true], [false]])
    // Free again once the first is done.
    expect(await run(second)).toBe(true)
    expect(second).toHaveBeenCalledOnce()
  })

  it("frees itself when a task throws", async () => {
    const run = exclusiveRunner(() => {})
    await expect(
      run(async () => {
        throw new Error("redirect")
      })
    ).rejects.toThrow("redirect")
    expect(await run(async () => {})).toBe(true)
  })
})
