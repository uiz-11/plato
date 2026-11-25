"use client"

import {
  createContext,
  Fragment,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { unstable_rethrow, useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  exitSession,
  finishUnit,
  recordEvent,
  saveDraft,
  undoSkip,
} from "@/app/actions/player"
import { stepOf, type LessonStep } from "@/lib/engine/lesson"
import type {
  EventResult,
  ExpectedPosition,
  PlayerEnvelope,
  PlayerEvent,
} from "@/lib/engine/player"

import { chooseDraft, exclusiveRunner, type DraftCopy } from "./logic"
import { Outbox } from "./outbox"

// What every player screen shares (§8.4): the outbox, the active time, the
// drafts typed so far, and a polite live region (WF-J).

export type { DraftCopy }

interface PlayerRuntime {
  sessionId: string
  /** Active time so far, in ms: counted only while the tab is visible. */
  activeMs: () => number
  /**
   * Sends an event inside a unit, in the background. Returns its id.
   * `onSent` runs once the server has applied it.
   */
  send: (
    event: PlayerEvent,
    expected: ExpectedPosition,
    opts?: { id?: string; onSent?: () => void }
  ) => string
  /**
   * Sends a unit's last event once the outbox is empty; the next unit
   * arrives with the answer. Call inside a transition for a pending state.
   * Ignored while another finish or **×** is under way. Resolves true when
   * the server applied it.
   */
  finish: (
    event: PlayerEvent,
    expected: ExpectedPosition,
    opts?: { id?: string }
  ) => Promise<boolean>
  /**
   * The position the unit is at now, as it moves locally: a unit reports it
   * with `report`, and ⋯ *Mark as skipped* sends it as its expected
   * position (§8.4).
   */
  report: (expected: ExpectedPosition) => void
  current: () => ExpectedPosition | null
  /**
   * The lesson step the unit has reached locally (Recall exercises move on
   * to step 5 inside one unit), for the steps row; undefined until a lesson
   * unit reports. `null` once the lesson is done.
   */
  lessonStep: { lessonId: string; step: LessonStep | null } | undefined
  /** Undo on the "Lesson N skipped" toast (§8.3), naming the skip's event. */
  undoSkip: (lessonId: string, skipEventId: string) => Promise<void>
  /** **×**: saves drafts and the active time, then the end screens. */
  exit: () => Promise<void>
  /** A finish or **×** is under way: the other waits (× is disabled). */
  busy: boolean
  /**
   * Bumped when the server rejects an event: the unit remounts from the
   * props, and again when the refreshed props arrive (`UnitBoundary`).
   */
  resync: number
  /** Typed text, mirrored here so × can save it (§8.4). */
  setDraft: (draft: DraftCopy) => void
  clearDraft: (key: string) => void
  announce: (text: string) => void
  saving: boolean
}

const Ctx = createContext<PlayerRuntime | null>(null)

export function usePlayer(): PlayerRuntime {
  const ctx = use(Ctx)
  if (!ctx) throw new Error("usePlayer needs a PlayerRuntimeProvider")
  return ctx
}

export const newEventId = () => crypto.randomUUID()

/** Shown when the server refuses an event (§8.3); toasts are announced. */
export const REFUSED_TOAST = "Couldn't save that. Showing where you are."

/**
 * Shown when Undo on a skip no longer applies: the session moved on, or the
 * lesson changed elsewhere.
 */
export const UNDO_STALE_TOAST = "Couldn't undo the skip."

/** Next's own errors (the redirect to /unlock, not found) are never retried. */
function isNextError(error: unknown): boolean {
  try {
    unstable_rethrow(error)
    return false
  } catch {
    return true
  }
}

/**
 * Counts time while the tab is visible (§7.7). The server's `active_ms` wins
 * when it is ahead, for example after another tab's events.
 */
function useActiveTime(serverMs: number) {
  const base = useRef(serverMs)
  const since = useRef<number | null>(null)

  const read = useCallback(
    () =>
      base.current +
      (since.current === null ? 0 : performance.now() - since.current),
    []
  )

  useEffect(() => {
    if (serverMs > read()) {
      base.current = serverMs
      if (since.current !== null) since.current = performance.now()
    }
  }, [serverMs, read])

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === "visible") {
        since.current ??= performance.now()
      } else if (since.current !== null) {
        base.current += performance.now() - since.current
        since.current = null
      }
    }
    sync()
    document.addEventListener("visibilitychange", sync)
    return () => {
      document.removeEventListener("visibilitychange", sync)
      if (since.current !== null) {
        base.current += performance.now() - since.current
        since.current = null
      }
    }
  }, [])

  return read
}

export function PlayerRuntimeProvider({
  sessionId,
  activeMs: serverActiveMs,
  children,
}: {
  sessionId: string
  activeMs: number
  children: React.ReactNode
}) {
  const router = useRouter()
  const activeMs = useActiveTime(serverActiveMs)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const drafts = useRef(new Map<string, DraftCopy>())
  const position = useRef<ExpectedPosition | null>(null)
  const [lessonStep, setLessonStep] =
    useState<PlayerRuntime["lessonStep"]>(undefined)
  const [busy, setBusy] = useState(false)
  const [exclusive] = useState(() => exclusiveRunner(setBusy))
  const [resync, setResync] = useState(0)
  // The client's idea of the position was wrong: drop the unit's local
  // state and load the true one. A refusal also says so; a stale position
  // (another tab moved on) needs no explanation.
  const [rejected] = useState(
    () => (result: Extract<EventResult, { ok: false }>) => {
      if ("refused" in result) toast.error(REFUSED_TOAST)
      setResync((n) => n + 1)
      router.refresh()
    }
  )

  const [outbox] = useState(
    () =>
      new Outbox<PlayerEnvelope>({
        send: (env) => recordEvent(sessionId, env),
        onRejected: rejected,
        onSaving: setSaving,
        isFatal: isNextError,
      })
  )

  const envelope = useCallback(
    (event: PlayerEvent, expected: ExpectedPosition, id = newEventId()) => ({
      id,
      expected,
      activeMs: Math.round(activeMs()),
      event,
    }),
    [activeMs]
  )

  const runtime = useMemo<PlayerRuntime>(() => {
    return {
      sessionId,
      activeMs,
      saving,
      busy,
      resync,
      send(event, expected, opts) {
        const env = envelope(event, expected, opts?.id)
        outbox.push(env, opts?.onSent)
        return env.id
      },
      finish: async (event, expected, opts) => {
        let applied = false
        await exclusive(async () => {
          // An earlier event was rejected: the page is already reloading.
          if (!(await outbox.drainClean())) return
          const env = envelope(event, expected, opts?.id)
          const result = await outbox.sendNow(() => finishUnit(sessionId, env))
          if (!result.ok) rejected(result)
          else applied = true
        })
        return applied
      },
      report(expected) {
        position.current = expected
        const { session, lesson } = expected
        const next =
          session.unit === "lesson" && lesson
            ? { lessonId: session.lessonId, step: stepOf(lesson) }
            : undefined
        setLessonStep((was) =>
          was?.lessonId === next?.lessonId && was?.step === next?.step
            ? was
            : next
        )
      },
      current: () => position.current,
      lessonStep,
      undoSkip: (lessonId, skipEventId) =>
        exclusive(async () => {
          if (!(await outbox.drainClean())) return
          const result = await outbox.sendNow(() =>
            undoSkip(sessionId, lessonId, skipEventId)
          )
          // Too late: nothing changed on the server, so the screen stays as
          // it is and only says so.
          if (!result.ok && "stale" in result) toast(UNDO_STALE_TOAST)
          else if (!result.ok) rejected(result)
        }).then(() => undefined),
      exit: () =>
        exclusive(async () => {
          const copies = [...drafts.current.values()]
          const result = await outbox.sendNow(() =>
            exitSession(sessionId, Math.round(activeMs()), copies)
          )
          if (!result.ok) rejected(result)
        }).then(() => undefined),
      setDraft(d) {
        drafts.current.set(d.key, d)
      },
      clearDraft(key) {
        drafts.current.delete(key)
      },
      announce(text) {
        // The same text twice in a row would not be announced again.
        setMessage((m) => (m === text ? `${text}\u00a0` : text))
      },
    }
  }, [
    sessionId,
    activeMs,
    saving,
    busy,
    resync,
    lessonStep,
    envelope,
    outbox,
    exclusive,
    rejected,
  ])

  return (
    <Ctx value={runtime}>
      {children}
      <div aria-live="polite" role="status" className="sr-only">
        {message}
      </div>
    </Ctx>
  )
}

/**
 * Wraps the current unit so it remounts, dropping its local state, whenever
 * the server rejects an event (§8.4). The page also keys the unit by its
 * position, so the refreshed props remount it again.
 */
export function UnitBoundary({ children }: { children: React.ReactNode }) {
  const { resync } = usePlayer()
  return <Fragment key={resync}>{children}</Fragment>
}

// --- Drafts -----------------------------------------------------------------

const storageKey = (key: string) => `plato:draft:${key}`

function readLocal(key: string): DraftCopy | null {
  try {
    const raw = localStorage.getItem(storageKey(key))
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<DraftCopy>
    return typeof v.text === "string" && typeof v.updatedAt === "number"
      ? { key, text: v.text, updatedAt: v.updatedAt }
      : null
  } catch {
    return null
  }
}

/** Removes a draft's local copy once the server has its submitted text. */
export function forgetLocalDraft(key: string): void {
  try {
    localStorage.removeItem(storageKey(key))
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Typed text (§8.4): every change is mirrored to `localStorage`, and reaches
 * the server on blur, in the event that submits it and in **×**. On load, a
 * local copy newer than the server's wins. `submit()` stops saving it as a
 * draft; `forget()` drops the local copy once the server has the text.
 */
export function useDraft(key: string, server: DraftCopy | null) {
  const player = usePlayer()
  const [text, setText] = useState(server?.text ?? "")
  const latest = useRef<DraftCopy | null>(server)

  useEffect(() => {
    const local = readLocal(key)
    const best = chooseDraft(local, server)
    if (best) {
      latest.current = best
      player.setDraft(best)
      // Restoring the local copy after hydration: localStorage is not
      // readable during the server render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(best.text)
    }
    // Only on mount: later server props are this text coming back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const change = useCallback(
    (value: string) => {
      setText(value)
      const copy = { key, text: value, updatedAt: Date.now() }
      latest.current = copy
      player.setDraft(copy)
      try {
        localStorage.setItem(
          storageKey(key),
          JSON.stringify({ text: copy.text, updatedAt: copy.updatedAt })
        )
      } catch {
        // Storage full or disabled: the server copy still saves on blur.
      }
    },
    [key, player]
  )

  const blur = useCallback(() => {
    const copy = latest.current
    if (!copy || copy === server) return
    saveDraft(copy).catch(() => {
      // Kept locally and sent again with × or the submitting event.
    })
  }, [server])

  /**
   * The text was submitted: × no longer saves it as a draft. The local copy
   * is kept until `forget()`, once the server has the text, so a reload
   * before then still restores it.
   */
  const submit = useCallback(() => {
    latest.current = null
    player.clearDraft(key)
  }, [key, player])

  const forget = useCallback(() => forgetLocalDraft(key), [key])

  return { text, change, blur, submit, forget }
}

/**
 * Reports the unit's current position to the runtime as it moves locally,
 * so ⋯ *Mark as skipped* can send it as its expected position (§8.4).
 */
export function useReportPosition(expected: ExpectedPosition): void {
  const { report } = usePlayer()
  const key = JSON.stringify(expected)
  // Before paint, so the steps row never shows the step the unit left.
  useLayoutEffect(() => {
    report(JSON.parse(key) as ExpectedPosition)
  }, [key, report])
}
