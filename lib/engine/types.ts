// Shapes the engine and the database share. The DB schema imports these to
// type its JSON columns; the engine never imports the DB (§3.1).

/** The finest resumable point inside a lesson (§7.3). */
export type LessonPosition =
  | { step: "warmup"; index: number }
  | { step: "guess"; index: number }
  | { step: "read" }
  | { step: "recall"; phase: "write" }
  | { step: "recall"; phase: "tick" }
  | { step: "recall"; phase: "exercises"; index: number; answered?: string }
  | { step: "answers"; index: number } // index into the lesson's key questions
  | { step: "done" }

/** Where a session is (§7.7). Lesson detail lives in `LessonPosition`. */
export type SessionPosition =
  | { unit: "reviews"; index: number; answered?: string }
  | { unit: "lesson"; lessonId: string }
  | { unit: "checkpoint"; moduleId: string; index: number; answered?: string }
  | { unit: "end"; screen: "course-complete" | "summary" }

/** The session lengths a learner can choose (spec F8). */
export type SessionMinutes = 10 | 15 | 20 | 30

export type SessionKind = "standard" | "reviews_only" | "full_lesson"
export type AttemptContext = "recall" | "review" | "checkpoint"
export type Confidence = "sure" | "not_sure" | "guess"
export type SelfMark = "full" | "partial" | "none"
export type Grade = "forgot" | "partly" | "remembered"
