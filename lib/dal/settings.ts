import "server-only"

import { eq } from "drizzle-orm"

import { requireLearner } from "@/lib/auth/learner"
import { now } from "@/lib/clock"
import { getDb } from "@/lib/db/client"
import { settings } from "@/lib/db/schema"
import type { SessionMinutes } from "@/lib/engine/types"

import { readSettings, type Settings } from "./load"

export type { Settings }

export async function getSettings(): Promise<Settings> {
  await requireLearner()
  return readSettings(getDb())
}

/** The remembered session length (Today's length menu, spec F8). */
export async function saveSessionMinutes(minutes: SessionMinutes) {
  await requireLearner()
  getDb()
    .update(settings)
    .set({ sessionMinutes: minutes, updatedAt: now() })
    .where(eq(settings.id, 1))
    .run()
}

/** *Hide timer* / *Show timer* in the player's ⋯ menu (§9.2). */
export async function saveHideTimer(hide: boolean) {
  await requireLearner()
  getDb()
    .update(settings)
    .set({ hideTimer: hide, updatedAt: now() })
    .where(eq(settings.id, 1))
    .run()
}
