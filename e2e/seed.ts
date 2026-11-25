import { randomUUID } from "node:crypto"

import Database from "better-sqlite3"

import { addDays, learningDay } from "../lib/engine/day"

// Seeds learner progress straight into the e2e server's SQLite file, so a
// spec can put Today into any state (WF-A2). The server reads progress on
// every request, so a seed shows on the next page load. Content comes from
// the fixture courses (§10.2).

export const ENC = {
  id: "how-encryption-works",
  title: "How encryption keeps secrets",
  lessons: [
    "symmetric-ciphers",
    "hash-functions",
    "key-exchange",
    "signatures",
  ],
  firstLessonConcepts: ["c-shared-key", "c-kerckhoffs", "c-key-length"],
  checkpoints: [
    "x-secrets-key",
    "x-secrets-bits",
    "x-secrets-vendor",
    "x-secrets-download",
    "x-secrets-spot",
    "x-secrets-short",
    "x-public-clock",
    "x-public-bob",
    "x-public-eavesdrop",
    "x-public-spot",
    "x-public-quantum",
    "x-public-padlock",
  ],
}

export const LEAP = {
  id: "leap-years",
  title: "Why leap years exist",
  lessons: ["leap-rule"],
  concepts: ["c-tropical-year", "c-julian", "c-gregorian-rule"],
  checkpoints: ["x-leap-2100", "x-leap-drift", "x-leap-julian", "x-leap-why"],
}

type Course = { id: string; lessons: string[]; checkpoints: string[] }

/** The server's learning day, `offset` days from today (UTC, test clock at 0). */
export function day(offset = 0): string {
  return addDays(learningDay(Date.now(), "UTC"), offset)
}

/**
 * Epoch ms at noon UTC on `day(offset)`, but never later than now, so a row
 * seeded for today is not in the server's future.
 */
const at = (offset: number) =>
  Math.min(Date.parse(`${day(offset)}T12:00:00Z`), Date.now())

export class Seed {
  private db: Database.Database
  private lastNoteAt = 0

  constructor(path = process.env.PLATO_E2E_DB_PATH!) {
    this.db = new Database(path, { fileMustExist: true })
    this.db.pragma("busy_timeout = 5000")
  }

  close() {
    this.db.close()
  }

  /** Clears all progress and requests, and sets the length back to 15. */
  reset(): this {
    this.db.exec(`
      DELETE FROM lesson_progress;
      DELETE FROM guess_answer;
      DELETE FROM attempt;
      DELETE FROM concept_schedule;
      DELETE FROM answer_note;
      DELETE FROM draft;
      DELETE FROM session;
      DELETE FROM shown_up_day;
      DELETE FROM course_request;
      UPDATE settings SET session_minutes = 15, hide_timer = 0;
    `)
    return this
  }

  shownUp(offset: number): this {
    this.db
      .prepare("INSERT OR IGNORE INTO shown_up_day (day) VALUES (?)")
      .run(day(offset))
    return this
  }

  /** Completes `lessonId` on `day(offset)`. */
  completeLesson(courseId: string, lessonId: string, offset: number): this {
    this.db
      .prepare(
        `INSERT INTO lesson_progress
           (course_id, lesson_id, skipped, position, completed_at, completed_day, updated_at)
         VALUES (?, ?, 0, '{"step":"done"}', ?, ?, ?)`
      )
      .run(courseId, lessonId, at(offset), day(offset), at(offset))
    return this
  }

  /** Starts `lessonId` and leaves it at `position` (§7.3). */
  startLesson(courseId: string, lessonId: string, position: object): this {
    this.db
      .prepare(
        `INSERT INTO lesson_progress
           (course_id, lesson_id, skipped, position, updated_at)
         VALUES (?, ?, 0, ?, ?)`
      )
      .run(courseId, lessonId, JSON.stringify(position), Date.now())
    return this
  }

  /** The lesson's progress row, or undefined when it has none. */
  lessonRow(
    courseId: string,
    lessonId: string
  ): { skipped: number; position: string | null } | undefined {
    return this.db
      .prepare(
        "SELECT skipped, position FROM lesson_progress WHERE course_id = ? AND lesson_id = ?"
      )
      .get(courseId, lessonId) as
      { skipped: number; position: string | null } | undefined
  }

  /** An answer note, stuck after `lessonId` or added on the Answers tab. */
  note(
    courseId: string,
    keyQuestionId: string,
    text: string,
    lessonId: string | null = null
  ): this {
    // Strictly increasing, so notes seeded in one millisecond keep their
    // order (the Answers tab sorts by created_at, then a random id).
    const t = Math.max(Date.now(), this.lastNoteAt + 1)
    this.lastNoteAt = t
    this.db
      .prepare(
        `INSERT INTO answer_note
           (id, course_id, key_question_id, lesson_id, text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), courseId, keyQuestionId, lessonId, text, t, t)
    return this
  }

  /** The course's answer notes' texts, oldest first. */
  notes(courseId: string): string[] {
    return this.db
      .prepare(
        "SELECT text FROM answer_note WHERE course_id = ? ORDER BY created_at, id"
      )
      .pluck()
      .all(courseId) as string[]
  }

  /** A review schedule row for a concept, due on `day(dueOffset)`. */
  schedule(
    courseId: string,
    conceptId: string,
    { due, last }: { due: number; last: number }
  ): this {
    this.db
      .prepare(
        `INSERT INTO concept_schedule
           (course_id, concept_id, lesson_day, due_day, interval_days, ease,
            last_event_day, later_day_reviews, last_grade, version_cursor)
         VALUES (?, ?, ?, ?, 1, 2.5, ?, 0, NULL, 0)`
      )
      .run(courseId, conceptId, day(last), day(due), day(last))
    return this
  }

  /** One answered attempt (a review or a first checkpoint answer). */
  attempt(
    context: "review" | "checkpoint",
    courseId: string,
    opts: { offset: number; conceptId?: string; exerciseId?: string }
  ): this {
    this.db
      .prepare(
        `INSERT INTO attempt
           (id, session_id, context, course_id, concept_id, exercise_id,
            correct, is_retry, day, answered_at)
         VALUES (?, 'seed', ?, ?, ?, ?, 1, 0, ?, ?)`
      )
      .run(
        randomUUID(),
        context,
        courseId,
        opts.conceptId ?? null,
        opts.exerciseId ?? null,
        day(opts.offset),
        at(opts.offset)
      )
    return this
  }

  /** How many sessions have been started. */
  sessionCount(): number {
    return this.db
      .prepare("SELECT count(*) FROM session")
      .pluck()
      .get() as number
  }

  /** The player's rows for one session: its position and answers (§8.4). */
  sessionRow(id: string): { position: string; ended_at: number | null } {
    return this.db
      .prepare("SELECT position, ended_at FROM session WHERE id = ?")
      .get(id) as { position: string; ended_at: number | null }
  }

  /** A draft's text, or undefined when there is none (§6). */
  draft(key: string): string | undefined {
    return this.db
      .prepare("SELECT text FROM draft WHERE key = ?")
      .pluck()
      .get(key) as string | undefined
  }

  /** Review attempts' grades, in answer order. */
  reviewGrades(): string[] {
    return this.db
      .prepare(
        "SELECT grade FROM attempt WHERE context = 'review' ORDER BY answered_at, rowid"
      )
      .pluck()
      .all() as string[]
  }

  /** Every lesson completed and every checkpoint answered. */
  completeCourse(course: Course, offset: number): this {
    for (const l of course.lessons) this.completeLesson(course.id, l, offset)
    for (const x of course.checkpoints)
      this.attempt("checkpoint", course.id, { offset, exerciseId: x })
    return this
  }
}
