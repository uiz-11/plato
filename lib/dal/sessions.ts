import "server-only"

import { randomUUID } from "node:crypto"

import { isNull } from "drizzle-orm"

import { requireLearner } from "@/lib/auth/learner"
import { now, today } from "@/lib/clock"
import { getDb } from "@/lib/db/client"
import { session } from "@/lib/db/schema"
import { reviewVersions, type ScheduleRow } from "@/lib/engine/schedule"
import {
  assembleSession,
  initialSessionPosition,
  reviewQueueItem,
  type ReviewQueueItem,
} from "@/lib/engine/session"
import { checkpointQueue, moduleById } from "@/lib/engine/status"
import type { SessionKind } from "@/lib/engine/types"

import { DalError } from "./errors"
import { loadAssemblyState, readSettings, type CourseState } from "./load"

export interface StartSessionInput {
  kind: SessionKind
  /** The course page's main button, or Today's "Start Lesson 1" (§7.7). */
  courseId?: string
}

function reviewItem(
  courses: readonly CourseState[],
  row: ScheduleRow
): ReviewQueueItem {
  const c = courses.find((c) => c.course.id === row.courseId)
  const lesson = c?.loaded.lessons.find((l) =>
    l.lesson.concepts.some((k) => k.id === row.conceptId)
  )
  // loadSchedules keeps only rows whose concept is in content.
  if (!lesson)
    throw new Error(`No lesson teaches ${row.courseId}:${row.conceptId}`)
  return reviewQueueItem(row, reviewVersions(lesson.lesson, row.conceptId))
}

/**
 * Starts a session (§7.7): closes any open session, assembles the reviews and
 * the target with the remembered length, and inserts the row. A session with
 * nothing in it starts at its end screen and is closed at once. Lesson rows
 * are created later, when the lesson's first unit loads.
 */
export async function startNewSession(
  input: StartSessionInput
): Promise<{ id: string }> {
  await requireLearner()
  const at = now()
  const day = today(at)
  const id = randomUUID()
  getDb().transaction((tx) => {
    const { sessionMinutes: minutes } = readSettings(tx)
    // Without a course id the session continues what Today shows, so drafts
    // are left out as they are there. A draft is started only by its id.
    const state = loadAssemblyState(tx, day, {
      publishedOnly: input.courseId === undefined,
    })
    if (
      input.courseId !== undefined &&
      !state.courses.some((c) => c.course.id === input.courseId)
    )
      throw new DalError("unknown_course", `No course ${input.courseId}`)

    tx.update(session).set({ endedAt: at }).where(isNull(session.endedAt)).run()

    const a = assembleSession({
      kind: input.kind,
      minutes,
      today: day,
      courseId: input.courseId,
      schedules: state.schedules,
      reviewsAnsweredToday: state.reviewsAnsweredToday,
      courses: state.courses,
    })
    const reviewQueue = a.reviews.map((r) => reviewItem(state.courses, r))
    const course = state.courses.find((c) => c.course.id === a.courseId)
    const cpQueue =
      a.target?.kind === "checkpoint" && course
        ? checkpointQueue(
            moduleById(course.course, a.target.moduleId),
            course.checkpointAnswered
          )
        : null
    const position = initialSessionPosition({
      reviews: reviewQueue,
      target: a.target,
    })
    tx.insert(session)
      .values({
        id,
        kind: input.kind,
        minutes,
        courseId: a.courseId,
        reviewQueue,
        checkpointQueue: cpQueue,
        position,
        lastEventId: null,
        activeMs: 0,
        startedAt: at,
        // Entering the end screens ends a session (§7.7).
        endedAt: position.unit === "end" ? at : null,
      })
      .run()
  })
  return { id }
}
