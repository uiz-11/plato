// `content:check` (§5.6): compares the content folder with its state at the
// merge base on main.
//
// - Existing entries in `published.json` and `not-built.json` are unchanged:
//   both files are append-only.
// - No file under a course folder published at the base is added, changed or
//   deleted.
// - Every course newly added to `published.json` passes
//   `course:validate --publish` and the display check (§11.4), which
//   `scripts/content-check.ts` runs on the newly published ids.

import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"

import {
  NotBuiltList,
  PublishedManifest,
  type NotBuiltEntry,
  type PublishedEntry,
} from "@/lib/content/schema"

/** A snapshot of the repository's files. Paths are repo-relative, with `/`. */
export type Tree = {
  /** A manifest's contents, or null when the file does not exist. */
  read(path: string): Buffer | null
  /**
   * Every file under `dir`, recursively, with an id that is equal for equal
   * content (for git: the blob id, after line-ending conversion).
   */
  files(dir: string): Map<string, string>
}

export type ContentCheck = {
  errors: string[]
  /** Course ids added to `published.json` since the base. */
  newlyPublished: string[]
}

export function checkContent(
  base: Tree,
  head: Tree,
  dir = "content"
): ContentCheck {
  const errors: string[] = []
  const publishedFile = `${dir}/published.json`
  const notBuiltFile = `${dir}/not-built.json`

  const basePublished = readManifest(base, publishedFile, "base", errors)
  const headPublished = readManifest(head, publishedFile, "branch", errors)
  const baseNotBuilt = readNotBuilt(base, notBuiltFile, "base", errors)
  const headNotBuilt = readNotBuilt(head, notBuiltFile, "branch", errors)

  appendOnly(basePublished, headPublished, publishedFile, errors)
  appendOnly(baseNotBuilt, headNotBuilt, notBuiltFile, errors)
  duplicates(
    headPublished.map((e) => e.id),
    publishedFile,
    "course",
    errors
  )
  duplicates(
    headNotBuilt.map((e) => e.requestId),
    notBuiltFile,
    "request",
    errors
  )

  for (const { id } of basePublished) {
    const folder = `${dir}/courses/${id}`
    const before = base.files(folder)
    const after = head.files(folder)
    for (const [file, blob] of before) {
      if (!after.has(file))
        errors.push(`${file}: deleted from published course "${id}"`)
      else if (after.get(file) !== blob)
        errors.push(`${file}: changed in published course "${id}"`)
    }
    for (const file of after.keys())
      if (!before.has(file))
        errors.push(`${file}: added to published course "${id}"`)
  }
  if (errors.length)
    errors.push(
      "Published courses and manifest entries never change: fix a published course by publishing a corrected one under a new id (§5.6)."
    )

  const baseIds = new Set(basePublished.map((e) => e.id))
  const newlyPublished = headPublished
    .map((e) => e.id)
    .filter((id) => !baseIds.has(id))
  return { errors, newlyPublished }
}

function parseJson<T>(
  tree: Tree,
  file: string,
  side: string,
  errors: string[],
  schema: {
    safeParse: (
      v: unknown
    ) =>
      | { success: true; data: T }
      | { success: false; error: { message: string } }
  },
  empty: T
): T {
  const buf = tree.read(file)
  if (!buf) return empty
  let data: unknown
  try {
    data = JSON.parse(buf.toString("utf8"))
  } catch (error) {
    errors.push(
      `${file} (${side}): ${error instanceof Error ? error.message : String(error)}`
    )
    return empty
  }
  const result = schema.safeParse(data)
  if (!result.success) {
    errors.push(`${file} (${side}): ${result.error.message}`)
    return empty
  }
  return result.data
}

function readManifest(
  tree: Tree,
  file: string,
  side: string,
  errors: string[]
): PublishedEntry[] {
  return parseJson(tree, file, side, errors, PublishedManifest, { courses: [] })
    .courses
}

function readNotBuilt(
  tree: Tree,
  file: string,
  side: string,
  errors: string[]
): NotBuiltEntry[] {
  return parseJson(tree, file, side, errors, NotBuiltList, [])
}

function appendOnly<T>(
  before: T[],
  after: T[],
  file: string,
  errors: string[]
) {
  before.forEach((entry, i) => {
    if (!isDeepStrictEqual(entry, after[i]))
      errors.push(
        after[i] === undefined
          ? `${file}: entry ${i + 1} was removed; the file is append-only`
          : `${file}: entry ${i + 1} was changed; the file is append-only`
      )
  })
}

function duplicates(
  ids: string[],
  file: string,
  what: string,
  errors: string[]
) {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) errors.push(`${file}: ${what} "${id}" is listed twice`)
    seen.add(id)
  }
}

// ---------------------------------------------------------------------------
// Trees from git

function git(repo: string, args: string[], input?: string): Buffer {
  return execFileSync("git", args, {
    cwd: repo,
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  })
}

/** NUL-separated output (`-z`), so paths are never quoted or split. */
const nulList = (buf: Buffer) =>
  buf.toString("utf8").split("\0").filter(Boolean)

/** The files of commit `ref`. */
export function gitTree(repo: string, ref: string): Tree {
  return {
    read(path) {
      const [entry] = nulList(git(repo, ["ls-tree", "-z", ref, "--", path]))
      return entry ? git(repo, ["cat-file", "blob", `${ref}:${path}`]) : null
    },
    files(dir) {
      const out = new Map<string, string>()
      // `<mode> <type> <object>\t<path>`
      for (const entry of nulList(
        git(repo, ["ls-tree", "-r", "-z", ref, "--", dir])
      )) {
        const tab = entry.indexOf("\t")
        const [, type, object] = entry.slice(0, tab).split(" ")
        if (type === "blob") out.set(entry.slice(tab + 1), object)
      }
      return out
    },
  }
}

/**
 * The working tree: tracked files plus untracked ones that are not ignored,
 * so a change is caught before it is committed. Ids come from
 * `git hash-object`, which applies the same line-ending conversion as a
 * commit would, so a CRLF checkout matches its LF blobs.
 */
export function workTree(repo: string): Tree {
  return {
    read(path) {
      const file = join(repo, path)
      return existsSync(file) ? readFileSync(file) : null
    },
    files(dir) {
      const paths = [
        ...new Set(
          nulList(
            git(repo, [
              "ls-files",
              "-z",
              "--cached",
              "--others",
              "--exclude-standard",
              "--",
              dir,
            ])
          )
        ),
      ].filter((f) => isFileOrLink(join(repo, f)))
      const out = new Map<string, string>()
      // A symlink's blob is its target path, not the target's content.
      for (const p of paths)
        if (lstatSync(join(repo, p)).isSymbolicLink())
          out.set(
            p,
            git(repo, ["hash-object", "--stdin"], readlinkSync(join(repo, p)))
              .toString("utf8")
              .trim()
          )
      // One process for every other file. `--stdin-paths` is line-based; a
      // path with a newline cannot be hashed this way, so it shows as changed.
      const hashable = paths.filter((p) => !out.has(p) && !p.includes("\n"))
      if (!hashable.length) {
        for (const p of paths) if (!out.has(p)) out.set(p, `unhashable:${p}`)
        return out
      }
      const ids = git(
        repo,
        ["hash-object", "--stdin-paths"],
        hashable.join("\n") + "\n"
      )
        .toString("utf8")
        .split("\n")
      hashable.forEach((p, i) => out.set(p, ids[i]))
      for (const p of paths) if (!out.has(p)) out.set(p, `unhashable:${p}`)
      return out
    },
  }
}

/** Regular files and symlinks; not directories (submodules) or sockets. */
function isFileOrLink(path: string): boolean {
  try {
    const st = lstatSync(path)
    return st.isFile() || st.isSymbolicLink()
  } catch {
    return false
  }
}

export class BaseError extends Error {}

/**
 * The commit to compare with: the merge base of HEAD and main
 * (`origin/main` when it exists, as in CI, else the local `main`), or of HEAD
 * and `ref` when given. CI passes the commit main pointed to before a push;
 * when that is all zeros (a first push) or no longer reachable (a
 * force-push), HEAD's parent is used instead, and `fellBack` says so.
 */
export function mergeBase(
  repo: string,
  ref?: string
): { base: string; fellBack: boolean } {
  const usable = ref && !/^0+$/.test(ref) ? [ref] : []
  const candidates = ref ? [...usable, "HEAD~1"] : ["origin/main", "main"]
  for (const [i, c] of candidates.entries()) {
    try {
      const base = git(repo, ["merge-base", c, "HEAD"]).toString("utf8").trim()
      return { base, fellBack: !!ref && i >= usable.length }
    } catch {
      // try the next one
    }
  }
  throw new BaseError(
    `no merge base with ${candidates.join(" or ")}; fetch main or pass --base <ref>`
  )
}

export function repoRoot(cwd: string): string {
  return git(cwd, ["rev-parse", "--show-toplevel"]).toString("utf8").trim()
}
