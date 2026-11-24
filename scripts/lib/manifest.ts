// Appending to the content manifests (§5.1, §5.6): `course:publish` adds a
// `published.json` entry and `course:not-built` a `not-built.json` entry.
// Both files are append-only; `content:check` enforces that in CI.

import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { z } from "zod"

import { parseContentFile } from "@/lib/content/load"
import {
  Course,
  NotBuiltList,
  PublishedManifest,
  type NotBuiltEntry,
  type PublishedEntry,
} from "@/lib/content/schema"
import { validateCourse, type Finding } from "@/lib/content/validate"

/** One entry per line, so an append is a one-line diff. */
export function formatPublished(entries: PublishedEntry[]): string {
  if (!entries.length) return `{ "courses": [] }\n`
  const lines = entries.map((e) => `    ${entryJson(e)}`).join(",\n")
  return `{\n  "courses": [\n${lines}\n  ]\n}\n`
}

export function formatNotBuilt(entries: NotBuiltEntry[]): string {
  if (!entries.length) return "[]\n"
  return `[\n${entries.map((e) => `  ${entryJson(e)}`).join(",\n")}\n]\n`
}

function entryJson(entry: object): string {
  const fields = Object.entries(entry)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  return `{ ${fields.join(", ")} }`
}

/** Throws a `ContentError` naming the file when it is missing or malformed. */
function readJson<S extends z.ZodType>(file: string, schema: S): z.infer<S> {
  return parseContentFile(schema, dirname(file), file, "json")
}

export type PublishResult =
  | { ok: true; entry: PublishedEntry; findings: Finding[] }
  | { ok: false; findings: Finding[]; message?: string }

/**
 * Runs `course:validate --publish` and, when it passes, appends the course
 * to `published.json`, carrying over its `requestId` (§11.2 stage 4).
 */
export function publishCourse(
  root: string,
  id: string,
  now: Date
): PublishResult {
  const file = join(root, "published.json")
  const manifest = readJson(file, PublishedManifest)
  if (manifest.courses.some((c) => c.id === id))
    return {
      ok: false,
      findings: [],
      message: `"${id}" is already published; a published course never changes. Publish a fix under a new id.`,
    }

  const result = validateCourse(id, { root, publish: true })
  if (!result.ok) return { ok: false, findings: result.findings }

  // Validation passed, so the folder exists and course.yaml parses.
  const requestId = readRequestId(root, id)
  if (requestId) {
    const other = manifest.courses.find(
      (c) => c.requestId?.toLowerCase() === requestId
    )
    if (other)
      return {
        ok: false,
        findings: result.findings,
        message: `request ${requestId} is already published as "${other.id}"`,
      }
    const notBuilt = readJson(join(root, "not-built.json"), NotBuiltList)
    if (notBuilt.some((n) => n.requestId.toLowerCase() === requestId))
      return {
        ok: false,
        findings: result.findings,
        message: `request ${requestId} is in not-built.json, which is append-only; it cannot also be published`,
      }
  }

  const entry: PublishedEntry = {
    id,
    ...(requestId ? { requestId } : {}),
    publishedAt: now.toISOString(),
  }
  writeFileSync(file, formatPublished([...manifest.courses, entry]))
  return { ok: true, entry, findings: result.findings }
}

/**
 * Request ids are compared and stored in lower case, as the app writes them;
 * a UUID pasted in upper case still matches.
 */
function readRequestId(root: string, id: string): string | undefined {
  return parseContentFile(
    Course,
    root,
    join(root, "courses", id, "course.yaml"),
    "yaml"
  ).requestId?.toLowerCase()
}

export type NotBuiltResult =
  { ok: true; entry: NotBuiltEntry } | { ok: false; message: string }

/** Appends a not-build decision to `not-built.json` (§11.2). */
export function recordNotBuilt(
  root: string,
  requestId: string,
  reason: string,
  now: Date
): NotBuiltResult {
  const file = join(root, "not-built.json")
  const entry = {
    requestId: requestId.trim().toLowerCase(),
    reason: reason.trim(),
    decidedAt: now.toISOString(),
  }
  const parsed = NotBuiltList.element.safeParse(entry)
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("\n"),
    }
  if (/[\r\n]/.test(entry.reason))
    return {
      ok: false,
      message: "the reason is one plain sentence, on one line",
    }

  const list = readJson(file, NotBuiltList)
  if (list.some((n) => n.requestId.toLowerCase() === entry.requestId))
    return {
      ok: false,
      message: `request ${requestId} is already in not-built.json`,
    }
  const published = readJson(join(root, "published.json"), PublishedManifest)
  const course = published.courses.find(
    (c) => c.requestId?.toLowerCase() === entry.requestId
  )
  if (course)
    return {
      ok: false,
      message: `request ${requestId} is already published as "${course.id}"`,
    }

  writeFileSync(file, formatNotBuilt([...list, parsed.data]))
  return { ok: true, entry: parsed.data }
}
