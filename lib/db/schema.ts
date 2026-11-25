// Drizzle table definitions (§6). Times are epoch milliseconds (`*_at`),
// learning days are `YYYY-MM-DD` text (`*_day`), and content ids are text.
//
// No `import 'server-only'` here, unlike the rest of lib/db: drizzle-kit loads
// this file in plain Node, where that package throws. It holds no I/O.
import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import type {
  AttemptContext,
  Confidence,
  Grade,
  LessonPosition,
  SelfMark,
  SessionKind,
  SessionMinutes,
  SessionPosition,
} from "@/lib/engine/types"

const ms = (name: string) => integer(name)
const bool = (name: string) => integer(name, { mode: "boolean" })

// One row, id 1, seeded by migration 0001 with the defaults.
export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey(),
    sessionMinutes: integer("session_minutes")
      .$type<SessionMinutes>()
      .notNull()
      .default(15),
    hideTimer: bool("hide_timer").notNull().default(false),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    check("settings_one_row", sql`${t.id} = 1`),
    check(
      "settings_session_minutes",
      sql`${t.sessionMinutes} IN (10, 15, 20, 30)`
    ),
  ]
)

export const courseRequest = sqliteTable("course_request", {
  id: text("id").primaryKey(), // UUID
  text: text("text").notNull(),
  createdAt: ms("created_at").notNull(),
})

export const lessonProgress = sqliteTable(
  "lesson_progress",
  {
    courseId: text("course_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    skipped: bool("skipped").notNull().default(false),
    position: text("position", { mode: "json" }).$type<LessonPosition>(),
    recallText: text("recall_text"),
    recallTicked: text("recall_ticked", { mode: "json" }).$type<string[]>(),
    recallQueue: text("recall_queue", { mode: "json" }).$type<string[]>(),
    lastSessionId: text("last_session_id"),
    completedAt: ms("completed_at"),
    completedDay: text("completed_day"),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.courseId, t.lessonId] })]
)

export const guessAnswer = sqliteTable(
  "guess_answer",
  {
    courseId: text("course_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    guessId: text("guess_id").notNull(),
    optionId: text("option_id").notNull(),
    answeredAt: ms("answered_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.courseId, t.lessonId, t.guessId] })]
)

export const attempt = sqliteTable(
  "attempt",
  {
    id: text("id").primaryKey(), // client UUID, so a re-sent event is idempotent
    sessionId: text("session_id").notNull(),
    context: text("context").$type<AttemptContext>().notNull(),
    courseId: text("course_id").notNull(),
    conceptId: text("concept_id"), // null for checkpoint
    exerciseId: text("exercise_id"), // null for a recall prompt
    response: text("response", { mode: "json" }).$type<unknown>(),
    correct: bool("correct"), // null when self-rated or self-marked
    confidence: text("confidence").$type<Confidence>(),
    selfMark: text("self_mark").$type<SelfMark>(),
    grade: text("grade").$type<Grade>(),
    isRetry: bool("is_retry").notNull().default(false),
    day: text("day").notNull(),
    answeredAt: ms("answered_at").notNull(),
  },
  (t) => [
    index("attempt_course_exercise").on(t.courseId, t.exerciseId),
    index("attempt_context_day").on(t.context, t.day),
    index("attempt_session").on(t.sessionId),
  ]
)

export const conceptSchedule = sqliteTable(
  "concept_schedule",
  {
    courseId: text("course_id").notNull(),
    conceptId: text("concept_id").notNull(),
    lessonDay: text("lesson_day").notNull(),
    dueDay: text("due_day").notNull(),
    intervalDays: integer("interval_days").notNull(),
    ease: real("ease").notNull(),
    lastEventDay: text("last_event_day").notNull(),
    laterDayReviews: integer("later_day_reviews").notNull().default(0),
    lastGrade: text("last_grade").$type<Grade>(),
    versionCursor: integer("version_cursor").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.courseId, t.conceptId] }),
    index("concept_schedule_due_day").on(t.dueDay),
  ]
)

export const answerNote = sqliteTable(
  "answer_note",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    keyQuestionId: text("key_question_id").notNull(),
    lessonId: text("lesson_id"), // null when added on the Answers tab
    text: text("text").notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    index("answer_note_course_kq_created").on(
      t.courseId,
      t.keyQuestionId,
      t.createdAt
    ),
  ]
)

export const draft = sqliteTable("draft", {
  // `recall:<course>:<lesson>`, `short:<course>:<exercise>` or
  // `note:<course>:<lesson>:<kq>`
  key: text("key").primaryKey(),
  text: text("text").notNull(),
  updatedAt: ms("updated_at").notNull(),
})

/**
 * The player's last skip (§7.3): its event id, and the lesson it moved on to
 * with that lesson's progress row before the skip (null when it had none).
 */
export interface SkipUndo {
  skipEventId: string
  next: {
    lessonId: string
    before: typeof lessonProgress.$inferSelect | null
  } | null
}

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<SessionKind>().notNull(),
    minutes: integer("minutes").$type<SessionMinutes>().notNull(),
    courseId: text("course_id"), // null for a session without a target
    reviewQueue: text("review_queue", { mode: "json" })
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'`),
    checkpointQueue: text("checkpoint_queue", { mode: "json" }).$type<
      string[]
    >(),
    position: text("position", { mode: "json" })
      .$type<SessionPosition>()
      .notNull(),
    lastEventId: text("last_event_id"),
    // What the player's last *Mark as skipped* moved on to, so its Undo can
    // put that lesson back as it was (§7.3).
    skipUndo: text("skip_undo", { mode: "json" }).$type<SkipUndo>(),
    activeMs: integer("active_ms").notNull().default(0),
    startedAt: ms("started_at").notNull(),
    endedAt: ms("ended_at"),
  },
  (t) => [
    // At most one open session (§6).
    uniqueIndex("session_one_open")
      .on(sql`(1)`)
      .where(sql`${t.endedAt} IS NULL`),
  ]
)

export const shownUpDay = sqliteTable("shown_up_day", {
  day: text("day").primaryKey(),
})
