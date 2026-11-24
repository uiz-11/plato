import "server-only"

import { and, eq } from "drizzle-orm"

import { requireLearner } from "@/lib/auth/learner"
import { now, today } from "@/lib/clock"
import { getCourse } from "@/lib/content/load"
import { getDb } from "@/lib/db/client"
import { lessonProgress } from "@/lib/db/schema"
import {
  skipLesson as skipRule,
  unskipLesson as unskipRule,
} from "@/lib/engine/lesson"
import { lessonStatus } from "@/lib/engine/status"

import { DalError } from "./errors"
import {
  fromLessonProgress,
  readLessonRow,
  recordShownUp,
  type LessonRef,
} from "./load"

export type { LessonRef }

function assertLesson({ courseId, lessonId }: LessonRef): void {
  const course = getCourse(courseId)
  if (!course) throw new DalError("unknown_course", `No course ${courseId}`)
  if (!course.lessonsById.has(lessonId))
    throw new DalError(
      "unknown_lesson",
      `Course ${courseId} has no lesson ${lessonId}`
    )
}

/**
 * *Mark as skipped* from the Syllabus (§7.3). A Syllabus skip is a progress
 * event, so it records showing up (§7.1).
 *
 * A lesson that is already *Skipped* or *Completed* is left as it is: the menu
 * that sent this was stale (a double click, a second tab), and the action's
 * refresh shows the true state.
 */
export async function skipLessonFromSyllabus(ref: LessonRef): Promise<void> {
  await requireLearner()
  assertLesson(ref)
  const at = now()
  const day = today(at)
  getDb().transaction((tx) => {
    const current = readLessonRow(tx, ref)
    const status = lessonStatus(current)
    if (status === "skipped" || status === "completed") return
    const next = skipRule(current, ref.lessonId, { now: at })
    const row = fromLessonProgress(ref.courseId, next)
    tx.insert(lessonProgress)
      .values(row)
      .onConflictDoUpdate({
        target: [lessonProgress.courseId, lessonProgress.lessonId],
        set: { skipped: row.skipped, updatedAt: row.updatedAt },
      })
      .run()
    recordShownUp(tx, day)
  })
}

/**
 * *Unskip* from the Syllabus (§7.3): clears `skipped`, or deletes the row
 * when the skip created it. Not a progress event. A lesson that is no longer
 * *Skipped* is left as it is (a stale menu, as for skipping).
 */
export async function unskipLessonFromSyllabus(ref: LessonRef): Promise<void> {
  await requireLearner()
  assertLesson(ref)
  const at = now()
  getDb().transaction((tx) => {
    const current = readLessonRow(tx, ref)
    if (lessonStatus(current) !== "skipped") return
    const next = unskipRule(current, at)
    const where = and(
      eq(lessonProgress.courseId, ref.courseId),
      eq(lessonProgress.lessonId, ref.lessonId)
    )
    if (next === null) tx.delete(lessonProgress).where(where).run()
    else
      tx.update(lessonProgress)
        .set({ skipped: next.skipped, updatedAt: next.updatedAt })
        .where(where)
        .run()
  })
}
