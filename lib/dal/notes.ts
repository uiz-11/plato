import "server-only"

import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"

import { requireLearner } from "@/lib/auth/learner"
import { now } from "@/lib/clock"
import { getCourse } from "@/lib/content/load"
import { getDb } from "@/lib/db/client"
import { answerNote } from "@/lib/db/schema"

import { DalError } from "./errors"

/** A note's length limit, checked by the actions' schemas. */
export const NOTE_MAX_CHARS = 2000

// Notes edited on the Answers tab are not progress events (§7.1), so none of
// these records showing up.

/** "+ Add note" on the Answers tab: a note with no lesson (WF-C2). */
export async function insertNote(input: {
  courseId: string
  keyQuestionId: string
  text: string
}): Promise<{ id: string }> {
  await requireLearner()
  const course = getCourse(input.courseId)
  if (!course)
    throw new DalError("unknown_course", `No course ${input.courseId}`)
  if (!course.course.keyQuestions.some((q) => q.id === input.keyQuestionId))
    throw new DalError(
      "unknown_key_question",
      `Course ${input.courseId} has no key question ${input.keyQuestionId}`
    )
  const id = randomUUID()
  const at = now()
  getDb()
    .insert(answerNote)
    .values({
      id,
      courseId: input.courseId,
      keyQuestionId: input.keyQuestionId,
      lessonId: null,
      text: input.text,
      createdAt: at,
      updatedAt: at,
    })
    .run()
  return { id }
}

/**
 * Editing a note that is gone (deleted in another tab) changes nothing; the
 * action's refresh shows that it is gone.
 */
export async function updateNote(input: { id: string; text: string }) {
  await requireLearner()
  getDb()
    .update(answerNote)
    .set({ text: input.text, updatedAt: now() })
    .where(eq(answerNote.id, input.id))
    .run()
}

/** Hard delete (§6). Deleting a note that is already gone is not an error. */
export async function removeNote(input: { id: string }) {
  await requireLearner()
  getDb().delete(answerNote).where(eq(answerNote.id, input.id)).run()
}
