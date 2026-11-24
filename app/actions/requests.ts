"use server"

import { z } from "zod"

import { requireLearner } from "@/lib/auth/learner"
import {
  insertRequest,
  REQUEST_MAX_CHARS,
  REQUEST_MIN_CHARS,
} from "@/lib/dal/requests"

const RequestText = z
  .string()
  .trim()
  .min(
    REQUEST_MIN_CHARS,
    "Describe what you want to learn in at least 10 characters."
  )
  .max(REQUEST_MAX_CHARS, "Keep it under 2,000 characters.")

export type CreateRequestResult = { ok: true } | { ok: false; error: string }

/**
 * New request (WF-B1). An invalid length returns an inline error. On success
 * the form shows the toast and goes to Today itself (WF-B2).
 */
export async function createRequest(
  text: unknown
): Promise<CreateRequestResult> {
  await requireLearner()
  const parsed = RequestText.safeParse(text)
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message }
  await insertRequest(parsed.data)
  return { ok: true }
}
