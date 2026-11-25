import "server-only"

// The player's reads and writes (§8.3, §8.4): `getPlayerUnit` builds the
// current unit with every item it holds, and `applyPlayerEvent` checks and
// records one event, choosing the next unit when a unit ends. Exiting and
// drafts are here too.

import { randomUUID } from "node:crypto"

import type { Root as HastRoot } from "hast"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import { notFound, redirect } from "next/navigation"

import { requireLearner } from "@/lib/auth/learner"
import { now, today } from "@/lib/clock"
import {
  getRenderedLesson,
  type RenderedExercise,
  type RenderedLesson,
} from "@/lib/content/render"
import type { Exercise, Lesson, Link } from "@/lib/content/schema"
import {
  answerNote,
  attempt,
  conceptSchedule,
  type SkipUndo,
  draft,
  guessAnswer,
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
  celebrationLine,
  completeLesson,
  enterLesson,
  firstLessonPosition,
  PositionError,
  samePosition,
  selectRecallExercises,
  skipLesson,
  stepOf,
  unskipLesson,
  warmupPrompts,
  warmupSource,
  type LessonEvent,
  type LessonShape,
  type LessonStep,
} from "@/lib/engine/lesson"
import {
  isRecallRetry,
  isReviewRetry,
  madeCourseComplete,
  markExerciseItem,
  markReviewItem,
  nextReviewPosition,
  recallQueueAfter,
  reviewQueueAfter,
  type EventResult,
  type ItemAnswer,
  type PlayerEnvelope,
} from "@/lib/engine/player"
import {
  advanceVersion,
  applyReview,
  lessonCompletionSchedules,
  reviewEventConcepts,
} from "@/lib/engine/schedule"
import {
  assembleSession,
  budgetAllows,
  checkpointExerciseEstimate,
  endPosition,
  lessonUnitEstimate,
  nextSessionPosition,
  playerUnitKind,
  sessionTarget,
  startsBudgetUnit,
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
  lessonNumber,
  lessonStatus,
  moduleById,
  nextTarget,
  skippedInSession,
  type Target,
} from "@/lib/engine/status"
import type {
  Confidence,
  Day,
  Grade,
  LessonPosition,
  SelfMark,
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
  steps: {
    lessonId: string
    current: LessonStep | null
    hasWarmup: boolean
  } | null
  /**
   * *Mark as skipped* in ⋯, while a lesson that is not yet done is the
   * current unit (§9.2); `number` names it in the toast.
   */
  skip: { lessonId: string; number: number } | null
}

/**
 * An exercise as the player needs it (§8.4): the content with its answer
 * key, so the client marks at once, and its rendered fields. `briefKey`
 * names the brief its "In the brief" link opens (`briefKey()`).
 */
export interface ExerciseItemView {
  exercise: Exercise
  rendered: RenderedExercise
  briefKey: string
  /** A short answer's draft key, where it can be answered (Recall). */
  draftKey?: string
}

export type ReviewVersionView =
  | { kind: "prompt"; prompt: HastRoot; answer: HastRoot }
  | ({ kind: "exercise" } & ExerciseItemView)

export interface ReviewItemView {
  courseId: string
  courseTitle: string
  conceptId: string
  version: ReviewVersionView
}

/** An answered item, so a reload shows its feedback instead of asking again. */
export interface AnsweredView {
  attemptId: string
  grade: Grade
  /** What the learner gave; null for a stored answer of an unknown shape. */
  answer: ItemAnswer | null
  correct: boolean | null
  confidence: Confidence | null
  selfMark: SelfMark | null
}

/** A rendered brief for `BriefSheet`, with the learner's guesses (WF-E3). */
export interface BriefView {
  courseId: string
  lesson: RenderedLesson
  guessPicks: Record<string, string>
}

export interface ReviewUnitView {
  kind: "reviews"
  items: ReviewItemView[]
  index: number
  answered: AnsweredView | null
  /** Each distinct brief the block's exercises point to, by `briefKey`. */
  briefs: Record<string, BriefView>
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

/** Warm up (WF-E1): the source lesson's prompts, each with its answer. */
export interface WarmupUnitView {
  kind: "warmup"
  courseId: string
  lessonId: string
  /** "Picking up where you stopped" (WF-E4.1). */
  pickingUp: boolean
  /** "from Lesson 2". */
  sourceNumber: number
  prompts: { prompt: HastRoot; answer: HastRoot }[]
  index: number
}

/** Guess first (WF-E2): each guess with its options, in authored order. */
export interface GuessUnitView {
  kind: "guess"
  courseId: string
  lessonId: string
  pickingUp: boolean
  guesses: {
    id: string
    prompt: HastRoot
    options: { id: string; text: HastRoot }[]
  }[]
  index: number
}

/** "Beyond this lesson" (§5.3, spec F4): ≈ Simplified and ○ Not covered. */
export interface BeyondView {
  simplified: { id: string; text: HastRoot; links: Link[] }[]
  notCovered: { id: string; topic: string; why: string; links: Link[] }[]
}

/** Read (WF-E3): the brief with the learner's guesses, then Beyond. */
export interface ReadUnitView {
  kind: "read"
  courseId: string
  lessonId: string
  pickingUp: boolean
  /** "~7 min read". */
  readMinutes: number
  brief: BriefView
  beyond: BeyondView
}

/** One board of step 5 (WF-E6): a key question the lesson advances. */
export interface BoardView {
  keyQuestionId: string
  text: string
  /** The question's earlier answer notes, oldest first. */
  notes: { id: string; text: string; lessonLabel: string | null }[]
  draftKey: string
  draft: DraftView | null
}

/**
 * Recall exercises (WF-F1 to WF-F3), then step 5 (WF-E6), then the
 * lesson-complete screen (WF-E7): one unit (§8.4).
 */
export interface RecallExercisesUnitView {
  kind: "recall-exercises"
  courseId: string
  lessonId: string
  /** "Picking up where you stopped" (WF-E4.1). */
  pickingUp: boolean
  /** Where in the unit the lesson is. */
  stage: "exercises" | "answers" | "done"
  /** The exercises in `recall_queue`, a retry repeated where it was queued. */
  items: ExerciseItemView[]
  /** The current exercise; past the last one after the exercises. */
  index: number
  answered: AnsweredView | null
  /** The lesson's own brief, by `briefKey`. */
  briefs: Record<string, BriefView>
  /** Each short answer's draft (§8.4 Typed text), by draft key. */
  drafts: Record<string, DraftView>
  /** "Lesson 4", the label of the note being written. */
  lessonLabel: string
  /** One per key question the lesson advances. */
  boards: BoardView[]
  boardIndex: number
  /** The celebration (WF-E7), once the lesson is done. */
  complete: { heading: string; line: string | null } | null
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
  | WarmupUnitView
  | GuessUnitView
  | ReadUnitView
  | RecallUnitView
  | RecallExercisesUnitView
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
  const live = { timer: "live" as const, steps: null, tag: null, skip: null }

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
    const number = lessonNumber(cp.course, pos.lessonId)
    const ctx = {
      tx,
      cp,
      lessonId: pos.lessonId,
      pickingUp: entered.pickingUp,
    }
    return {
      ...base,
      expected: { session: pos, lesson: lessonPos },
      unitKey: unitKey(pos, lessonPos),
      frame: {
        ...live,
        title: lessonTitle(cp.course, pos.lessonId, loaded.lesson.title),
        subtitle: cp.course.title,
        steps: {
          lessonId: pos.lessonId,
          current: stepOf(lessonPos),
          hasWarmup,
        },
        skip:
          lessonPos.step === "done" ? null : { lessonId: pos.lessonId, number },
      },
      unit:
        lessonPos.step === "warmup"
          ? warmupUnit(ctx, lessonPos.index)
          : lessonPos.step === "guess"
            ? guessUnit(ctx, lessonPos.index)
            : lessonPos.step === "read"
              ? readUnit(ctx)
              : kind === "recall-write-tick"
                ? recallUnit(
                    tx,
                    cp,
                    pos.lessonId,
                    entered.row.recallText,
                    lessonPos,
                    entered.pickingUp
                  )
                : recallExercisesUnit(
                    ctx,
                    entered.row.recallQueue ?? [],
                    lessonPos
                  ),
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
        skip: null,
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
      skip: null,
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
  const briefs: Record<string, BriefView> = {}
  const items = reviewQueueOf(row).map((item): ReviewItemView => {
    const cp = course(item.courseId)
    if (!cp) throw new Error(`Review of an unknown course ${item.courseId}`)
    const loaded = lessonTeaching(cp, item.conceptId)
    const rendered = renderedLesson(cp.course.id, loaded.lesson.id)
    const v = item.version
    let version: ReviewVersionView
    if (v.kind === "prompt") {
      const prompt = rendered.concepts[item.conceptId]?.[v.index]
      if (!prompt) throw new Error(`No prompt ${v.index} for ${item.conceptId}`)
      version = { kind: "prompt", ...prompt }
    } else {
      const e = loaded.lesson.exercises.find((e) => e.id === v.exerciseId)
      if (!e) throw new Error(`No exercise ${v.exerciseId}`)
      const view = exerciseItem(rendered, e)
      // Reviews show the brief without the learner's guesses: they belong
      // to the lesson, not to this review.
      briefs[view.briefKey] ??= {
        courseId: cp.course.id,
        lesson: rendered,
        guessPicks: {},
      }
      version = { kind: "exercise", ...view }
    }
    return {
      courseId: cp.course.id,
      courseTitle: cp.course.title,
      conceptId: item.conceptId,
      version,
    }
  })
  return {
    kind: "reviews",
    items,
    index: pos.index,
    answered: pos.answered ? readAnswered(tx, pos.answered) : null,
    briefs,
  }
}

/** The key of a lesson's brief in a unit's `briefs`. */
export const briefKey = (courseId: string, lessonId: string) =>
  `${courseId}/${lessonId}`

function renderedLesson(courseId: string, lessonId: string): RenderedLesson {
  const rendered = getRenderedLesson(courseId, lessonId)
  if (!rendered) throw new Error(`No lesson ${courseId}:${lessonId}`)
  return rendered
}

function exerciseItem(
  rendered: RenderedLesson,
  exercise: Exercise
): ExerciseItemView {
  const r = rendered.exercises[exercise.id]
  if (!r) throw new Error(`No exercise ${exercise.id}`)
  return {
    exercise,
    rendered: r,
    briefKey: briefKey(rendered.courseId, rendered.lessonId),
  }
}

/** An answered attempt, read back for its feedback (§8.4). */
function readAnswered(tx: Tx, attemptId: string): AnsweredView | null {
  const a = tx.select().from(attempt).where(eq(attempt.id, attemptId)).get()
  if (!a?.grade) return null
  return {
    attemptId,
    grade: a.grade,
    answer: (a.response as ItemAnswer | null) ?? null,
    correct: a.correct,
    confidence: a.confidence,
    selfMark: a.selfMark,
  }
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

/** The draft key of a short answer's text (§6). */
export const shortDraftKey = (courseId: string, exerciseId: string) =>
  `short:${courseId}:${exerciseId}`

/** What every lesson unit builder needs. */
interface LessonCtx {
  tx: Tx
  cp: CourseState
  lessonId: string
  pickingUp: boolean
}

function lessonOf(cp: CourseState, lessonId: string) {
  const loaded = cp.loaded.lessonsById.get(lessonId)
  if (!loaded) throw new Error(`No lesson ${cp.course.id}:${lessonId}`)
  return loaded
}

/** The learner's guesses in a lesson, guess id → option id (spec F4). */
function guessPicks(db: Conn, courseId: string, lessonId: string) {
  const picks = db
    .select({ guessId: guessAnswer.guessId, optionId: guessAnswer.optionId })
    .from(guessAnswer)
    .where(
      and(
        eq(guessAnswer.courseId, courseId),
        eq(guessAnswer.lessonId, lessonId)
      )
    )
    .all()
  return Object.fromEntries(picks.map((p) => [p.guessId, p.optionId]))
}

/** The lesson's brief with the learner's guesses revealed (WF-E3). */
function lessonBrief(db: Conn, courseId: string, lessonId: string): BriefView {
  return {
    courseId,
    lesson: renderedLesson(courseId, lessonId),
    guessPicks: guessPicks(db, courseId, lessonId),
  }
}

/** The warm-up's prompts from its source lesson (§7.3). */
function warmupOf(cp: CourseState, lessonId: string) {
  const source = warmupSource(cp, lessonId)
  if (source === null) return null
  return {
    sourceId: source,
    prompts: warmupPrompts(lessonOf(cp, source).lesson),
  }
}

function warmupUnit(
  { cp, lessonId, pickingUp }: LessonCtx,
  index: number
): WarmupUnitView {
  const w = warmupOf(cp, lessonId)
  if (!w) throw new Error(`Lesson ${lessonId} has no warm-up`)
  const rendered = renderedLesson(cp.course.id, w.sourceId)
  return {
    kind: "warmup",
    courseId: cp.course.id,
    lessonId,
    pickingUp,
    sourceNumber: lessonNumber(cp.course, w.sourceId),
    prompts: w.prompts.map((p) => {
      const r = rendered.concepts[p.conceptId]?.[p.promptIndex]
      if (!r) throw new Error(`No prompt for ${p.conceptId}`)
      return r
    }),
    index,
  }
}

function guessUnit(
  { cp, lessonId, pickingUp }: LessonCtx,
  index: number
): GuessUnitView {
  const { lesson } = lessonOf(cp, lessonId)
  const rendered = renderedLesson(cp.course.id, lessonId)
  return {
    kind: "guess",
    courseId: cp.course.id,
    lessonId,
    pickingUp,
    guesses: lesson.guesses.map((g) => {
      const r = rendered.guesses[g.id]
      if (!r) throw new Error(`No guess ${g.id}`)
      return {
        id: g.id,
        prompt: r.prompt,
        options: g.options.map((o) => ({ id: o.id, text: r.options[o.id]! })),
      }
    }),
    index,
  }
}

function beyondOf(lesson: Lesson, rendered: RenderedLesson): BeyondView {
  return {
    simplified: lesson.beyond.simplified.map((e) => ({
      id: e.id,
      text: rendered.simplified[e.id]!,
      links: e.links,
    })),
    notCovered: lesson.beyond.notCovered.map((e) => ({
      id: e.id,
      topic: e.topic,
      why: e.why,
      links: e.links,
    })),
  }
}

function readUnit({ tx, cp, lessonId, pickingUp }: LessonCtx): ReadUnitView {
  const loaded = lessonOf(cp, lessonId)
  const brief = lessonBrief(tx, cp.course.id, lessonId)
  return {
    kind: "read",
    courseId: cp.course.id,
    lessonId,
    pickingUp,
    readMinutes: loaded.readMinutes,
    brief,
    beyond: beyondOf(loaded.lesson, brief.lesson),
  }
}

/** The draft key of a step 5 sticky note (§6). */
export const noteDraftKey = (
  courseId: string,
  lessonId: string,
  keyQuestionId: string
) => `note:${courseId}:${lessonId}:${keyQuestionId}`

function boardsOf(tx: Tx, cp: CourseState, lesson: Lesson): BoardView[] {
  const courseId = cp.course.id
  const notes = tx
    .select()
    .from(answerNote)
    .where(eq(answerNote.courseId, courseId))
    .orderBy(asc(answerNote.createdAt), asc(answerNote.id))
    .all()
  return lesson.keyQuestions.map((qid) => {
    const q = cp.course.keyQuestions.find((k) => k.id === qid)
    if (!q) throw new Error(`No key question ${qid}`)
    const draftKey = noteDraftKey(courseId, lesson.id, qid)
    return {
      keyQuestionId: qid,
      text: q.text,
      notes: notes
        .filter((n) => n.keyQuestionId === qid)
        .map((n) => ({
          id: n.id,
          text: n.text,
          lessonLabel:
            n.lessonId && cp.loaded.lessonsById.has(n.lessonId)
              ? `Lesson ${lessonNumber(cp.course, n.lessonId)}`
              : null,
        })),
      draftKey,
      draft: readDraft(tx, draftKey),
    }
  })
}

function recallExercisesUnit(
  { tx, cp, lessonId, pickingUp }: LessonCtx,
  queue: readonly string[],
  position: LessonPosition
): RecallExercisesUnitView {
  const courseId = cp.course.id
  const { lesson } = lessonOf(cp, lessonId)
  const rendered = renderedLesson(courseId, lessonId)
  const items = queue.map((id): ExerciseItemView => {
    const e = lesson.exercises.find((e) => e.id === id)
    if (!e) throw new Error(`No exercise ${id} in ${lessonId}`)
    const view = exerciseItem(rendered, e)
    return e.type === "short"
      ? { ...view, draftKey: shortDraftKey(courseId, e.id) }
      : view
  })
  const stage =
    position.step === "recall"
      ? "exercises"
      : position.step === "answers"
        ? "answers"
        : "done"
  const drafts: Record<string, DraftView> = {}
  if (stage === "exercises")
    for (const { draftKey } of items) {
      const d = draftKey ? readDraft(tx, draftKey) : undefined
      if (draftKey && d) drafts[draftKey] = d
    }
  const number = lessonNumber(cp.course, lessonId)
  return {
    kind: "recall-exercises",
    courseId,
    lessonId,
    pickingUp,
    stage,
    items,
    index:
      position.step === "recall" && position.phase === "exercises"
        ? position.index
        : items.length,
    answered:
      position.step === "recall" &&
      position.phase === "exercises" &&
      position.answered
        ? readAnswered(tx, position.answered)
        : null,
    briefs: {
      [briefKey(courseId, lessonId)]: {
        courseId,
        lesson: rendered,
        guessPicks: guessPicks(tx, courseId, lessonId),
      },
    },
    drafts,
    lessonLabel: `Lesson ${number}`,
    boards: stage === "done" ? [] : boardsOf(tx, cp, lesson),
    boardIndex: position.step === "answers" ? position.index : 0,
    complete:
      stage === "done"
        ? {
            heading: `Lesson ${number} complete`,
            line: celebrationLine(cp, lesson),
          }
        : null,
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
  skipUndo?: SkipUndo
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
        ...(applied.skipUndo ? { skipUndo: applied.skipUndo } : {}),
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
  { at, day }: { at: number; day: Day }
): Applied {
  const courseId = row.courseId!
  const ref = { courseId, lessonId: pos.lessonId }
  const cp = loadCourseState(tx, courseId)
  const loaded = cp?.loaded.lessonsById.get(pos.lessonId)
  const current = readLessonRow(tx, ref)
  if (!cp || !loaded || !current?.position)
    throw new Error(`Lesson ${courseId}:${pos.lessonId} is not loaded`)
  const from = current.position
  const { lesson } = loaded
  const { event } = env
  const where = and(
    eq(lessonProgress.courseId, courseId),
    eq(lessonProgress.lessonId, pos.lessonId)
  )

  if (event.kind === "continue") {
    if (from.step !== "done") throw bad("The lesson is not done")
    return afterTarget(tx, row, "lesson")
  }

  // *Mark as skipped* in the player's ⋯ menu (§7.3, §7.7): the lesson keeps
  // its position, and the session moves on to its next target.
  if (event.kind === "skip-lesson") {
    if (lessonStatus(current) === "completed") throw bad("The lesson is done")
    const skipped = skipLesson(current, pos.lessonId, {
      now: at,
      sessionId: row.id,
    })
    tx.update(lessonProgress)
      .set({
        skipped: skipped.skipped,
        lastSessionId: skipped.lastSessionId,
        updatedAt: skipped.updatedAt,
      })
      .where(where)
      .run()
    const next = afterTarget(tx, row, "skip-lesson")
    // The lesson the session moves on to, as it is before it loads, so Undo
    // can put it back (`undoPlayerSkip`).
    const movedTo =
      next.position.unit === "lesson" ? next.position.lessonId : null
    const before = movedTo
      ? (tx
          .select()
          .from(lessonProgress)
          .where(
            and(
              eq(lessonProgress.courseId, courseId),
              eq(lessonProgress.lessonId, movedTo)
            )
          )
          .get() ?? null)
      : null
    return {
      ...next,
      skipUndo: {
        skipEventId: env.id,
        next: movedTo ? { lessonId: movedTo, before } : null,
      },
    }
  }

  const warmup = warmupOf(cp, pos.lessonId)
  const shape: LessonShape = {
    warmupCount: warmup?.prompts.length ?? 0,
    guessCount: lesson.guesses.length,
    recallQueueLength: current.recallQueue?.length ?? 0,
    keyQuestionCount: lesson.keyQuestions.length,
  }
  const advance = (e: LessonEvent) => {
    try {
      return advanceLesson(from, e, shape)
    } catch (error) {
      if (error instanceof PositionError) throw bad(error.message)
      throw error
    }
  }
  const save = (position: LessonPosition) =>
    tx
      .update(lessonProgress)
      .set({ position, updatedAt: at })
      .where(where)
      .run()

  /**
   * After a move to `to`: a step that starts a new budget unit starts only
   * if the budget allows it (§7.7), otherwise the session ends there, and
   * the lesson resumes at `to` next time.
   */
  const moved = (to: LessonPosition): Applied => {
    if (!startsBudgetUnit(from, to)) return { position: pos }
    const fits = budgetAllows({
      kind: row.kind,
      minutes: row.minutes,
      activeMs: row.activeMs,
      estimateSeconds: lessonUnitEstimate(to, {
        ...shape,
        readMinutes: loaded.readMinutes,
        recallQueueLength: current.recallQueue?.length ?? null,
      }),
    })
    return fits
      ? { position: pos }
      : { position: endPosition(sessionMadeComplete(tx, row, cp)) }
  }

  /** Step 5 finished or skipped: the lesson is *Completed* (§7.3, R1). */
  const complete = (): Applied => {
    const done = completeLesson(current, { now: at, day })
    tx.update(lessonProgress)
      .set({
        skipped: done.skipped,
        position: done.position,
        completedAt: done.completedAt,
        completedDay: done.completedDay,
        updatedAt: done.updatedAt,
      })
      .where(where)
      .run()
    const conceptsOf = new Map(lesson.exercises.map((e) => [e.id, e.concepts]))
    const results = tx
      .select({
        exerciseId: attempt.exerciseId,
        grade: attempt.grade,
        isRetry: attempt.isRetry,
      })
      .from(attempt)
      .where(and(eq(attempt.courseId, courseId), eq(attempt.context, "recall")))
      .all()
      .flatMap((a) => {
        const concepts = a.exerciseId ? conceptsOf.get(a.exerciseId) : undefined
        return concepts && a.grade
          ? [{ concepts, grade: a.grade, isRetry: a.isRetry }]
          : []
      })
    for (const s of lessonCompletionSchedules(
      lesson,
      current.recallTicked ?? [],
      results,
      day
    ))
      tx.insert(conceptSchedule)
        .values({ courseId, ...s })
        .onConflictDoNothing()
        .run()
    // Boards skipped with text on them: the notes were never stuck.
    for (const qid of lesson.keyQuestions)
      tx.delete(draft)
        .where(eq(draft.key, noteDraftKey(courseId, pos.lessonId, qid)))
        .run()
    // The unit stays open on the lesson-complete screen (§8.4).
    return { position: pos }
  }

  switch (event.kind) {
    case "warmup-next": {
      const position = advance({ kind: "warmup-next" })
      save(position)
      return moved(position)
    }
    case "guess-lock": {
      const position = advance({ kind: "guess-lock" })
      if (from.step !== "guess") throw bad("Not at a guess")
      const guess = lesson.guesses[from.index]
      if (!guess) throw new Error(`No guess at ${from.index}`)
      if (!guess.options.some((o) => o.id === event.optionId))
        throw bad(`${event.optionId} is not an option of ${guess.id}`)
      tx.insert(guessAnswer)
        .values({
          courseId,
          lessonId: pos.lessonId,
          guessId: guess.id,
          optionId: event.optionId,
          answeredAt: at,
        })
        .onConflictDoUpdate({
          target: [
            guessAnswer.courseId,
            guessAnswer.lessonId,
            guessAnswer.guessId,
          ],
          set: { optionId: event.optionId, answeredAt: at },
        })
        .run()
      save(position)
      return moved(position)
    }
    case "read-done": {
      const position = advance({ kind: "read-done" })
      save(position)
      return moved(position)
    }
    case "recall-write": {
      const position = advance({ kind: "recall-write" })
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
      const position = advance({ kind: "recall-tick" })
      const conceptIds = lesson.concepts.map((c) => c.id)
      const ticked = conceptIds.filter((id) => event.ticked.includes(id))
      const queue = selectRecallExercises(lesson, ticked)
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
    case "answer": {
      // Checked before marking, so an answer elsewhere is refused cleanly.
      const position = advance({ kind: "answer", attemptId: env.id })
      if (position.step !== "recall" || position.phase !== "exercises")
        throw bad("Not at a Recall exercise")
      const queue = current.recallQueue ?? []
      const id = queue[position.index]
      const exercise = lesson.exercises.find((e) => e.id === id)
      if (!exercise) throw new Error(`No Recall exercise at ${position.index}`)
      let marked
      try {
        marked = markExerciseItem(exercise, event.answer)
      } catch (error) {
        throw bad(error instanceof Error ? error.message : String(error))
      }
      tx.insert(attempt)
        .values({
          id: env.id,
          sessionId: row.id,
          context: "recall",
          courseId,
          // Recall exercises tag exactly one concept (§5.2).
          conceptId: exercise.concepts[0] ?? null,
          exerciseId: exercise.id,
          response: event.answer,
          ...marked,
          isRetry: isRecallRetry(queue, position.index),
          day,
          answeredAt: at,
        })
        .run()
      if (exercise.type === "short")
        tx.delete(draft)
          .where(eq(draft.key, shortDraftKey(courseId, exercise.id)))
          .run()
      // Recall exercises set only the first interval, at completion (R5).
      const grown = recallQueueAfter(queue, position.index, marked)
      tx.update(lessonProgress)
        .set({
          position,
          ...(grown ? { recallQueue: grown } : {}),
          updatedAt: at,
        })
        .where(where)
        .run()
      return { position: pos }
    }
    case "answer-next": {
      save(advance({ kind: "answer-next" }))
      return { position: pos }
    }
    case "note-stick": {
      const position = advance({ kind: "note-stick" })
      if (from.step !== "answers") throw bad("Not at a board")
      const qid = lesson.keyQuestions[from.index]
      if (!qid) throw new Error(`No board at ${from.index}`)
      tx.insert(answerNote)
        .values({
          id: randomUUID(),
          courseId,
          keyQuestionId: qid,
          lessonId: pos.lessonId,
          text: event.text,
          createdAt: at,
          updatedAt: at,
        })
        .run()
      tx.delete(draft)
        .where(eq(draft.key, noteDraftKey(courseId, pos.lessonId, qid)))
        .run()
      if (position.step === "done") return complete()
      save(position)
      return { position: pos }
    }
    case "answers-skip": {
      advance({ kind: "answers-skip" })
      return complete()
    }
    default:
      throw bad(
        `${(event as { kind: string }).kind} does not apply in a lesson`
      )
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
        // No event ended it, so an Undo cannot reopen it (`undoPlayerSkip`).
        lastEventId: null,
        endedAt: at,
      })
      .where(eq(session.id, row.id))
      .run()
  })
}

/**
 * Undo on the player's "Lesson N skipped" toast (§8.3, §7.7): clears
 * `skipped` (§7.3) and sets the session position back to the lesson, which
 * resumes at its saved position. A session that the skip ended is reopened,
 * while it is still the most recent one and nothing has happened since: its
 * last event is still `skipEventId` (× clears it). Stale when the lesson is
 * no longer skipped by this session, or the session ended otherwise.
 *
 * The lesson the skip moved on to is put back as it was before the skip
 * when nothing was done in it since (`restoreSkippedTo`), so it does not
 * show as touched in this session.
 */
export async function undoPlayerSkip(
  sessionId: string,
  lessonId: string,
  skipEventId: string
): Promise<EventResult> {
  await requireLearner()
  const at = now()
  return getDb().transaction((tx): EventResult => {
    const row = readSession(tx, sessionId)
    if (!row) throw new DalError("unknown_session", `No session ${sessionId}`)
    if (!row.courseId) throw bad("The session has no course")
    const ref = { courseId: row.courseId, lessonId }
    const current = readLessonRow(tx, ref)
    if (
      lessonStatus(current) !== "skipped" ||
      current!.lastSessionId !== row.id
    )
      return { ok: false, stale: true }
    if (row.endedAt !== null) {
      const latest = tx
        .select({ id: session.id })
        .from(session)
        .orderBy(desc(session.startedAt), desc(sql`rowid`))
        .limit(1)
        .get()
      if (latest?.id !== row.id || row.lastEventId !== skipEventId)
        return { ok: false, stale: true }
    }
    restoreSkippedTo(tx, row, skipEventId)
    const where = and(
      eq(lessonProgress.courseId, ref.courseId),
      eq(lessonProgress.lessonId, lessonId)
    )
    const next = unskipLesson(current, at)
    if (next === null) tx.delete(lessonProgress).where(where).run()
    else
      tx.update(lessonProgress)
        .set({ skipped: next.skipped, updatedAt: next.updatedAt })
        .where(where)
        .run()
    tx.update(session)
      .set({
        position: { unit: "lesson", lessonId },
        endedAt: null,
        skipUndo: null,
      })
      .where(eq(session.id, row.id))
      .run()
    return { ok: true }
  })
}

/**
 * Puts the lesson a skip moved on to back as it was before the skip, when
 * the session is still on it and it is still where loading put it: at its
 * position from before, or at its first position if it had none. Loading
 * it only set `last_session_id`, cleared `skipped` and gave a new row its
 * first position, so restoring the snapshot undoes exactly that.
 */
function restoreSkippedTo(tx: Tx, row: SessionRow, skipEventId: string) {
  const undo = row.skipUndo
  const pos = row.position
  if (
    !undo?.next ||
    undo.skipEventId !== skipEventId ||
    pos.unit !== "lesson" ||
    pos.lessonId !== undo.next.lessonId ||
    !row.courseId
  )
    return
  const courseId = row.courseId
  const { lessonId, before } = undo.next
  const cp = loadCourseState(tx, courseId)
  const now = readLessonRow(tx, { courseId, lessonId })
  // Still exactly as loading left it: not skipped again, not completed,
  // last loaded in this session (a change from elsewhere since wins).
  if (
    !cp ||
    !now?.position ||
    now.completedAt !== null ||
    now.skipped ||
    now.lastSessionId !== row.id
  )
    return
  const untouched = samePosition(
    now.position,
    before?.position ?? firstLessonPosition(warmupSource(cp, lessonId) !== null)
  )
  if (!untouched) return
  const where = and(
    eq(lessonProgress.courseId, courseId),
    eq(lessonProgress.lessonId, lessonId)
  )
  if (before === null) tx.delete(lessonProgress).where(where).run()
  else tx.update(lessonProgress).set(before).where(where).run()
}
