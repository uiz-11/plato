// Reads course folders from the content root (§5.1). Read-only. In production
// results are memoized for the life of the process, since content changes only
// on deploy; elsewhere every call reads the files, so the pipeline's
// edit-and-check loop sees the current content (§5.4).
//
// No `server-only` here: the validator and other scripts load courses in plain
// Node (§5.5).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

import { isScalar, parseDocument, visit } from "yaml"
import type { z } from "zod"

import { testHooksEnabled } from "@/lib/test-hooks"

import {
  courseLengthSeconds,
  formatCourseLength,
  lessonCount,
  readMinutes,
  sourceNumbers,
} from "./derive"
import { clearMemo, memo } from "./memo"
import {
  Course,
  Lesson,
  NotBuiltList,
  PublishedManifest,
  type NotBuiltEntry,
  type PublishedEntry,
} from "./schema"

export type ContentIssue = { path: (string | number)[]; message: string }

/** A content file that is missing, unreadable or fails the schema. */
export class ContentError extends Error {
  constructor(
    /** The file, relative to the content root when it is inside it. */
    readonly file: string,
    readonly issues: ContentIssue[]
  ) {
    super(
      issues
        .map(
          (i) =>
            `${file}${i.path.length ? `: ${formatPath(i.path)}` : ""}: ${i.message}`
        )
        .join("\n")
    )
    this.name = "ContentError"
  }
}

export function formatPath(path: (string | number)[]): string {
  return path
    .map((p, i) => (typeof p === "number" ? `[${p}]` : i ? `.${p}` : p))
    .join("")
}

export type LoadedLesson = {
  lesson: Lesson
  /** The brief's Markdown source. */
  brief: string
  moduleId: string
  readMinutes: number
}

export type LoadedCourse = {
  id: string
  /** The course folder, as an absolute path. Figures load from its `assets/`. */
  dir: string
  course: Course
  /** Every lesson, in syllabus order. */
  lessons: LoadedLesson[]
  lessonsById: ReadonlyMap<string, LoadedLesson>
  /** The manifest entry, or null for a draft (§5.1). */
  published: PublishedEntry | null
  /** Source id → its citation number (§9.4). */
  sourceNumbers: ReadonlyMap<string, number>
  lessonCount: number
  lengthSeconds: number
  /** "~40 min", "~4.5 hrs" */
  lengthLabel: string
}

export type LoadOptions = {
  /** Defaults to `contentRoot()`. */
  root?: string
  /** Include folders missing from `published.json`. Defaults to test hooks (§10.1). */
  includeDrafts?: boolean
}

/** `PLATO_CONTENT_DIR` as an absolute path, defaulting to `<app root>/content`. */
export function contentRoot(
  env: Record<string, string | undefined> = process.env
): string {
  const dir = env.PLATO_CONTENT_DIR
  return dir ? resolve(dir) : join(process.cwd(), "content")
}

/** Drops memoized content. For tests. */
export function clearContentCache(): void {
  clearMemo()
  warnedDrafts.clear()
}

// ---------------------------------------------------------------------------
// Files

export function displayPath(root: string, file: string): string {
  const rel = relative(root, file)
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : file
}

function readText(root: string, file: string): string {
  try {
    return readFileSync(file, "utf8")
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT"
    throw new ContentError(displayPath(root, file), [
      { path: [], message: missing ? "file not found" : String(error) },
    ])
  }
}

/**
 * YAML 1.2 core schema, except that plain numbers and booleans keep their
 * source text. The schema has almost only string fields, and authors write
 * `date: 2024` or `accepted: [1.50]` unquoted; converting those to numbers
 * would reject them or lose text ("007" → 7). The few number fields accept
 * numeric strings (`schema.ts`).
 */
function parseContentYaml(text: string): unknown {
  const doc = parseDocument(text)
  if (doc.errors.length) throw doc.errors[0]
  visit(doc, {
    Scalar(_key, node) {
      if (
        isScalar(node) &&
        node.type === "PLAIN" &&
        (typeof node.value === "number" || typeof node.value === "boolean") &&
        node.source !== undefined
      )
        node.value = node.source
    },
  })
  return doc.toJS()
}

/**
 * Reads, parses and schema-checks one content file. Throws a `ContentError`
 * naming the file (relative to `root` when inside it). Exported for the
 * validator, which also parses the audit files (§11.3).
 */
export function parseContentFile<S extends z.ZodType>(
  schema: S,
  root: string,
  file: string,
  format: "yaml" | "json"
): z.infer<S> {
  const name = displayPath(root, file)
  const text = readText(root, file)
  let data: unknown
  try {
    data = format === "yaml" ? parseContentYaml(text) : JSON.parse(text)
  } catch (error) {
    throw new ContentError(name, [
      {
        path: [],
        message: error instanceof Error ? error.message : String(error),
      },
    ])
  }
  const result = schema.safeParse(data)
  if (!result.success)
    throw new ContentError(
      name,
      result.error.issues.map((i) => ({
        path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
        message: i.message,
      }))
    )
  return result.data
}

// ---------------------------------------------------------------------------
// Manifests

export function readPublished(root: string = contentRoot()): PublishedEntry[] {
  return memo(`published\0${root}`, () => {
    const manifest = parseContentFile(
      PublishedManifest,
      root,
      join(root, "published.json"),
      "json"
    )
    const seen = new Set<string>()
    manifest.courses.forEach((entry, i) => {
      if (seen.has(entry.id))
        throw new ContentError("published.json", [
          {
            path: ["courses", i, "id"],
            message: `"${entry.id}" is listed twice`,
          },
        ])
      seen.add(entry.id)
    })
    return manifest.courses
  })
}

export function readNotBuilt(root: string = contentRoot()): NotBuiltEntry[] {
  return memo(`not-built\0${root}`, () =>
    parseContentFile(NotBuiltList, root, join(root, "not-built.json"), "json")
  )
}

// ---------------------------------------------------------------------------
// Courses

/**
 * Parses one course folder: `course.yaml`, and the `.yaml` and `.md` files of
 * every lesson its modules list. Checks only what loading needs (the schema,
 * and ids matching their file names); the validator checks the rest (§5.5).
 */
export function loadCourseDir(
  dir: string,
  published: PublishedEntry | null = null,
  root: string = resolve(dir, "../..")
): LoadedCourse {
  const folderId = dir.split(/[\\/]/).filter(Boolean).at(-1)!
  const course = parseContentFile(
    Course,
    root,
    join(dir, "course.yaml"),
    "yaml"
  )
  if (course.id !== folderId)
    throw new ContentError(displayPath(root, join(dir, "course.yaml")), [
      {
        path: ["id"],
        message: `"${course.id}" does not match the folder "${folderId}"`,
      },
    ])

  const lessons: LoadedLesson[] = []
  const seen = new Set<string>()
  for (const [m, mod] of course.modules.entries()) {
    for (const [i, lessonId] of mod.lessons.entries()) {
      if (seen.has(lessonId))
        throw new ContentError(displayPath(root, join(dir, "course.yaml")), [
          {
            path: ["modules", m, "lessons", i],
            message: `lesson "${lessonId}" is listed more than once`,
          },
        ])
      seen.add(lessonId)
      const yamlFile = join(dir, "lessons", `${lessonId}.yaml`)
      const lesson = parseContentFile(Lesson, root, yamlFile, "yaml")
      if (lesson.id !== lessonId)
        throw new ContentError(displayPath(root, yamlFile), [
          {
            path: ["id"],
            message: `"${lesson.id}" does not match the file name "${lessonId}"`,
          },
        ])
      const brief = readText(root, join(dir, "lessons", `${lessonId}.md`))
      lessons.push({
        lesson,
        brief,
        moduleId: mod.id,
        readMinutes: readMinutes(brief),
      })
    }
  }

  const lengthSeconds = courseLengthSeconds(course, lessons)
  return {
    id: course.id,
    dir: resolve(dir),
    course,
    lessons,
    lessonsById: new Map(lessons.map((l) => [l.lesson.id, l])),
    published,
    sourceNumbers: sourceNumbers(course),
    lessonCount: lessonCount(course),
    lengthSeconds,
    lengthLabel: formatCourseLength(lengthSeconds),
  }
}

function coursesDir(root: string): string {
  return join(root, "courses")
}

/** Course folders with a `course.yaml` that are not in the manifest. */
function draftIds(root: string, published: PublishedEntry[]): string[] {
  const dir = coursesDir(root)
  if (!existsSync(dir)) return []
  const listed = new Set(published.map((p) => p.id))
  return readdirSync(dir)
    .filter((name) => !name.startsWith(".") && !listed.has(name))
    .filter((name) => isDirectory(join(dir, name)))
    .filter((name) => existsSync(join(dir, name, "course.yaml")))
    .sort()
}

/** Follows symlinks; false for a dangling link or an unreadable entry. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// Each broken draft is reported once per distinct error, not on every call.
const warnedDrafts = new Set<string>()

function warnDraftOnce(root: string, id: string, error: ContentError): void {
  const key = `${root}\0${id}\0${error.message}`
  if (warnedDrafts.has(key)) return
  warnedDrafts.add(key)
  console.warn(`Skipping draft course "${id}":\n${error.message}`)
}

function loadById(
  root: string,
  id: string,
  entry: PublishedEntry | null
): LoadedCourse {
  return memo(`course\0${root}\0${id}`, () =>
    loadCourseDir(join(coursesDir(root), id), entry, root)
  )
}

/**
 * Published courses in manifest order, then drafts by id when drafts are on.
 * A published course whose folder fails to load throws: CI validated it, so
 * that is a bug, not a state to show. A draft that fails to load is often
 * mid-edit by the pipeline, so it is logged and left out instead of breaking
 * every page that lists courses; `getCourse` still throws for it.
 */
export function listCourses(opts: LoadOptions = {}): LoadedCourse[] {
  const root = opts.root ?? contentRoot()
  const includeDrafts = opts.includeDrafts ?? testHooksEnabled()
  const published = readPublished(root)
  const courses = published.map((entry) => loadById(root, entry.id, entry))
  if (includeDrafts)
    for (const id of draftIds(root, published)) {
      try {
        courses.push(loadById(root, id, null))
      } catch (error) {
        if (!(error instanceof ContentError)) throw error
        warnDraftOnce(root, id, error)
      }
    }
  return courses
}

/** One course, or null when it is unknown (or a draft with drafts off). */
export function getCourse(
  id: string,
  opts: LoadOptions = {}
): LoadedCourse | null {
  const root = opts.root ?? contentRoot()
  const includeDrafts = opts.includeDrafts ?? testHooksEnabled()
  const entry = readPublished(root).find((p) => p.id === id)
  if (entry) return loadById(root, id, entry)
  if (!includeDrafts || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) return null
  if (!existsSync(join(coursesDir(root), id, "course.yaml"))) return null
  return loadById(root, id, null)
}
