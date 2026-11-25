import { describe, expect, it, vi } from "vitest"

import type { EventResult } from "@/lib/engine/player"

import { Outbox, SAVING_AFTER_FAILURES } from "./outbox"

const ok: EventResult = { ok: true }

class Redirect extends Error {}

function setup(
  send: (p: number) => Promise<EventResult>,
  sleep = () => Promise.resolve()
) {
  const onRejected = vi.fn()
  const onSaving = vi.fn()
  const box = new Outbox<number>({
    send,
    onRejected,
    onSaving,
    sleep,
    isFatal: (e) => e instanceof Redirect,
  })
  return { box, onRejected, onSaving }
}

describe("Outbox", () => {
  it("sends one at a time, in order", async () => {
    const seen: number[] = []
    let inFlight = 0
    const { box } = setup(async (p) => {
      inFlight++
      expect(inFlight).toBe(1)
      await Promise.resolve()
      seen.push(p)
      inFlight--
      return ok
    })
    box.push(1)
    box.push(2)
    box.push(3)
    await box.drain()
    expect(seen).toEqual([1, 2, 3])
  })

  it("retries a failed send with the same payload before later ones", async () => {
    const seen: number[] = []
    let fail = SAVING_AFTER_FAILURES
    const { box, onSaving } = setup(async (p) => {
      seen.push(p)
      if (p === 1 && fail-- > 0) throw new Error("offline")
      return ok
    })
    box.push(1)
    box.push(2)
    await box.drain()
    expect(seen).toEqual([1, 1, 1, 1, 2])
    // "Saving…" after three failures, cleared by the next success.
    expect(onSaving.mock.calls).toEqual([[true], [false]])
  })

  it("does not show Saving… for fewer than three failures", async () => {
    let fail = SAVING_AFTER_FAILURES - 1
    const { box, onSaving } = setup(async () => {
      if (fail-- > 0) throw new Error("offline")
      return ok
    })
    box.push(1)
    await box.drain()
    expect(onSaving).not.toHaveBeenCalled()
  })

  it("drops the queue on a stale answer and asks for the true state", async () => {
    const seen: number[] = []
    const { box, onRejected } = setup(async (p) => {
      seen.push(p)
      return p === 1 ? { ok: false, stale: true } : ok
    })
    box.push(1)
    box.push(2)
    await box.drain()
    expect(seen).toEqual([1])
    expect(onRejected).toHaveBeenCalledWith({ ok: false, stale: true })
    expect(box.rejectedCount).toBe(1)
  })

  it("drops the queue on a refusal instead of retrying it", async () => {
    const seen: number[] = []
    const { box, onRejected, onSaving } = setup(async (p) => {
      seen.push(p)
      return p === 1 ? { ok: false, refused: true } : ok
    })
    box.push(1)
    box.push(2)
    await box.drain()
    expect(seen).toEqual([1])
    expect(onRejected).toHaveBeenCalledWith({ ok: false, refused: true })
    expect(onSaving).not.toHaveBeenCalled()
  })

  it("stops on Next's own errors, such as the redirect to /unlock", async () => {
    const seen: number[] = []
    const { box, onRejected } = setup(async (p) => {
      seen.push(p)
      throw new Redirect()
    })
    box.push(1)
    box.push(2)
    await box.drain()
    expect(seen).toEqual([1])
    expect(onRejected).not.toHaveBeenCalled()
    // Nothing more is sent, and a finish rethrows for Next to handle.
    box.push(3)
    await box.drain()
    expect(seen).toEqual([1])
    await expect(
      box.sendNow(async () => {
        throw new Redirect()
      })
    ).rejects.toBeInstanceOf(Redirect)
  })

  it("tells the caller once an event is applied, and not when it is rejected", async () => {
    const { box } = setup(async (p) =>
      p === 2 ? { ok: false, stale: true } : ok
    )
    const sent = vi.fn()
    const notSent = vi.fn()
    box.push(1, sent)
    box.push(2, notSent)
    await box.drain()
    expect(sent).toHaveBeenCalledOnce()
    expect(notSent).not.toHaveBeenCalled()
  })

  it("sends a unit's last event only after the queue drains", async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { box } = setup(async (p) => {
      await gate
      order.push(`event ${p}`)
      return ok
    })
    box.push(1)
    const done = box.sendNow(async () => {
      order.push("finish")
      return "done"
    })
    release()
    expect(await done).toBe("done")
    expect(order).toEqual(["event 1", "finish"])
  })

  it("drainClean says whether a rejection happened while it waited", async () => {
    const { box } = setup(async (p) =>
      p === 2 ? { ok: false, stale: true } : ok
    )
    box.push(1)
    expect(await box.drainClean()).toBe(true)
    box.push(2)
    expect(await box.drainClean()).toBe(false)
    // An old rejection does not count against a later wait.
    box.push(3)
    expect(await box.drainClean()).toBe(true)
  })

  it("drains at once when nothing is queued", async () => {
    const { box } = setup(async () => ok)
    await expect(box.drain()).resolves.toBeUndefined()
  })
})
