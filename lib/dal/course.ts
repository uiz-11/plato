import "server-only"

import type { Root as HastRoot } from "hast"
import { asc, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { cache } from "react"

import { requireLearner } from "@/lib/auth/learner"
import { today } from "@/lib/clock"
import { getRenderedCourse } from "@/lib/content/render"
import { getDb } from "@/lib/db/client"
import { answerNote, conceptSchedule } from "@/lib/db/schema"
import {
  checkpointRowLabel,
  completedLabel,
  COURSE_STATUS_LABEL,
  mainButtonLabel,
  plural,
  syllabusLessonLabel,
} from "@/lib/engine/labels"
import {
  mastery,
  MASTERY_DOTS,
  MASTERY_LABEL,
  type Mastery,
} from "@/lib/engine/mastery"
import {
  checkpointNumber,
  checkpointStatus,
  completedCount,
  courseStatus,
  lessonNumber,
  nextTarget,
  statusOf,
  type CheckpointStatus,
  type CourseStatus,
  type LessonStatus,
} from "@/lib/engine/status"

import { loadCourseState, type CourseState } from "./load"

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] // prettier-ignore

/** `YYYY-MM` → "Nov 2026" (WF-C1). */
export function formatAsOf(asOf: string): string {
  const [y, m] = asOf.split("-")
  return `${MONTHS[Number(m) - 1]} ${y}`
}

/** The course, or a 404 for an unknown id (§8.1). */
async function courseOr404(courseId: string): Promise<CourseState> {
  await requireLearner()
  const c = loadCourseState(getDb(), courseId)
  if (!c) notFound()
  return c
}

// --- Header (WF-C1) ---------------------------------------------------------

export interface CourseHeaderView {
  courseId: string
  title: string
  coverLabel: string
  status: CourseStatus
  /** "in progress" or "complete", lowercase as in WF-C1; null for *Ready*. */
  badge: string | null
  /** "{n} lessons · {length} · as of {Mon YYYY}" */
  meta: string
  /**
   * The main button (§7.6): it starts a `standard` session on this course.
   * Null for a *Complete* course, or one with nothing left to target.
   */
  mainButton: { label: string } | null
}

/**
 * Memoized per request: the layout and its `generateMetadata` both need it.
 */
export const getCourseHeader = cache(async function getCourseHeader(
  courseId: string
): Promise<CourseHeaderView> {
  const c = await courseOr404(courseId)
  const status = courseStatus(c)
  const label = mainButtonLabel(c, status, nextTarget(c))
  return {
    courseId,
    title: c.course.title,
    coverLabel: c.course.coverLabel,
    status,
    badge:
      status === "ready" ? null : COURSE_STATUS_LABEL[status].toLowerCase(),
    meta: [
      plural(c.loaded.lessonCount, "lesson"),
      c.loaded.lengthLabel,
      `as of ${formatAsOf(c.course.asOf)}`,
    ].join(" · "),
    mainButton: label ? { label } : null,
  }
})

// --- Syllabus (WF-C1) -------------------------------------------------------

export interface ConceptMastery {
  conceptId: string
  statement: string
  mastery: Mastery
  label: string
  /** Filled dots out of four. */
  dots: number
}

export interface SyllabusLesson {
  lessonId: string
  number: number
  title: string
  status: LessonStatus
  /** "Completed", "In progress · at Recall", … */
  statusLabel: string
  /** The concepts' mastery, for a *Completed* lesson's disclosure. */
  mastery: ConceptMastery[] | null
  /** What the ⋯ menu offers (§9.4). */
  menu: "skip" | "unskip" | null
}

export interface SyllabusModule {
  moduleId: string
  title: string
  lessons: SyllabusLesson[]
  checkpoint: {
    number: number
    status: CheckpointStatus
    /** "Locked · complete Lesson 3", "Open", … */
    label: string
  }
}

export interface SyllabusView {
  /** "{k} of {n} completed" */
  completed: string
  outOfScope: HastRoot
  policyNote: HastRoot | null
  modules: SyllabusModule[]
}

export async function getSyllabusView(courseId: string): Promise<SyllabusView> {
  const c = await courseOr404(courseId)
  const day = today()
  const schedules = new Map(
    getDb()
      .select()
      .from(conceptSchedule)
      .where(eq(conceptSchedule.courseId, courseId))
      .all()
      .map((r) => [r.conceptId, r])
  )
  const rendered = getRenderedCourse(courseId)
  if (!rendered) notFound()
  const { completed, total } = completedCount(c)

  const conceptMastery = (lessonId: string): ConceptMastery[] =>
    c.loaded.lessonsById.get(lessonId)!.lesson.concepts.map((k) => {
      const row = schedules.get(k.id)
      // A completed lesson always has rows (§7.4); none reads as not reviewed.
      const m: Mastery = row ? mastery(row, day) : "not_yet_reviewed"
      return {
        conceptId: k.id,
        statement: k.statement,
        mastery: m,
        label: MASTERY_LABEL[m],
        dots: MASTERY_DOTS[m],
      }
    })

  return {
    completed: completedLabel(completed, total),
    outOfScope: rendered.outOfScope,
    policyNote: rendered.policyNote,
    modules: c.course.modules.map((m) => ({
      moduleId: m.id,
      title: m.title,
      lessons: m.lessons.map((id) => {
        const status = statusOf(c, id)
        return {
          lessonId: id,
          number: lessonNumber(c.course, id),
          title: c.loaded.lessonsById.get(id)!.lesson.title,
          status,
          statusLabel: syllabusLessonLabel(
            status,
            c.lessons.get(id)?.position ?? null
          ),
          mastery: status === "completed" ? conceptMastery(id) : null,
          menu:
            status === "skipped"
              ? "unskip"
              : status === "completed"
                ? null
                : "skip",
        }
      }),
      checkpoint: {
        number: checkpointNumber(c.course, m.id),
        status: checkpointStatus(c, m.id),
        label: checkpointRowLabel(c, m.id),
      },
    })),
  }
}

// --- Answers (WF-C2) --------------------------------------------------------

export interface AnswerNoteView {
  id: string
  text: string
  lessonId: string | null
  /** "Lesson 2" for a note stuck in a lesson; null when added on this tab. */
  lessonLabel: string | null
  createdAt: number
  updatedAt: number
}

export interface AnswersView {
  keyQuestions: Array<{
    id: string
    text: string
    /** "Lessons 1, 2, 3, 7": the lessons that advance it. */
    lessons: string
    /** Oldest first. */
    notes: AnswerNoteView[]
  }>
}

/** "Lesson 2" or "Lessons 1, 2, 3, 7". */
export function lessonListLabel(numbers: readonly number[]): string {
  if (numbers.length === 0) return ""
  return `${numbers.length === 1 ? "Lesson" : "Lessons"} ${numbers.join(", ")}`
}

export async function getAnswersView(courseId: string): Promise<AnswersView> {
  const c = await courseOr404(courseId)
  const notes = getDb()
    .select()
    .from(answerNote)
    .where(eq(answerNote.courseId, courseId))
    .orderBy(asc(answerNote.createdAt), asc(answerNote.id))
    .all()
  const lessonOrder = c.loaded.lessons.map((l) => l.lesson)
  return {
    keyQuestions: c.course.keyQuestions.map((q) => ({
      id: q.id,
      text: q.text,
      lessons: lessonListLabel(
        lessonOrder
          .filter((l) => l.keyQuestions.includes(q.id))
          .map((l) => lessonNumber(c.course, l.id))
      ),
      notes: notes
        .filter((n) => n.keyQuestionId === q.id)
        .map((n) => ({
          id: n.id,
          text: n.text,
          lessonId: n.lessonId,
          lessonLabel:
            n.lessonId && c.loaded.lessonsById.has(n.lessonId)
              ? `Lesson ${lessonNumber(c.course, n.lessonId)}`
              : null,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        })),
    })),
  }
}

// --- Sources (WF-C3) --------------------------------------------------------

export interface SourceView {
  id: string
  /** Its position in the course's source list; the row's anchor is `s<n>`. */
  number: number
  anchor: string
  title: string
  publisher: string
  date: string
  url: string
  position: string | null
}

export interface SourcesView {
  /** Grouped by `group`, in first-appearance order. */
  groups: Array<{ group: string; sources: SourceView[] }>
}

export async function getSourcesView(courseId: string): Promise<SourcesView> {
  const c = await courseOr404(courseId)
  const groups = new Map<string, SourceView[]>()
  for (const s of c.course.sources) {
    const number = c.loaded.sourceNumbers.get(s.id)!
    const list = groups.get(s.group) ?? []
    list.push({
      id: s.id,
      number,
      anchor: `s${number}`,
      title: s.title,
      publisher: s.publisher,
      date: s.date,
      url: s.url,
      position: s.position ?? null,
    })
    groups.set(s.group, list)
  }
  return {
    groups: [...groups].map(([group, sources]) => ({ group, sources })),
  }
}
