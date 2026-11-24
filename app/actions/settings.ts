"use server"

import { refresh } from "next/cache"
import { z } from "zod"

import { requireLearner } from "@/lib/auth/learner"
import { saveHideTimer, saveSessionMinutes } from "@/lib/dal/settings"

const Minutes = z.union([
  z.literal(10),
  z.literal(15),
  z.literal(20),
  z.literal(30),
])

/** Today's length menu. The choice saves immediately (§9.4). */
export async function setSessionMinutes(minutes: unknown): Promise<void> {
  await requireLearner()
  await saveSessionMinutes(Minutes.parse(minutes))
  refresh()
}

/**
 * The player's *Hide timer* / *Show timer*. The frame updates locally, so
 * nothing is refreshed (§8.3).
 */
export async function setHideTimer(hide: unknown): Promise<void> {
  await requireLearner()
  await saveHideTimer(z.boolean().parse(hide))
}
