import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  checkContent,
  gitTree,
  mergeBase,
  workTree,
  type Tree,
} from "./content-check"
import { formatNotBuilt, formatPublished } from "./manifest"

/**
 * Ignore the developer's own git config (signing, hooks), so the temporary
 * repositories behave the same everywhere.
 */
const ISOLATED_GIT = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
}

const REQUEST = "0b7e5a52-3c1d-4f7a-9e2b-6a1f2c3d4e5f"
const published = (...ids: string[]) =>
  formatPublished(
    ids.map((id) => ({ id, publishedAt: "2026-11-01T00:00:00Z" }))
  )

/** An in-memory tree. */
function tree(files: Record<string, string>): Tree {
  return {
    read: (p) => (p in files ? Buffer.from(files[p]) : null),
    files: (dir) =>
      new Map(Object.entries(files).filter(([p]) => p.startsWith(`${dir}/`))),
  }
}

const BASE = {
  "content/published.json": published("old"),
  "content/not-built.json": formatNotBuilt([
    { requestId: REQUEST, reason: "No.", decidedAt: "2026-11-01T00:00:00Z" },
  ]),
  "content/courses/old/course.yaml": "id: old\n",
  "content/courses/old/lessons/a.md": "# A\n",
  "content/courses/draft/course.yaml": "id: draft\n",
}

describe("checkContent", () => {
  it("passes an unchanged tree", () => {
    expect(checkContent(tree(BASE), tree(BASE))).toEqual({
      errors: [],
      newlyPublished: [],
    })
  })

  it("passes appended entries, edited drafts and a new course, and lists what is newly published", () => {
    const head = {
      ...BASE,
      "content/published.json": published("old", "draft", "fresh"),
      "content/courses/draft/course.yaml": "id: draft\ntitle: Edited\n",
      "content/courses/fresh/course.yaml": "id: fresh\n",
    }
    expect(checkContent(tree(BASE), tree(head))).toEqual({
      errors: [],
      newlyPublished: ["draft", "fresh"],
    })
  })

  it.each([
    [
      "changed",
      { "content/courses/old/lessons/a.md": "# A, edited\n" },
      'content/courses/old/lessons/a.md: changed in published course "old"',
    ],
    [
      "deleted",
      { "content/courses/old/lessons/a.md": null },
      'content/courses/old/lessons/a.md: deleted from published course "old"',
    ],
    [
      "added",
      { "content/courses/old/lessons/b.md": "# B\n" },
      'content/courses/old/lessons/b.md: added to published course "old"',
    ],
    [
      "unpublished",
      { "content/published.json": published() },
      "content/published.json: entry 1 was removed; the file is append-only",
    ],
    [
      "re-dated",
      {
        "content/published.json": formatPublished([
          { id: "old", publishedAt: "2026-11-02T00:00:00Z" },
        ]),
      },
      "content/published.json: entry 1 was changed",
    ],
    [
      "prepended",
      { "content/published.json": published("new", "old") },
      "content/published.json: entry 1 was changed",
    ],
    [
      "listed twice",
      { "content/published.json": published("old", "old") },
      'course "old" is listed twice',
    ],
    [
      "not-built reason edited",
      {
        "content/not-built.json": formatNotBuilt([
          {
            requestId: REQUEST,
            reason: "Changed.",
            decidedAt: "2026-11-01T00:00:00Z",
          },
        ]),
      },
      "content/not-built.json: entry 1 was changed",
    ],
    [
      "not-built emptied",
      { "content/not-built.json": "[]\n" },
      "content/not-built.json: entry 1 was removed",
    ],
    [
      "manifest broken",
      { "content/published.json": "{" },
      "content/published.json (branch)",
    ],
  ])(
    "rejects a published course or manifest entry that was %s",
    (_name, change, message) => {
      const head: Record<string, string> = { ...BASE }
      for (const [k, v] of Object.entries(change)) {
        if (v === null) delete head[k]
        else head[k] = v
      }
      const { errors } = checkContent(tree(BASE), tree(head))
      expect(errors).toContainEqual(expect.stringContaining(message))
      expect(errors.at(-1)).toContain(
        "publishing a corrected one under a new id"
      )
    }
  )

  it("treats a base without manifests as empty", () => {
    const head = {
      "content/published.json": published("first"),
      "content/courses/first/course.yaml": "",
    }
    expect(checkContent(tree({}), tree(head))).toEqual({
      errors: [],
      newlyPublished: ["first"],
    })
  })
})

describe("git trees", () => {
  const repos: string[] = []
  afterEach(() => {
    for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true })
  })

  function repo(): {
    dir: string
    write: (p: string, s: string) => void
    git: (...a: string[]) => string
  } {
    const dir = mkdtempSync(join(tmpdir(), "plato-git-"))
    repos.push(dir)
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.test",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.test",
          ...ISOLATED_GIT,
        },
      }).toString()
    git("init", "-q", "-b", "main")
    const write = (p: string, s: string) => {
      mkdirSync(dirname(join(dir, p)), { recursive: true })
      writeFileSync(join(dir, p), s)
    }
    for (const [p, s] of Object.entries(BASE)) write(p, s)
    git("add", ".")
    git("commit", "-q", "-m", "base")
    git("checkout", "-q", "-b", "work")
    return { dir, write, git }
  }

  it("rejects an edited published course, committed or not", () => {
    const r = repo()
    const base = mergeBase(r.dir).base
    expect(checkContent(gitTree(r.dir, base), workTree(r.dir)).errors).toEqual(
      []
    )

    r.write("content/courses/old/lessons/a.md", "# A, edited\n")
    expect(
      checkContent(gitTree(r.dir, base), workTree(r.dir)).errors
    ).toContainEqual(
      expect.stringContaining('changed in published course "old"')
    )
    r.git("commit", "-q", "-am", "edit")
    expect(
      checkContent(gitTree(r.dir, mergeBase(r.dir).base), workTree(r.dir))
        .errors
    ).toContainEqual(
      expect.stringContaining('changed in published course "old"')
    )
  })

  it("sees untracked and deleted files in the working tree, but not ignored ones", () => {
    const r = repo()
    const base = mergeBase(r.dir).base
    r.write(".gitignore", ".DS_Store\n")
    r.write("content/courses/old/.DS_Store", "x")
    expect(checkContent(gitTree(r.dir, base), workTree(r.dir)).errors).toEqual(
      []
    )

    r.write("content/courses/old/lessons/b.md", "# B\n")
    unlinkSync(join(r.dir, "content/courses/old/lessons/a.md"))
    expect(checkContent(gitTree(r.dir, base), workTree(r.dir)).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("lessons/b.md: added"),
        expect.stringContaining("lessons/a.md: deleted"),
      ])
    )
  })

  it("compares with the merge base, not main's tip", () => {
    const r = repo()
    r.write("content/courses/draft/course.yaml", "id: draft\nmine\n")
    r.git("commit", "-q", "-am", "work")
    r.git("checkout", "-q", "main")
    r.write("content/published.json", published("old", "other"))
    r.git("commit", "-q", "-am", "main moves on")
    r.git("checkout", "-q", "work")
    // Main's later entry is not ours to have removed.
    expect(
      checkContent(gitTree(r.dir, mergeBase(r.dir).base), workTree(r.dir))
        .errors
    ).toEqual([])
  })
})

describe("git trees: paths and line endings", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  function repoWith(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "plato-git-"))
    dirs.push(dir)
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.test",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.test",
          ...ISOLATED_GIT,
        },
      }).toString()
    git("init", "-q", "-b", "main")
    for (const [p, s] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true })
      writeFileSync(join(dir, p), s)
    }
    git("add", ".")
    git("commit", "-q", "-m", "base")
    return { dir, git }
  }

  it("handles file names git would quote", () => {
    const name = 'content/courses/old/_audit/notes/café "x".md'
    const r = repoWith({ ...BASE, [name]: "notes\n" })
    const base = mergeBase(r.dir).base
    expect(checkContent(gitTree(r.dir, base), workTree(r.dir)).errors).toEqual(
      []
    )
    writeFileSync(join(r.dir, name), "edited\n")
    expect(
      checkContent(gitTree(r.dir, base), workTree(r.dir)).errors
    ).toContainEqual(`${name}: changed in published course "old"`)
  })

  it("matches a CRLF checkout against its LF blobs", () => {
    const r = repoWith(BASE)
    r.git("config", "core.autocrlf", "true")
    writeFileSync(join(r.dir, "content/courses/old/lessons/a.md"), "# A\r\n")
    expect(
      checkContent(gitTree(r.dir, mergeBase(r.dir).base), workTree(r.dir))
        .errors
    ).toEqual([])
  })
})

describe("symlinks and the base commit", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  function repoWith(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "plato-git-"))
    dirs.push(dir)
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@example.test",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@example.test",
          ...ISOLATED_GIT,
        },
      }).toString()
    git("init", "-q", "-b", "main")
    for (const [p, s] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true })
      writeFileSync(join(dir, p), s)
    }
    return { dir, git }
  }

  it("compares a symlink by its target path, not the target's content", () => {
    const r = repoWith(BASE)
    symlinkSync("a.md", join(r.dir, "content/courses/old/lessons/link.md"))
    r.git("add", ".")
    r.git("commit", "-q", "-m", "base")
    const base = mergeBase(r.dir).base
    expect(checkContent(gitTree(r.dir, base), workTree(r.dir)).errors).toEqual(
      []
    )

    rmSync(join(r.dir, "content/courses/old/lessons/link.md"))
    symlinkSync(
      "../course.yaml",
      join(r.dir, "content/courses/old/lessons/link.md")
    )
    expect(
      checkContent(gitTree(r.dir, base), workTree(r.dir)).errors
    ).toContainEqual(
      'content/courses/old/lessons/link.md: changed in published course "old"'
    )
  })

  it("falls back to HEAD's parent for an all-zero or unknown --base", () => {
    const r = repoWith(BASE)
    r.git("add", ".")
    r.git("commit", "-q", "-m", "one")
    writeFileSync(
      join(r.dir, "content/courses/draft/course.yaml"),
      "id: draft\nx\n"
    )
    r.git("commit", "-q", "-am", "two")
    const parent = r.git("rev-parse", "HEAD~1").trim()
    expect(mergeBase(r.dir, "0".repeat(40))).toEqual({
      base: parent,
      fellBack: true,
    })
    expect(mergeBase(r.dir, "f".repeat(40))).toEqual({
      base: parent,
      fellBack: true,
    })
    expect(mergeBase(r.dir, parent)).toEqual({ base: parent, fellBack: false })
  })
})
