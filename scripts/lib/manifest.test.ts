import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { readNotBuilt, readPublished } from "@/lib/content/load"
import { writeValidAudit } from "@/test/audit"

import {
  formatNotBuilt,
  formatPublished,
  publishCourse,
  recordNotBuilt,
} from "./manifest"

const FIXTURES = join(process.cwd(), "e2e/fixtures/content")
const NOW = new Date("2026-11-24T10:00:00.000Z")
const REQUEST = "0b7e5a52-3c1d-4f7a-9e2b-6a1f2c3d4e5f"

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

/** The fixture courses as drafts: nothing published or decided yet. */
function draftRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "plato-manifest-"))
  roots.push(root)
  cpSync(FIXTURES, root, { recursive: true })
  writeFileSync(join(root, "published.json"), formatPublished([]))
  writeFileSync(join(root, "not-built.json"), formatNotBuilt([]))
  return root
}

function setRequestId(root: string, id: string, requestId: string) {
  const file = join(root, "courses", id, "course.yaml")
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      "schemaVersion: 1\n",
      `schemaVersion: 1\nrequestId: ${requestId}\n`
    )
  )
}

describe("publishCourse", () => {
  it("validates with --publish, then appends the entry with the course's requestId", () => {
    const root = draftRoot()
    writeValidAudit(root, "leap-years")
    setRequestId(root, "leap-years", REQUEST)
    const result = publishCourse(root, "leap-years", NOW)
    expect(result).toMatchObject({
      ok: true,
      entry: {
        id: "leap-years",
        requestId: REQUEST,
        publishedAt: "2026-11-24T10:00:00.000Z",
      },
    })
    expect(readPublished(root)).toEqual([result.ok && result.entry])

    writeValidAudit(root, "how-encryption-works")
    expect(publishCourse(root, "how-encryption-works", NOW).ok).toBe(true)
    expect(readPublished(root).map((e) => e.id)).toEqual([
      "leap-years",
      "how-encryption-works",
    ])
  })

  it("refuses a course whose publish checks fail, and leaves the manifest alone", () => {
    const root = draftRoot()
    const before = readFileSync(join(root, "published.json"), "utf8")
    const result = publishCourse(root, "leap-years", NOW)
    expect(result.ok).toBe(false)
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule: "audit",
        message: expect.stringContaining("file not found"),
      })
    )
    expect(readFileSync(join(root, "published.json"), "utf8")).toBe(before)
  })

  it("refuses a course that is already published", () => {
    const root = draftRoot()
    writeValidAudit(root, "leap-years")
    const manifest = formatPublished([
      { id: "leap-years", publishedAt: "2026-11-01T00:00:00Z" },
    ])
    writeFileSync(join(root, "published.json"), manifest)
    expect(publishCourse(root, "leap-years", NOW)).toMatchObject({
      ok: false,
      message: expect.stringContaining("already published"),
    })
    expect(readFileSync(join(root, "published.json"), "utf8")).toBe(manifest)
  })

  it("refuses a request that is already published or not built", () => {
    const root = draftRoot()
    for (const id of ["leap-years", "how-encryption-works"]) {
      writeValidAudit(root, id)
      setRequestId(root, id, REQUEST)
    }
    expect(publishCourse(root, "leap-years", NOW).ok).toBe(true)
    expect(publishCourse(root, "how-encryption-works", NOW)).toMatchObject({
      ok: false,
      message: expect.stringContaining('already published as "leap-years"'),
    })

    const other = draftRoot()
    writeValidAudit(other, "leap-years")
    setRequestId(other, "leap-years", REQUEST)
    expect(recordNotBuilt(other, REQUEST, "No.", NOW).ok).toBe(true)
    expect(publishCourse(other, "leap-years", NOW)).toMatchObject({
      ok: false,
      message: expect.stringContaining("not-built.json"),
    })
    expect(readPublished(other)).toEqual([])
  })
})

describe("recordNotBuilt", () => {
  it("appends a decision", () => {
    const root = draftRoot()
    const result = recordNotBuilt(
      root,
      REQUEST,
      " A support request, not a topic to learn ",
      NOW
    )
    expect(result).toEqual({
      ok: true,
      entry: {
        requestId: REQUEST,
        reason: "A support request, not a topic to learn",
        decidedAt: "2026-11-24T10:00:00.000Z",
      },
    })
    expect(readNotBuilt(root)).toEqual([result.ok && result.entry])
    expect(readFileSync(join(root, "not-built.json"), "utf8")).toBe(
      `[\n  { "requestId": "${REQUEST}", "reason": "A support request, not a topic to learn", "decidedAt": "2026-11-24T10:00:00.000Z" }\n]\n`
    )
  })

  it("refuses a request decided twice", () => {
    const root = draftRoot()
    expect(recordNotBuilt(root, REQUEST, "No.", NOW).ok).toBe(true)
    expect(recordNotBuilt(root, REQUEST, "No again.", NOW)).toMatchObject({
      ok: false,
      message: expect.stringContaining("already in not-built.json"),
    })
  })

  it("refuses a request that is already published", () => {
    const root = draftRoot()
    writeFileSync(
      join(root, "published.json"),
      formatPublished([
        {
          id: "leap-years",
          requestId: REQUEST,
          publishedAt: "2026-11-01T00:00:00Z",
        },
      ])
    )
    expect(recordNotBuilt(root, REQUEST, "No.", NOW)).toMatchObject({
      ok: false,
      message: expect.stringContaining('already published as "leap-years"'),
    })
  })

  it.each([
    ["not-a-uuid", "No.", "requestId"],
    [REQUEST, "   ", "reason"],
    [REQUEST, "One line.\nTwo lines.", "one plain sentence"],
  ])("rejects %j / %j", (id, reason, message) => {
    const root = draftRoot()
    expect(recordNotBuilt(root, id, reason, NOW)).toMatchObject({
      ok: false,
      message: expect.stringContaining(message),
    })
    expect(readNotBuilt(root)).toEqual([])
  })
})

describe("manifest formatting", () => {
  it("writes one entry per line and round-trips through the loader", () => {
    const root = draftRoot()
    const entries = [
      { id: "a", publishedAt: "2026-11-01T00:00:00.000Z" },
      { id: "b", requestId: REQUEST, publishedAt: "2026-11-02T00:00:00.000Z" },
    ]
    const text = formatPublished(entries)
    expect(text).toBe(
      `{\n  "courses": [\n    { "id": "a", "publishedAt": "2026-11-01T00:00:00.000Z" },\n    { "id": "b", "requestId": "${REQUEST}", "publishedAt": "2026-11-02T00:00:00.000Z" }\n  ]\n}\n`
    )
    writeFileSync(join(root, "published.json"), text)
    expect(readPublished(root)).toEqual(entries)
    expect(formatPublished([])).toBe('{ "courses": [] }\n')
    expect(formatNotBuilt([])).toBe("[]\n")
  })
})

describe("request id case", () => {
  it("stores request ids in lower case and matches them in any case", () => {
    const root = draftRoot()
    const upper = REQUEST.toUpperCase()
    expect(recordNotBuilt(root, upper, "No.", NOW)).toMatchObject({
      ok: true,
      entry: { requestId: REQUEST },
    })
    expect(recordNotBuilt(root, REQUEST, "No again.", NOW)).toMatchObject({
      ok: false,
      message: expect.stringContaining("already in not-built.json"),
    })

    const other = draftRoot()
    writeValidAudit(other, "leap-years")
    setRequestId(other, "leap-years", upper)
    expect(publishCourse(other, "leap-years", NOW)).toMatchObject({
      ok: true,
      entry: { requestId: REQUEST },
    })
  })
})

describe("malformed manifests", () => {
  it("throw a ContentError naming the file", () => {
    const root = draftRoot()
    writeFileSync(join(root, "published.json"), '{ "courses": [], }')
    expect(() => publishCourse(root, "leap-years", NOW)).toThrow(
      expect.objectContaining({ name: "ContentError", file: "published.json" })
    )
  })
})
