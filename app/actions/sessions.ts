"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { requireLearner } from "@/lib/auth/learner"
import { Id } from "@/lib/content/schema"
import { startNewSession } from "@/lib/dal/sessions"

const StartSession = z.strictObject({
  kind: z.enum(["standard", "reviews_only", "full_lesson"]),
  courseId: Id.optional(),
})

/**
 * **Start session**, **Reviews only**, **Full lesson**, **Start reviews**,
 * **Start Lesson 1** and the course page's main button (§7.7). Opens the
 * player.
 */
export async function startSession(input: unknown): Promise<never> {
  await requireLearner()
  const { id } = await startNewSession(StartSession.parse(input))
  redirect(`/session/${id}`)
}
