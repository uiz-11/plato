import "server-only"

import { randomUUID } from "node:crypto"

import { requireLearner } from "@/lib/auth/learner"
import { now } from "@/lib/clock"
import { getDb } from "@/lib/db/client"
import { courseRequest } from "@/lib/db/schema"

/** A request's length limits (§8.3), checked by the action's schema. */
export const REQUEST_MIN_CHARS = 10
export const REQUEST_MAX_CHARS = 2000

/** Inserts a course request (spec F1). Its status is derived (§7.9). */
export async function insertRequest(text: string): Promise<{ id: string }> {
  await requireLearner()
  const id = randomUUID()
  getDb().insert(courseRequest).values({ id, text, createdAt: now() }).run()
  return { id }
}
