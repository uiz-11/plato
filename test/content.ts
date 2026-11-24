import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { stringify } from "yaml"

import type { Course, Lesson } from "@/lib/content/schema"

// Small in-memory course data for schema and loader tests. The real fixture
// courses are T05's (§10.2).

const opts = (prefix: string) => [
  { id: `${prefix}-a`, text: "Option A" },
  { id: `${prefix}-b`, text: "Option B" },
  { id: `${prefix}-c`, text: "Option C" },
]

export function makeLesson(
  id: string,
  overrides: Partial<Lesson> = {}
): Lesson {
  const concept = (n: number) => ({
    id: `${id}-c${n}`,
    statement: `Key point ${n}.`,
    recallPrompts: [{ prompt: `Prompt ${n}?`, answer: `Answer ${n}.` }],
  })
  return {
    id,
    title: `Lesson ${id}`,
    keyQuestions: ["q1"],
    whyThisMatters: "It matters.",
    concepts: [concept(1), concept(2), concept(3)],
    guesses: [
      {
        id: `${id}-g1`,
        prompt: "Guess?",
        options: opts(`${id}-g1`),
        correct: `${id}-g1-a`,
        why: "Because.",
      },
      {
        id: `${id}-g2`,
        prompt: "Guess?",
        options: opts(`${id}-g2`),
        correct: `${id}-g2-b`,
        why: "Because.",
      },
    ],
    misconceptions: [],
    beyond: { simplified: [], notCovered: [] },
    exercises: [
      {
        id: `${id}-e1`,
        type: "mc",
        concepts: [`${id}-c1`],
        pool: "recall",
        prompt: "Which?",
        explanation: "This one.",
        anchor: `${id}-top`,
        options: opts(`${id}-e1`),
        correct: `${id}-e1-a`,
      },
    ],
    ...overrides,
  }
}

export function makeCourse(
  id: string,
  overrides: Partial<Course> = {}
): Course {
  return {
    schemaVersion: 1,
    id,
    title: `Course ${id}`,
    coverLabel: "Test",
    kind: "standard",
    asOf: "2026-11",
    outOfScope: "Everything else.",
    policies: ["broad"],
    keyQuestions: [
      { id: "q1", text: "Why?" },
      { id: "q2", text: "How?" },
      { id: "q3", text: "What?" },
    ],
    modules: [
      {
        id: "m1",
        title: "Module 1",
        lessons: ["one", "two"],
        checkpoint: ["x1", "x2", "x3", "x4", "x5", "x6"],
      },
      {
        id: "m2",
        title: "Module 2",
        lessons: ["three"],
        checkpoint: ["y1", "y2", "y3", "y4", "y5", "y6"],
      },
    ],
    sources: [
      {
        id: "src-a",
        group: "Papers",
        title: "A",
        publisher: "P",
        date: "2024",
        url: "https://example.org/a",
      },
      {
        id: "src-b",
        group: "Papers",
        title: "B",
        publisher: "P",
        date: "2025-03",
        url: "https://example.org/b",
      },
    ],
    ...overrides,
  }
}

/** `n` words of brief text. */
export function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(" ")
}

export type TestContent = {
  root: string
  writeCourse: (course: Course, lessons?: Lesson[], brief?: string) => void
  writePublished: (ids: string[]) => void
  writeFile: (path: string, text: string) => void
  close: () => void
}

/** A temporary content root with empty manifests. Call `close()` after. */
export function createTestContent(): TestContent {
  const root = mkdtempSync(join(tmpdir(), "plato-content-"))
  const writeFile = (path: string, text: string) => {
    const file = join(root, path)
    mkdirSync(join(file, ".."), { recursive: true })
    writeFileSync(file, text)
  }
  writeFile("published.json", JSON.stringify({ courses: [] }))
  writeFile("not-built.json", "[]")
  return {
    root,
    writeFile,
    writeCourse(course, lessons, brief = `# Title\n\n${words(10)}\n`) {
      const ls =
        lessons ??
        course.modules.flatMap((m) => m.lessons).map((l) => makeLesson(l))
      writeFile(`courses/${course.id}/course.yaml`, stringify(course))
      for (const l of ls) {
        writeFile(`courses/${course.id}/lessons/${l.id}.yaml`, stringify(l))
        writeFile(`courses/${course.id}/lessons/${l.id}.md`, brief)
      }
    },
    writePublished(ids) {
      writeFile(
        "published.json",
        JSON.stringify({
          courses: ids.map((id) => ({
            id,
            publishedAt: "2026-11-01T00:00:00Z",
          })),
        })
      )
    },
    close() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}
