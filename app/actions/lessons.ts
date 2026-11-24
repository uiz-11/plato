"use server"

import { refresh } from "next/cache"
import { z } from "zod"

import { requireLearner } from "@/lib/auth/learner"
import { Id } from "@/lib/content/schema"
import {
  skipLessonFromSyllabus,
  unskipLessonFromSyllabus,
} from "@/lib/dal/lessons"

const LessonRef = z.strictObject({ courseId: Id, lessonId: Id })

/** *Mark as skipped* in the Syllabus ⋯ menu (§7.3). */
export async function skipLesson(input: unknown): Promise<void> {
  await requireLearner()
  await skipLessonFromSyllabus(LessonRef.parse(input))
  refresh()
}

/** *Unskip* in the Syllabus ⋯ menu (§7.3). */
export async function unskipLesson(input: unknown): Promise<void> {
  await requireLearner()
  await unskipLessonFromSyllabus(LessonRef.parse(input))
  refresh()
}
