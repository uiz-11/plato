import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { vi } from "vitest"

import { clearContentCache } from "@/lib/content/load"
import type { Db } from "@/lib/db/client"
import { conceptSchedule, lessonProgress } from "@/lib/db/schema"
import type { LessonPosition } from "@/lib/engine/types"

import { createTestDb } from "./db"

// DAL and action tests (§10): a fresh migrated SQLite file as the app's
// database, the fixture content (§10.2) as the content root, and the
// passcode gate off. Files using this also mock `next/headers` and
// `next/cache` (see `nextMocks`).

export const FIXTURE_CONTENT = resolve("e2e/fixtures/content")
export const ENC = "how-encryption-works"
export const LEAP = "leap-years"

const g = globalThis as { __platoDb?: Db }
const tempDirs: string[] = []

/**
 * A copy of the fixture content where only `LEAP` is published, so
 * `ENC` is a draft (listed only with test hooks on). Removed by `close()`.
 */
export function draftContent(): string {
  const root = mkdtempSync(join(tmpdir(), "plato-drafts-"))
  tempDirs.push(root)
  cpSync(FIXTURE_CONTENT, root, { recursive: true })
  writeFileSync(
    join(root, "published.json"),
    JSON.stringify({
      courses: [{ id: LEAP, publishedAt: "2026-11-23T00:00:00Z" }],
    })
  )
  clearContentCache()
  return root
}

export function setupDal(): { db: Db; close: () => void } {
  const t = createTestDb()
  g.__platoDb = t.db
  vi.stubEnv("PLATO_CONTENT_DIR", FIXTURE_CONTENT)
  vi.stubEnv("PLATO_PASSCODE", "")
  vi.stubEnv("PLATO_COOKIE_SECRET", "")
  vi.stubEnv("PLATO_TEST_HOOKS", "")
  vi.stubEnv("PLATO_TIME_ZONE", "UTC")
  clearContentCache()
  return {
    db: t.db,
    close() {
      delete g.__platoDb
      t.close()
      for (const dir of tempDirs.splice(0))
        rmSync(dir, { recursive: true, force: true })
      vi.unstubAllEnvs()
    },
  }
}

/** Turns the passcode gate on. Requests carry no cookie, so they are refused. */
export function lockGate(): void {
  vi.stubEnv("PLATO_PASSCODE", "a-test-passcode-of-enough-length")
  vi.stubEnv("PLATO_COOKIE_SECRET", "a-test-secret")
}

/** Fakes only `Date`, so `now()` and `today()` are fixed. */
export function setNow(iso: string): number {
  const ms = Date.parse(iso)
  vi.useFakeTimers({ toFake: ["Date"], now: ms })
  return ms
}

/** A lesson row, completed on `day` unless a position is given. */
export function putLesson(
  db: Db,
  courseId: string,
  lessonId: string,
  opts: {
    at: number
    day?: string
    position?: LessonPosition
    skipped?: boolean
    lastSessionId?: string
  }
): void {
  const completed = opts.position === undefined
  db.insert(lessonProgress)
    .values({
      courseId,
      lessonId,
      skipped: opts.skipped ?? false,
      position: opts.position ?? { step: "done" },
      lastSessionId: opts.lastSessionId ?? null,
      completedAt: completed ? opts.at : null,
      completedDay: completed ? (opts.day ?? null) : null,
      updatedAt: opts.at,
    })
    .run()
}

/** A schedule row for a concept. */
export function putSchedule(
  db: Db,
  courseId: string,
  conceptId: string,
  row: Partial<typeof conceptSchedule.$inferInsert> & {
    dueDay: string
    lastEventDay: string
  }
): void {
  db.insert(conceptSchedule)
    .values({
      courseId,
      conceptId,
      lessonDay: row.lastEventDay,
      intervalDays: 1,
      ease: 2.5,
      laterDayReviews: 0,
      lastGrade: null,
      versionCursor: 0,
      ...row,
    })
    .run()
}
