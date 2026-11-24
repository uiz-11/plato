import "server-only"

import { requireLearner } from "@/lib/auth/learner"
import { today } from "@/lib/clock"
import { readNotBuilt, readPublished } from "@/lib/content/load"
import { getDb } from "@/lib/db/client"
import { todayView, type TodayView } from "@/lib/engine/today"
import type { SessionMinutes } from "@/lib/engine/types"

import { loadAssemblyState, readRequests, readSettings, shownUp } from "./load"

/** Today (WF-A1, WF-A2): the card, the rows below it and the counter. */
export interface TodayPageView extends TodayView {
  /** "{n} days you've shown up" (WF-A1.4). */
  shownUpDays: number
  /** The remembered session length, checked in the length menu. */
  minutes: SessionMinutes
}

export async function getTodayView(): Promise<TodayPageView> {
  await requireLearner()
  const db = getDb()
  const day = today()
  const { minutes, shown, state, requests } = db.transaction((tx) => ({
    minutes: readSettings(tx).sessionMinutes,
    shown: shownUp(tx),
    state: loadAssemblyState(tx, day, { publishedOnly: true }),
    requests: readRequests(tx),
  }))
  const view = todayView({
    today: day,
    minutes,
    latestShownUpDay: shown.latest,
    reviewsAnsweredToday: state.reviewsAnsweredToday,
    schedules: state.schedules,
    courses: state.courses,
    requests,
    published: readPublished(),
    notBuilt: readNotBuilt(),
  })
  return { ...view, shownUpDays: shown.days, minutes }
}
