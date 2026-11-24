import "server-only"

// Shared loaders for the DAL: progress rows read from SQLite and joined with
// content into the shapes the engine takes. Internal to lib/dal. These take a
// `Db` (or a transaction) and do not call `requireLearner()`; the exported
// DAL functions that use them do.

import { and, count, eq, isNotNull, max, type Column } from "drizzle-orm"

import { listCourses, type LoadedCourse } from "@/lib/content/load"
import type { Db } from "@/lib/db/client"
import {
  attempt,
  conceptSchedule,
  courseRequest,
  lessonProgress,
  session,
  settings,
  shownUpDay,
} from "@/lib/db/schema"
import type { ScheduleRow } from "@/lib/engine/schedule"
import { lastUsedAt, type LessonProgress } from "@/lib/engine/status"
import type { TodayCourse } from "@/lib/engine/today"
import type { Day, SessionMinutes } from "@/lib/engine/types"

/** A transaction handle has the same query API as the database. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export type Conn = Db | Tx

export type LessonRow = typeof lessonProgress.$inferSelect

/** A DB row as the engine sees it (without `courseId`). */
export function toLessonProgress(row: LessonRow): LessonProgress {
  return {
    lessonId: row.lessonId,
    skipped: row.skipped,
    position: row.position ?? null,
    recallText: row.recallText,
    recallTicked: row.recallTicked ?? null,
    recallQueue: row.recallQueue ?? null,
    lastSessionId: row.lastSessionId,
    completedAt: row.completedAt,
    completedDay: row.completedDay,
    updatedAt: row.updatedAt,
  }
}

/** The engine's row back as DB columns. */
export function fromLessonProgress(
  courseId: string,
  p: LessonProgress
): LessonRow {
  return { courseId, ...p }
}

/** A course with its content and progress, as session assembly and Today see it. */
export interface CourseState extends TodayCourse {
  loaded: LoadedCourse
}

export interface CourseStateOptions {
  /** Only this course, reading only its rows. */
  courseId?: string
  /**
   * Leave out drafts (loaded only with test hooks on, §5.1). Today and the
   * Library list published courses only.
   */
  publishedOnly?: boolean
}

/**
 * Every listed course (published, plus drafts with test hooks on) with the
 * learner's progress in it.
 */
export function loadCourseStates(
  db: Conn,
  opts: CourseStateOptions = {}
): CourseState[] {
  const courses = listCourses().filter(
    (c) =>
      (opts.courseId === undefined || c.id === opts.courseId) &&
      (!opts.publishedOnly || c.published !== null)
  )
  if (courses.length === 0) return []
  const forCourse = (col: Column) =>
    opts.courseId === undefined ? undefined : eq(col, opts.courseId)

  const lessonRows = db
    .select()
    .from(lessonProgress)
    .where(forCourse(lessonProgress.courseId))
    .all()
  const answered = db
    .selectDistinct({
      courseId: attempt.courseId,
      exerciseId: attempt.exerciseId,
    })
    .from(attempt)
    .where(
      and(
        eq(attempt.context, "checkpoint"),
        eq(attempt.isRetry, false),
        isNotNull(attempt.exerciseId),
        forCourse(attempt.courseId)
      )
    )
    .all()
  const sessions = db
    .select({ courseId: session.courseId, startedAt: max(session.startedAt) })
    .from(session)
    .where(and(isNotNull(session.courseId), forCourse(session.courseId)))
    .groupBy(session.courseId)
    .all()

  return courses.map((loaded) =>
    courseState(loaded, lessonRows, answered, sessions)
  )
}

function courseState(
  loaded: LoadedCourse,
  lessonRows: readonly LessonRow[],
  answered: ReadonlyArray<{ courseId: string; exerciseId: string | null }>,
  sessions: ReadonlyArray<{ courseId: string | null; startedAt: number | null }>
): CourseState {
  const id = loaded.id
  const lessons = new Map<string, LessonProgress>()
  for (const row of lessonRows) {
    // Rows for lessons no longer in the course are ignored.
    if (row.courseId === id && loaded.lessonsById.has(row.lessonId))
      lessons.set(row.lessonId, toLessonProgress(row))
  }
  const started = sessions
    .filter((s) => s.courseId === id && s.startedAt !== null)
    .map((s) => s.startedAt as number)
  return {
    loaded,
    course: loaded.course,
    lessons,
    checkpointAnswered: new Set(
      answered
        .filter((a) => a.courseId === id && a.exerciseId !== null)
        .map((a) => a.exerciseId as string)
    ),
    lastUsedAt: lastUsedAt(lessons.values(), started),
    hadSession: started.length > 0,
    // Drafts (test hooks only) sort as published at the epoch.
    publishedAt: loaded.published?.publishedAt ?? "1970-01-01T00:00:00Z",
    length: loaded.lengthLabel,
  }
}

/** One course's state, or null when it is not listed. */
export function loadCourseState(
  db: Conn,
  courseId: string
): CourseState | null {
  return loadCourseStates(db, { courseId })[0] ?? null
}

/** Schedule rows of the listed courses whose concept still exists in content. */
export function loadSchedules(
  db: Conn,
  courses: readonly Pick<CourseState, "loaded">[]
): ScheduleRow[] {
  const concepts = new Map<string, Set<string>>()
  for (const { loaded } of courses) {
    concepts.set(
      loaded.id,
      new Set(loaded.lessons.flatMap((l) => l.lesson.concepts.map((c) => c.id)))
    )
  }
  return db
    .select()
    .from(conceptSchedule)
    .all()
    .filter((r) => concepts.get(r.courseId)?.has(r.conceptId))
}

/** Non-retry review items answered on `day`, across courses (the daily cap, §7.4). */
export function reviewsAnsweredOn(db: Conn, day: Day): number {
  const [row] = db
    .select({ n: count() })
    .from(attempt)
    .where(
      and(
        eq(attempt.context, "review"),
        eq(attempt.day, day),
        eq(attempt.isRetry, false)
      )
    )
    .all()
  return row?.n ?? 0
}

/** The shown-up counter (WF-A1.4) and the latest shown-up day. */
export function shownUp(db: Conn): { days: number; latest: Day | null } {
  const [row] = db
    .select({ days: count(), latest: max(shownUpDay.day) })
    .from(shownUpDay)
    .all()
  return { days: row?.days ?? 0, latest: row?.latest ?? null }
}

/** Records showing up on `day` (§7.1). Call with every progress event. */
export function recordShownUp(db: Conn, day: Day): void {
  db.insert(shownUpDay).values({ day }).onConflictDoNothing().run()
}

/** Everything session assembly and Today read, in one place. */
export function loadAssemblyState(
  db: Conn,
  day: Day,
  opts: Pick<CourseStateOptions, "publishedOnly"> = {}
) {
  const courses = loadCourseStates(db, opts)
  return {
    courses,
    schedules: loadSchedules(db, courses),
    reviewsAnsweredToday: reviewsAnsweredOn(db, day),
  }
}

export interface Settings {
  sessionMinutes: SessionMinutes
  hideTimer: boolean
}

/** The one settings row, seeded by migration 0001 (§6). */
export function readSettings(db: Conn): Settings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get()
  if (!row) throw new Error("The settings row is missing")
  return { sessionMinutes: row.sessionMinutes, hideTimer: row.hideTimer }
}

/** Every course request; their statuses are derived (§7.9). */
export function readRequests(db: Conn) {
  return db
    .select({
      id: courseRequest.id,
      text: courseRequest.text,
      createdAt: courseRequest.createdAt,
    })
    .from(courseRequest)
    .all()
}

export interface LessonRef {
  courseId: string
  lessonId: string
}

/** One lesson's progress row, or undefined for *Not started*. */
export function readLessonRow(db: Conn, { courseId, lessonId }: LessonRef) {
  const row = db
    .select()
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.courseId, courseId),
        eq(lessonProgress.lessonId, lessonId)
      )
    )
    .get()
  return row ? toLessonProgress(row) : undefined
}
