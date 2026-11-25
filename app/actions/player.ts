"use server"

import { refresh } from "next/cache"
import { unstable_rethrow } from "next/navigation"
import { z } from "zod"

import { requireLearner } from "@/lib/auth/learner"
import { Id } from "@/lib/content/schema"
import { isTransientDbError } from "@/lib/dal/errors"
import {
  applyPlayerEvent,
  exitPlayerSession,
  saveDraftText,
} from "@/lib/dal/player"
import type { EventResult, PlayerEnvelope } from "@/lib/engine/player"

// The player's actions (§8.3, §8.4). Every input is parsed here: actions are
// reachable by direct POST.

const SessionId = z.uuid()
const Index = z.number().int().min(0)

const SessionPosition = z.discriminatedUnion("unit", [
  z.strictObject({
    unit: z.literal("reviews"),
    index: Index,
    answered: z.uuid().optional(),
  }),
  z.strictObject({ unit: z.literal("lesson"), lessonId: Id }),
  z.strictObject({
    unit: z.literal("checkpoint"),
    moduleId: Id,
    index: Index,
    answered: z.uuid().optional(),
  }),
  z.strictObject({
    unit: z.literal("end"),
    screen: z.enum(["course-complete", "summary"]),
  }),
])

const LessonPosition = z.union([
  z.strictObject({ step: z.enum(["warmup", "guess"]), index: Index }),
  z.strictObject({ step: z.literal("read") }),
  z.strictObject({
    step: z.literal("recall"),
    phase: z.enum(["write", "tick"]),
  }),
  z.strictObject({
    step: z.literal("recall"),
    phase: z.literal("exercises"),
    index: Index,
    answered: z.uuid().optional(),
  }),
  z.strictObject({ step: z.literal("answers"), index: Index }),
  z.strictObject({ step: z.literal("done") }),
])

const Grade = z.enum(["forgot", "partly", "remembered"])
const Text = z.string().max(20_000)

const ExerciseResponse = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("mc"), optionId: Id }),
  z.strictObject({ type: z.literal("scenario"), optionId: Id }),
  z.strictObject({ type: z.literal("fill"), text: Text }),
  z.strictObject({ type: z.literal("spot"), sentenceId: Id, fixId: Id }),
  z.strictObject({
    type: z.literal("short"),
    text: Text,
    ticked: z.array(Index).max(20),
  }),
])

const ItemAnswer = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("rating"), grade: Grade }),
  z.strictObject({
    kind: z.literal("exercise"),
    response: ExerciseResponse,
    confidence: z.enum(["sure", "not_sure", "guess"]).nullable(),
  }),
])

// Each task adds the events of the screens it builds (§15).
const PlayerEvent = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("answer"), answer: ItemAnswer }),
  z.strictObject({ kind: z.literal("answer-next") }),
  z.strictObject({ kind: z.literal("recall-write"), text: Text }),
  z.strictObject({
    kind: z.literal("recall-tick"),
    ticked: z.array(Id).max(20),
  }),
  z.strictObject({ kind: z.literal("continue") }),
])

/**
 * Active time only feeds the soft budget and the summary's minutes, so an
 * implausible value (a tab left visible for weeks) is clamped, not refused:
 * refusing it would refuse every later event too.
 */
const MAX_ACTIVE_MS = 7 * 24 * 60 * 60 * 1000
const ActiveMs = z
  .number()
  .min(0)
  .transform((ms) => Math.min(ms, MAX_ACTIVE_MS))

const Envelope = z.strictObject({
  id: z.uuid(),
  expected: z.strictObject({
    session: SessionPosition,
    lesson: LessonPosition.nullable(),
  }),
  activeMs: ActiveMs,
  event: PlayerEvent,
})

const Draft = z.strictObject({
  key: z.string().max(300),
  text: Text,
  updatedAt: z.number().int().min(0),
})

/**
 * A server-side failure that retrying cannot fix becomes a typed refusal, so
 * the client stops and shows where the session is. A transient one is
 * thrown, and the client retries the same event (§8.4). Redirects and
 * not-found pass through to Next.
 */
async function refusing(run: () => Promise<EventResult>): Promise<EventResult> {
  try {
    return await run()
  } catch (error) {
    unstable_rethrow(error)
    if (isTransientDbError(error)) throw error
    console.error(error)
    return { ok: false, refused: true }
  }
}

/** A progress event inside a unit (§8.4). Nothing on the page changes. */
export async function recordEvent(
  sessionId: unknown,
  event: unknown
): Promise<EventResult> {
  await requireLearner()
  return refusing(() =>
    applyPlayerEvent(
      SessionId.parse(sessionId),
      Envelope.parse(event) as PlayerEnvelope
    )
  )
}

/**
 * A unit's last event: applied like any other, then the next unit or the end
 * screens arrive in the same round trip (§8.4).
 */
export async function finishUnit(
  sessionId: unknown,
  event: unknown
): Promise<EventResult> {
  await requireLearner()
  const result = await refusing(() =>
    applyPlayerEvent(
      SessionId.parse(sessionId),
      Envelope.parse(event) as PlayerEnvelope
    )
  )
  if (result.ok) refresh()
  return result
}

/** **×**: saves drafts and the active time, then the end screens (§7.7). */
export async function exitSession(
  sessionId: unknown,
  activeMs: unknown,
  drafts: unknown
): Promise<EventResult> {
  await requireLearner()
  const result = await refusing(async () => {
    await exitPlayerSession(SessionId.parse(sessionId), {
      activeMs: ActiveMs.parse(activeMs),
      drafts: z.array(Draft).max(50).parse(drafts),
    })
    return { ok: true }
  })
  refresh()
  return result
}

/** Typed text, on blur (§8.4). */
export async function saveDraft(input: unknown): Promise<void> {
  await requireLearner()
  await saveDraftText(Draft.parse(input))
}
