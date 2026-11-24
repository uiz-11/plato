import "server-only"

import { requireLearner } from "@/lib/auth/learner"
import { readNotBuilt, readPublished } from "@/lib/content/load"
import { getDb } from "@/lib/db/client"
import { completedLabel } from "@/lib/engine/labels"
import { completedCount, courseStatus } from "@/lib/engine/status"
import { todayRows } from "@/lib/engine/today"

import { loadCourseStates, readRequests } from "./load"

export interface LibraryCourseCard {
  courseId: string
  title: string
  coverLabel: string
  meta: string
}

/** Library (WF-H1): the sections in their display order. */
export interface LibraryView {
  /** Most recently used first. */
  inProgress: LibraryCourseCard[]
  /** Newest published first. */
  ready: LibraryCourseCard[]
  /** "n of n completed ✓", most recently used first. */
  complete: LibraryCourseCard[]
  /** *Requested* and *Not built* requests, newest first. */
  requested: Array<{ id: string; text: string; reason?: string }>
}

export async function getLibraryView(): Promise<LibraryView> {
  await requireLearner()
  const db = getDb()
  const { courses, requests } = db.transaction((tx) => ({
    courses: loadCourseStates(tx, { publishedOnly: true }),
    requests: readRequests(tx),
  }))
  const rows = todayRows({
    courses,
    requests,
    published: readPublished(),
    notBuilt: readNotBuilt(),
  })
  const cover = new Map(courses.map((c) => [c.course.id, c.course.coverLabel]))
  const card = (r: { courseId: string; title: string; meta: string }) => ({
    ...r,
    coverLabel: cover.get(r.courseId) ?? "",
  })
  const complete = courses
    .filter((c) => courseStatus(c) === "complete")
    .sort((a, b) => (b.lastUsedAt ?? -Infinity) - (a.lastUsedAt ?? -Infinity))
    .map((c) => {
      const { completed, total } = completedCount(c)
      return {
        courseId: c.course.id,
        title: c.course.title,
        coverLabel: c.course.coverLabel,
        meta: `${completedLabel(completed, total)} ✓`,
      }
    })
  return {
    inProgress: rows.inProgress.map(card),
    ready: rows.ready.map(card),
    complete,
    requested: rows.requested,
  }
}
