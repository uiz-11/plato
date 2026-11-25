import "server-only"

// The player's reads and writes (§8.3, §8.4): `getPlayerUnit` builds the
// current unit with every item it holds, and `applyPlayerEvent` checks and
// records one event, choosing the next unit when a unit ends. Exiting and
// drafts are here too.

import type { Root as HastRoot } from "hast"
import { and, desc, eq, sql } from "drizzle-orm"
import { notFound, redirect } from "next/navigation"

import { requireLearner } from "@/lib/auth/learner"
import { now, today } from "@/lib/clock"
import { getRenderedLesson } from "@/lib/content/render"
import type { Exercise, ExerciseType } from "@/lib/content/schema"
import {
  attempt,
  conceptSchedule,
  draft,
  lessonProgress,
  session,
} from "@/lib/db/schema"
import { getDb } from "@/lib/db/client"
import { isProgressEvent } from "@/lib/engine/day"
import {
  lessonTitle,
  reviewBlockTitle,
  sessionWork,
  summaryLine,
  targetLabel,
} from "@/lib/engine/labels"
import {
  advanceLesson,
  enterLesson,
  firstLessonPosition,
  PositionError,
  samePosition,
  selectRecallExercises,
  stepOf,
  warmupPrompts,
  warmupSource,
  type LessonStep,
} from "@/lib/engine/lesson"
import {
  isReviewRetry,
  madeCourseComplete,
  markReviewItem,
  nextReviewPosition,
  reviewQueueAfter,
  type EventResult,
  type PlayerEnvelope,
} from "@/lib/engine/player"
import {
  advanceVersion,
  applyReview,
  reviewEventConcepts,
} from "@/lib/engine/schedule"
import {
  assembleSession,
  checkpointExerciseEstimate,
  endPosition,
  lessonUnitEstimate,
  nextSessionPosition,
  playerUnitKind,
  sessionTarget,
  unitKey,
  wouldHoldWork,
  type NextUnitInput,
  type PlayerUnitKind,
  type ReviewQueueItem,
} from "@/lib/engine/session"
import {
  checkpointNumber,
  checkpointQueue,
  checkpointStatus,
  courseStatus,
  moduleById,
  nextTarget,
  skippedInSession,
  type Target,
} from "@/lib/engine/status"
import type {
  Day,
  Grade,
  LessonPosition,
  SessionKind,
  SessionPosition,
} from "@/lib/engine/types"

import { DalError } from "./errors"
import {
  fromLessonProgress,
  loadAssemblyState,
  loadCourseState,
  readLessonRow,
  readSettings,
  recordShownUp,
  type Conn,
  type CourseState,
  type Tx,
} from "./load"

type SessionRow = typeof session.$inferSelect

// --- Views ------------------------------------------------------------------

/** The frame around every player screen (§9.2). */
export interface PlayerFrameView {
  title: string
  subtitle: string | null
  /** "open", "done", "complete" */
  tag: string | null
  /** Time left (elapsed for `full_lesson`), minutes used, or none. */
  timer: "live" | "used" | "none"
  /** The lesson steps row (WF-E), in a lesson unit. */
  steps: { current: LessonStep | null; hasWarmup: boolean } | null
}

export type ReviewVersionView =
  | { kind: "prompt"; prompt: HastRoot; answer: HastRoot }
  /** Exercises are answered in T16; until then the item is a stand-in. */
  | { kind: "exercise"; exerciseId: string; type: ExerciseType }

export interface ReviewItemView {
  courseId: string
  courseTitle: string
  conceptId: string
  version: ReviewVersionView
}

export interface ReviewUnitView {
  kind: "reviews"
  items: ReviewItemView[]
  index: number
  /** The current item's answer, so a reload shows it instead of asking again. */
  answered: { attemptId: string; grade: Grade } | null
}

export interface DraftView {
  key: string
  text: string
  updatedAt: number
}

export interface RecallUnitView {
  kind: "recall-write-tick"
  courseId: string
  lessonId: string
  phase: "write" | "tick"
  /** "Picking up where you stopped" (WF-E4.1). */
  pickingUp: boolean
  /** The draft key and the server's copy of it (§8.4 Typed text). */
  draftKey: string
  draft: DraftView | null
  /** What the learner wrote, once submitted (shown beside the ticks). */
  written: string | null
  /** The key points to tick, in authored order. */
  concepts: { id: string; statement: string }[]
  /** What the client needs to size the Recall exercise queue. */
  exercises: Pick<Exercise, "id" | "pool" | "concepts">[]
}

export interface SummaryUnitView {
  kind: "summary"
  line: string
  /** **Keep going** starts a `standard` session on this course, when it holds work. */
  keepGoing: { courseId: string | null } | null
}

export interface CourseCompleteUnitView {
  kind: "course-complete"
  courseTitle: string
}

/** A unit whose screens come in a later task (T16–T18). */
export interface PendingUnitView {
  kind: "pending"
  unit: PlayerUnitKind
}

export type PlayerUnitView =
  | ReviewUnitView
  | RecallUnitView
  | SummaryUnitView
  | CourseCompleteUnitView
  | PendingUnitView

export interface PlayerView {
  sessionId: string
  kind: SessionKind
  minutes: number
  activeMs: number
  hideTimer: boolean
  /** The position the next event is checked against (§8.4). */
  expected: { session: SessionPosition; lesson: LessonPosition | null }
  /** The unit component is keyed by this, so its state resets per unit. */
  unitKey: string
  frame: PlayerFrameView
  unit: PlayerUnitView
}

// --- Loading ----------------------------------------------------------------

function readSession(db: Conn, id: string): SessionRow | undefined {
  return db.select().from(session).where(eq(session.id, id)).get()
}

const reviewQueueOf = (row: SessionRow) => row.reviewQueue as ReviewQueueItem[]

function courseOf(db: Conn, row: SessionRow): CourseState | null {
  return row.courseId === null ? null : loadCourseState(db, row.courseId)
}

/** The session's target now, with lessons it skipped left out (§7.6). */
function currentTarget(cp: CourseState | null, row: SessionRow) {
  return sessionTarget(
    row.kind,
    cp,
    cp ? skippedInSession(cp, row.id) : undefined
  )
}

function sessionAttempts(db: Conn, sessionId: string) {
  return db
    .select({
      context: attempt.context,
      exerciseId: attempt.exerciseId,
      isRetry: attempt.isRetry,
    })
    .from(attempt)
    .where(eq(attempt.sessionId, sessionId))
    .all()
}

/** Whether a session that ends now made its course *Complete* (§7.7). */
function sessionMadeComplete(
  db: Conn,
  row: SessionRow,
  cp: CourseState | null
): boolean {
  if (!cp) return false
  const work = sessionWork({
    session: { id: row.id, startedAt: row.startedAt, endedAt: null },
    cp,
    attempts: sessionAttempts(db, row.id),
  })
  return madeCourseComplete(courseStatus(cp) === "complete", work)
}

/** The lesson of `cp` that teaches `conceptId`. */
function lessonTeaching(cp: CourseState, conceptId: string) {
  const l = cp.loaded.lessons.find((l) =>
    l.lesson.concepts.some((c) => c.id === conceptId)
  )
  if (!l) throw new Error(`No lesson teaches ${cp.course.id}:${conceptId}`)
  return l
}

/** The estimate of a lesson target's first budget unit (§7.7). */
function lessonEstimate(cp: CourseState, lessonId: string): number {
  const loaded = cp.loaded.lessonsById.get(lessonId)
  if (!loaded) throw new Error(`No lesson ${lessonId}`)
  const row = cp.lessons.get(lessonId)
  const source = warmupSource(cp, lessonId)
  const sourceLesson = source ? cp.loaded.lessonsById.get(source) : undefined
  const position = row?.position ?? firstLessonPosition(source !== null)
  return lessonUnitEstimate(position, {
    warmupCount: sourceLesson ? warmupPrompts(sourceLesson.lesson).length : 0,
    guessCount: loaded.lesson.guesses.length,
    readMinutes: loaded.readMinutes,
    recallQueueLength: row?.recallQueue?.length ?? null,
    keyQuestionCount: loaded.lesson.keyQuestions.length,
  })
}

function targetEstimate(cp: CourseState, target: Target): number {
  return target.kind === "lesson"
    ? lessonEstimate(cp, target.lessonId)
    : checkpointExerciseEstimate
}

// --- getPlayerUnit ----------------------------------------------------------

type Loaded =
  { kind: "missing" } | { kind: "gone" } | { kind: "view"; view: PlayerView }

/**
 * The session's current unit with every item it holds, rendered where it is
 * content (§8.4). A lesson unit that loads creates or resumes the lesson's
 * row and sets `last_session_id` (§7.3). An ended session shows its end
 * screens while it is the most recent session; once a newer one exists, its
 * URL redirects to Today (§7.7).
 */
export async function getPlayerUnit(sessionId: string): Promise<PlayerView> {
  await requireLearner()
  const at = now()
  const day = today(at)
  const result = getDb().transaction((tx): Loaded => {
    const row = readSession(tx, sessionId)
    if (!row) return { kind: "missing" }
    if (row.endedAt !== null) {
      const latest = tx
        .select({ id: session.id })
        .from(session)
        // Two sessions started in the same millisecond: the later insert.
        .orderBy(desc(session.startedAt), desc(sql`rowid`))
        .limit(1)
        .get()
      if (latest?.id !== row.id || row.position.unit !== "end")
        return { kind: "gone" }
    }
    return { kind: "view", view: buildView(tx, row, at, day) }
  })
  if (result.kind === "missing") notFound()
  if (result.kind === "gone") redirect("/")
  return result.view
}

function buildView(tx: Tx, row: SessionRow, at: number, day: Day): PlayerView {
  const settings = readSettings(tx)
  const cp = courseOf(tx, row)
  const base = {
    sessionId: row.id,
    kind: row.kind,
    minutes: row.minutes,
    activeMs: row.activeMs,
    hideTimer: settings.hideTimer,
  }
  const pos = row.position
  const live = { timer: "live" as const, steps: null, tag: null }

  if (pos.unit === "reviews") {
    const target = currentTarget(cp, row)
    return {
      ...base,
      expected: { session: pos, lesson: null },
      unitKey: unitKey(pos, null),
      frame: {
        ...live,
        title: reviewBlockTitle(cp?.course ?? null, target),
        subtitle: null,
      },
      unit: reviewUnit(tx, row, pos),
    }
  }

  if (pos.unit === "lesson") {
    if (!cp) throw new Error(`Session ${row.id} has a lesson but no course`)
    const loaded = cp.loaded.lessonsById.get(pos.lessonId)
    if (!loaded) throw new Error(`No lesson ${pos.lessonId}`)
    const hasWarmup = warmupSource(cp, pos.lessonId) !== null
    const before = readLessonRow(tx, {
      courseId: cp.course.id,
      lessonId: pos.lessonId,
    })
    const entered = enterLesson(before, pos.lessonId, {
      now: at,
      sessionId: row.id,
      hasWarmup,
    })
    if (entered.row !== before) {
      const values = fromLessonProgress(cp.course.id, entered.row)
      tx.insert(lessonProgress)
        .values(values)
        .onConflictDoUpdate({
          target: [lessonProgress.courseId, lessonProgress.lessonId],
          set: values,
        })
        .run()
    }
    const lessonPos = entered.row.position!
    const kind = playerUnitKind(pos, lessonPos)
    return {
      ...base,
      expected: { session: pos, lesson: lessonPos },
      unitKey: unitKey(pos, lessonPos),
      frame: {
        ...live,
        title: lessonTitle(cp.course, pos.lessonId, loaded.lesson.title),
        subtitle: cp.course.title,
        steps: { current: stepOf(lessonPos), hasWarmup },
      },
      unit:
        kind === "recall-write-tick"
          ? recallUnit(
              tx,
              cp,
              pos.lessonId,
              entered.row.recallText,
              lessonPos,
              entered.pickingUp
            )
          : { kind: "pending", unit: kind },
    }
  }

  if (pos.unit === "checkpoint") {
    if (!cp) throw new Error(`Session ${row.id} has a checkpoint but no course`)
    const status = checkpointStatus(cp, pos.moduleId)
    return {
      ...base,
      expected: { session: pos, lesson: null },
      unitKey: unitKey(pos, null),
      frame: {
        ...live,
        title: `Checkpoint ${checkpointNumber(cp.course, pos.moduleId)}`,
        subtitle: cp.course.title,
        tag: status === "done" ? "done" : "open",
      },
      unit: { kind: "pending", unit: "checkpoint" },
    }
  }

  // The end screens (§7.7).
  const expected = { session: pos, lesson: null }
  if (pos.screen === "course-complete") {
    const title = cp?.course.title ?? ""
    return {
      ...base,
      expected,
      unitKey: unitKey(pos, null),
      frame: {
        title,
        subtitle: null,
        tag: "complete",
        timer: "none",
        steps: null,
      },
      unit: { kind: "course-complete", courseTitle: title },
    }
  }
  return {
    ...base,
    expected,
    unitKey: unitKey(pos, null),
    frame: {
      title: "Session complete",
      subtitle: null,
      tag: null,
      timer: "used",
      steps: null,
    },
    unit: summaryUnit(tx, row, cp, settings.sessionMinutes, day),
  }
}

function reviewUnit(
  tx: Tx,
  row: SessionRow,
  pos: Extract<SessionPosition, { unit: "reviews" }>
): ReviewUnitView {
  const courses = new Map<string, CourseState | null>()
  const course = (id: string) => {
    if (!courses.has(id)) courses.set(id, loadCourseState(tx, id))
    return courses.get(id) ?? null
  }
  const items = reviewQueueOf(row).map((item): ReviewItemView => {
    const cp = course(item.courseId)
    if (!cp) throw new Error(`Review of an unknown course ${item.courseId}`)
    const loaded = lessonTeaching(cp, item.conceptId)
    const v = item.version
    let version: ReviewVersionView
    if (v.kind === "prompt") {
      const rendered = getRenderedLesson(cp.course.id, loaded.lesson.id)
      const prompt = rendered?.concepts[item.conceptId]?.[v.index]
      if (!prompt) throw new Error(`No prompt ${v.index} for ${item.conceptId}`)
      version = { kind: "prompt", ...prompt }
    } else {
      const e = loaded.lesson.exercises.find((e) => e.id === v.exerciseId)
      if (!e) throw new Error(`No exercise ${v.exerciseId}`)
      version = { kind: "exercise", exerciseId: e.id, type: e.type }
    }
    return {
      courseId: cp.course.id,
      courseTitle: cp.course.title,
      conceptId: item.conceptId,
      version,
    }
  })
  let answered: ReviewUnitView["answered"] = null
  if (pos.answered) {
    const a = tx
      .select({ grade: attempt.grade })
      .from(attempt)
      .where(eq(attempt.id, pos.answered))
      .get()
    if (a?.grade) answered = { attemptId: pos.answered, grade: a.grade }
  }
  return { kind: "reviews", items, index: pos.index, answered }
}

/** The draft key of a lesson's Recall text (§6). */
export const recallDraftKey = (courseId: string, lessonId: string) =>
  `recall:${courseId}:${lessonId}`

function readDraft(db: Conn, key: string): DraftView | null {
  return db.select().from(draft).where(eq(draft.key, key)).get() ?? null
}

function recallUnit(
  tx: Tx,
  cp: CourseState,
  lessonId: string,
  recallText: string | null,
  position: LessonPosition,
  pickingUp: boolean
): RecallUnitView {
  const { lesson } = cp.loaded.lessonsById.get(lessonId)!
  const draftKey = recallDraftKey(cp.course.id, lessonId)
  const phase =
    position.step === "recall" && position.phase === "tick" ? "tick" : "write"
  return {
    kind: "recall-write-tick",
    courseId: cp.course.id,
    lessonId,
    phase,
    pickingUp,
    draftKey,
    draft: phase === "write" ? readDraft(tx, draftKey) : null,
    written: phase === "tick" ? (recallText ?? "") : null,
    concepts: lesson.concepts.map((c) => ({
      id: c.id,
      statement: c.statement,
    })),
    exercises: lesson.exercises.map((e) => ({
      id: e.id,
      pool: e.pool,
      concepts: e.concepts,
    })),
  }
}

function summaryUnit(
  tx: Tx,
  row: SessionRow,
  cp: CourseState | null,
  minutes: SessionRow["minutes"],
  day: Day
): SummaryUnitView {
  const work = sessionWork({
    session: { id: row.id, startedAt: row.startedAt, endedAt: row.endedAt },
    cp,
    attempts: sessionAttempts(tx, row.id),
  })
  const next = cp ? nextTarget(cp) : null
  const line = summaryLine(
    cp?.course ?? null,
    work,
    cp && next ? targetLabel(cp, next) : null
  )
  // **Keep going** stays in this session's course (R16).
  const courseId = row.courseId ?? undefined
  const state = loadAssemblyState(tx, day, {
    publishedOnly: courseId === undefined,
  })
  const holds =
    (courseId === undefined ||
      state.courses.some((c) => c.course.id === courseId)) &&
    wouldHoldWork(
      assembleSession({
        kind: "standard",
        minutes,
        today: day,
        courseId,
        schedules: state.schedules,
        reviewsAnsweredToday: state.reviewsAnsweredToday,
        courses: state.courses,
      })
    )
  return {
    kind: "summary",
    line,
    keepGoing: holds ? { courseId: row.courseId } : null,
  }
}

// --- Events -----------------------------------------------------------------

interface Applied {
  position: SessionPosition
  reviewQueue?: ReviewQueueItem[]
  checkpointQueue?: string[] | null
}

const bad = (message: string) => new DalError("bad_event", message)

/**
 * Records one player event (§8.4) in one transaction: a re-sent event (same
 * id as the last applied, or an existing attempt) returns `ok`; an event
 * whose expected position does not match the stored one is ignored and
 * reported stale; otherwise it is applied, the session moves on, and its id
 * becomes `last_event_id`. When the event ends a unit, the next unit or the
 * end screens are chosen here (§7.7).
 */
export async function applyPlayerEvent(
  sessionId: string,
  env: PlayerEnvelope
): Promise<EventResult> {
  await requireLearner()
  const at = now()
  const day = today(at)
  return getDb().transaction((tx): EventResult => {
    const row = readSession(tx, sessionId)
    if (!row) throw new DalError("unknown_session", `No session ${sessionId}`)
    if (row.lastEventId === env.id) return { ok: true }
    if (
      env.event.kind === "answer" &&
      tx
        .select({ id: attempt.id })
        .from(attempt)
        .where(eq(attempt.id, env.id))
        .get()
    )
      return { ok: true }

    // A session closed by a newer one keeps its position; only its end
    // screens still take events.
    if (row.endedAt !== null && row.position.unit !== "end")
      return { ok: false, stale: true }
    if (!samePosition(env.expected.session, row.position))
      return { ok: false, stale: true }
    let lessonRow = null
    if (row.position.unit === "lesson") {
      if (!row.courseId) throw new Error(`Session ${row.id} has no course`)
      lessonRow = readLessonRow(tx, {
        courseId: row.courseId,
        lessonId: row.position.lessonId,
      })
      if (
        !lessonRow?.position ||
        !samePosition(env.expected.lesson, lessonRow.position)
      )
        return { ok: false, stale: true }
    }

    const activeMs = Math.max(row.activeMs, Math.round(env.activeMs))
    const current = { ...row, activeMs }
    const applied = apply(tx, current, env, { at, day })
    const ending = applied.position.unit === "end" && row.endedAt === null
    tx.update(session)
      .set({
        position: applied.position,
        lastEventId: env.id,
        activeMs,
        ...(applied.reviewQueue ? { reviewQueue: applied.reviewQueue } : {}),
        ...(applied.checkpointQueue !== undefined
          ? { checkpointQueue: applied.checkpointQueue }
          : {}),
        ...(ending ? { endedAt: at } : {}),
      })
      .where(eq(session.id, row.id))
      .run()
    if (isProgressEvent(env.event.kind)) recordShownUp(tx, day)
    return { ok: true }
  })
}

function apply(
  tx: Tx,
  row: SessionRow,
  env: PlayerEnvelope,
  clock: { at: number; day: Day }
): Applied {
  const pos = row.position
  const { event } = env
  switch (pos.unit) {
    case "reviews":
      return applyReviewEvent(tx, row, pos, env, clock)
    case "lesson":
      return applyLessonEvent(tx, row, pos, env, clock)
    case "checkpoint":
      if (event.kind === "continue") {
        const queue = row.checkpointQueue ?? []
        if (pos.index !== queue.length) throw bad("The checkpoint is not over")
        return afterTarget(tx, row, "checkpoint")
      }
      throw bad(`${event.kind} is not handled in a checkpoint yet`)
    case "end":
      if (event.kind === "continue" && pos.screen === "course-complete")
        return { position: { unit: "end", screen: "summary" } }
      throw bad(`${event.kind} does not apply on the ${pos.screen} screen`)
  }
}

function applyReviewEvent(
  tx: Tx,
  row: SessionRow,
  pos: Extract<SessionPosition, { unit: "reviews" }>,
  env: PlayerEnvelope,
  { at, day }: { at: number; day: Day }
): Applied {
  const queue = reviewQueueOf(row)
  const item = queue[pos.index]
  if (!item) throw new Error(`Session ${row.id} has no review ${pos.index}`)
  const { event } = env

  if (event.kind === "answer-next") {
    if (pos.answered === undefined) throw bad("The review is not answered")
    const next = nextReviewPosition(pos.index, queue.length)
    return next ? { position: next } : afterTarget(tx, row, "reviews")
  }
  if (event.kind !== "answer") throw bad(`${event.kind} in the review block`)
  if (pos.answered !== undefined) throw bad("The review is already answered")

  const cp = loadCourseState(tx, item.courseId)
  if (!cp) throw new Error(`Review of an unknown course ${item.courseId}`)
  const { lesson } = lessonTeaching(cp, item.conceptId)
  let marked
  try {
    marked = markReviewItem(item, lesson, event.answer)
  } catch (error) {
    throw bad(error instanceof Error ? error.message : String(error))
  }
  const isRetry = isReviewRetry(queue, pos.index)
  tx.insert(attempt)
    .values({
      id: env.id,
      sessionId: row.id,
      context: "review",
      courseId: item.courseId,
      conceptId: item.conceptId,
      exerciseId:
        item.version.kind === "exercise" ? item.version.exerciseId : null,
      response: event.answer,
      ...marked,
      isRetry,
      day,
      answeredAt: at,
    })
    .run()

  // The schedule and the version cursor move on a first answer only (§7.4).
  const where = and(
    eq(conceptSchedule.courseId, item.courseId),
    eq(conceptSchedule.conceptId, item.conceptId)
  )
  const sched = tx.select().from(conceptSchedule).where(where).get()
  if (sched) {
    const touched = reviewEventConcepts(
      { context: "review", isRetry, conceptId: item.conceptId },
      new Map([[sched.conceptId, sched]]),
      day
    )
    if (touched.length > 0) {
      const next = advanceVersion(applyReview(sched, marked.grade, day))
      tx.update(conceptSchedule).set(next).where(where).run()
    }
  }

  const grown = reviewQueueAfter(queue, pos.index, marked)
  return {
    position: { unit: "reviews", index: pos.index, answered: env.id },
    ...(grown ? { reviewQueue: grown } : {}),
  }
}

function applyLessonEvent(
  tx: Tx,
  row: SessionRow,
  pos: Extract<SessionPosition, { unit: "lesson" }>,
  env: PlayerEnvelope,
  { at }: { at: number; day: Day }
): Applied {
  const courseId = row.courseId!
  const ref = { courseId, lessonId: pos.lessonId }
  const cp = loadCourseState(tx, courseId)
  const loaded = cp?.loaded.lessonsById.get(pos.lessonId)
  const current = readLessonRow(tx, ref)
  if (!cp || !loaded || !current?.position)
    throw new Error(`Lesson ${courseId}:${pos.lessonId} is not loaded`)
  const { event } = env
  const where = and(
    eq(lessonProgress.courseId, courseId),
    eq(lessonProgress.lessonId, pos.lessonId)
  )

  if (event.kind === "continue") {
    if (current.position.step !== "done") throw bad("The lesson is not done")
    return afterTarget(tx, row, "lesson")
  }

  const shape = {
    warmupCount: 0,
    guessCount: loaded.lesson.guesses.length,
    recallQueueLength: current.recallQueue?.length ?? 0,
    keyQuestionCount: loaded.lesson.keyQuestions.length,
  }
  const advance = (kind: "recall-write" | "recall-tick") => {
    try {
      return advanceLesson(current.position!, { kind }, shape)
    } catch (error) {
      if (error instanceof PositionError) throw bad(error.message)
      throw error
    }
  }

  switch (event.kind) {
    case "recall-write": {
      const position = advance("recall-write")
      tx.update(lessonProgress)
        .set({ recallText: event.text, position, updatedAt: at })
        .where(where)
        .run()
      tx.delete(draft)
        .where(eq(draft.key, recallDraftKey(courseId, pos.lessonId)))
        .run()
      return { position: pos }
    }
    case "recall-tick": {
      const position = advance("recall-tick")
      const conceptIds = loaded.lesson.concepts.map((c) => c.id)
      const ticked = conceptIds.filter((id) => event.ticked.includes(id))
      const queue = selectRecallExercises(loaded.lesson, ticked)
      tx.update(lessonProgress)
        .set({
          recallTicked: ticked,
          recallQueue: queue,
          position,
          updatedAt: at,
        })
        .where(where)
        .run()
      return { position: pos }
    }
    default:
      throw bad(`${event.kind} is not handled in a lesson yet`)
  }
}

/**
 * A target (or the review block) finished: the next target in the session's
 * course under the budget rule, or the end screens (§7.7). A checkpoint that
 * becomes the target gets its queue: authored order minus what is answered.
 */
function afterTarget(
  tx: Tx,
  row: SessionRow,
  finished: Extract<NextUnitInput, { next: unknown }>["finished"]
): Applied {
  const cp = courseOf(tx, row)
  const target = currentTarget(cp, row)
  const position = nextSessionPosition({
    kind: row.kind,
    minutes: row.minutes,
    activeMs: row.activeMs,
    madeCourseComplete: sessionMadeComplete(tx, row, cp),
    finished,
    next:
      cp && target
        ? { target, estimateSeconds: targetEstimate(cp, target) }
        : null,
  })
  if (position.unit === "checkpoint" && cp) {
    return {
      position,
      checkpointQueue: checkpointQueue(
        moduleById(cp.course, position.moduleId),
        cp.checkpointAnswered
      ),
    }
  }
  return { position }
}

// --- Exit and drafts --------------------------------------------------------

const DRAFT_KEY =
  /^(recall:[a-z0-9-]+:[a-z0-9-]+|short:[a-z0-9-]+:[a-z0-9-]+|note:[a-z0-9-]+:[a-z0-9-]+:q[1-5])$/

function upsertDrafts(tx: Tx, drafts: readonly DraftView[]): void {
  for (const d of drafts) {
    if (!DRAFT_KEY.test(d.key))
      throw new DalError("bad_draft", `Not a draft key: ${d.key}`)
    tx.insert(draft)
      .values(d)
      .onConflictDoUpdate({
        target: draft.key,
        set: { text: d.text, updatedAt: d.updatedAt },
      })
      .run()
  }
}

/**
 * Saves a draft (§8.4 Typed text). `updatedAt` is the client's time of the
 * last change, which the client compares with its local copy on load.
 */
export async function saveDraftText(d: DraftView): Promise<void> {
  await requireLearner()
  getDb().transaction((tx) => upsertDrafts(tx, [d]))
}

/**
 * **×** (§7.7, R8): saves the drafts and the active time, then moves to the
 * end screens and ends the session. Exiting an ended session only saves.
 */
export async function exitPlayerSession(
  sessionId: string,
  input: { activeMs: number; drafts: readonly DraftView[] }
): Promise<void> {
  await requireLearner()
  const at = now()
  getDb().transaction((tx) => {
    const row = readSession(tx, sessionId)
    if (!row) throw new DalError("unknown_session", `No session ${sessionId}`)
    upsertDrafts(tx, input.drafts)
    if (row.endedAt !== null) return
    const activeMs = Math.max(row.activeMs, Math.round(input.activeMs))
    const cp = courseOf(tx, row)
    tx.update(session)
      .set({
        activeMs,
        position: endPosition(sessionMadeComplete(tx, row, cp)),
        endedAt: at,
      })
      .where(eq(session.id, row.id))
      .run()
  })
}
