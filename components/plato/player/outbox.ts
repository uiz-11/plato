import type { EventResult } from "@/lib/engine/player"

// The player's outbox (§8.4): events are sent one at a time, in order. A send
// that never arrived (the action call rejected) is retried with the same
// payload before any later event is sent; after three failures in a row the
// frame shows "Saving…" and the outbox keeps retrying. An answer the server
// will never accept (stale or refused) drops what is queued, because the
// client's idea of the position is wrong, and asks for the true state.
//
// Plain TypeScript, so it is tested without a browser.

/** Failures in a row before the frame shows "Saving…". */
export const SAVING_AFTER_FAILURES = 3
const MAX_BACKOFF_MS = 10_000

export interface OutboxOptions<P> {
  send: (payload: P) => Promise<EventResult>
  /** The server will not apply what was sent: load the true state. */
  onRejected: (result: Extract<EventResult, { ok: false }>) => void
  /** Whether to show "Saving…". */
  onSaving: (saving: boolean) => void
  /**
   * Errors that must not be retried because Next handles them, such as the
   * redirect to /unlock when the cookie has expired. The outbox stops.
   */
  isFatal?: (error: unknown) => boolean
  /** Waits between retries; replaced in tests. */
  sleep?: (ms: number) => Promise<void>
}

interface Item<P> {
  payload: P
  /** Called once the server has applied the event. */
  onSent?: () => void
}

export class Outbox<P> {
  private queue: Item<P>[] = []
  private running = false
  private waiters: (() => void)[] = []
  private failures = 0
  /** Set by a fatal error: nothing more is sent. */
  private halted = false
  /** Bumped by every stale or refused answer, so `finish` can tell. */
  rejectedCount = 0

  constructor(private readonly opts: OutboxOptions<P>) {}

  /** Queues an event; it is sent after every earlier one. */
  push(payload: P, onSent?: () => void): void {
    if (this.halted) return
    this.queue.push({ payload, onSent })
    void this.pump()
  }

  /**
   * Waits for the queue, then tells whether everything in it was applied:
   * false when the server rejected an event meanwhile (the page is already
   * reloading), so a unit's last event is not sent from a wrong position.
   */
  async drainClean(): Promise<boolean> {
    const before = this.rejectedCount
    await this.drain()
    return this.rejectedCount === before
  }

  /** Resolves once everything queued so far has been sent (or dropped). */
  drain(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  /**
   * Sends one call now, after the queue has drained, retrying it like a
   * queued event. For `finishUnit` and `exitSession`, which wait for the
   * outbox. A fatal error is thrown, for Next to handle.
   */
  async sendNow<R>(send: () => Promise<R>): Promise<R> {
    await this.drain()
    for (;;) {
      try {
        const result = await send()
        this.succeeded()
        return result
      } catch (error) {
        if (this.opts.isFatal?.(error)) {
          this.halt()
          throw error
        }
        await this.failed()
      }
    }
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    while (this.queue.length > 0 && !this.halted) {
      const item = this.queue[0]
      try {
        const result = await this.opts.send(item.payload)
        this.queue.shift()
        this.succeeded()
        if (result.ok) {
          item.onSent?.()
        } else {
          this.queue = []
          this.rejectedCount += 1
          this.opts.onRejected(result)
        }
      } catch (error) {
        if (this.opts.isFatal?.(error)) this.halt()
        else await this.failed()
      }
    }
    this.running = false
    for (const resolve of this.waiters.splice(0)) resolve()
  }

  private halt() {
    this.halted = true
    this.queue = []
  }

  private succeeded() {
    if (this.failures >= SAVING_AFTER_FAILURES) this.opts.onSaving(false)
    this.failures = 0
  }

  private async failed() {
    this.failures += 1
    if (this.failures === SAVING_AFTER_FAILURES) this.opts.onSaving(true)
    const wait = Math.min(MAX_BACKOFF_MS, 500 * 2 ** (this.failures - 1))
    await (this.opts.sleep ?? defaultSleep)(wait)
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))
