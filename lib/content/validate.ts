// The course validator (§5.5). `npm run course:validate` is a thin wrapper
// around `validateCourse`; the pipeline loops on its `--json` findings until
// there are no errors.
//
// It reads briefs with the renderer's own parser and directive checks
// (`checkBrief`, `checkInline`, `parseMarkdown`) and marks fill-in answers
// with the app's `normalizeAnswer`, so the validator and the app cannot
// disagree about what a course means.
//
// No `server-only` here: it runs in plain Node.

import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import type { Nodes, Root as MdastRoot } from "mdast"
import { visit } from "unist-util-visit"
import type { z } from "zod"

import {
  AUDIT_DIR,
  AUDIT_FILES,
  BlindSolveAudit,
  ClaimsAudit,
  REVIEW_AREAS,
  ReviewAudit,
} from "./audit"
import { briefWordCount } from "./derive"
import {
  contentRoot,
  ContentError,
  loadCourseDir,
  parseContentFile,
  type LoadedCourse,
} from "./load"
import { normalizeAnswer } from "./normalize"
import {
  checkBrief,
  checkInline,
  CONTENT_LABELS,
  parseMarkdown,
  type RenderContext,
} from "./render"
import { Course, Lesson, type Exercise, type Opt, type Policy } from "./schema"

// ---------------------------------------------------------------------------
// Findings

/** The §5.5 check areas, plus `markdown` for the brief format (§5.3). */
export type Rule =
  | "schema"
  | "files"
  | "markdown"
  | "references"
  | "placement"
  | "ids"
  | "citations"
  | "analogies"
  | "exercises"
  | "practice"
  | "checkpoints"
  | "coverage"
  | "shape"
  | "policies"
  | "copyright"
  | "audit"
  | "online"

export type Finding = {
  level: "error" | "warning"
  rule: Rule
  /** Relative to the content root, as in `courses/<id>/lessons/<lesson>.yaml`. */
  file: string
  /** The YAML path inside `file`; empty for a brief (its message names the line). */
  path: (string | number)[]
  message: string
}

export type ValidationResult = {
  courseId: string
  /** No errors. Warnings do not fail a run. */
  ok: boolean
  findings: Finding[]
}

export type ValidateOptions = {
  /** Defaults to `contentRoot()`. */
  root?: string
  /** Also run the publish checks on `_audit/` (§11.3). */
  publish?: boolean
}

class Findings {
  readonly list: Finding[] = []
  error(rule: Rule, file: string, path: Finding["path"], message: string) {
    this.list.push({ level: "error", rule, file, path, message })
  }
  warn(rule: Rule, file: string, path: Finding["path"], message: string) {
    this.list.push({ level: "warning", rule, file, path, message })
  }
  fromContentError(error: ContentError) {
    for (const i of error.issues)
      this.error("schema", error.file, i.path, i.message)
  }
  get errorCount() {
    return this.list.filter((f) => f.level === "error").length
  }
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** "line 12: " for a brief node. */
const at = (node: Nodes | undefined) =>
  node?.position ? `line ${node.position.start.line}: ` : ""

const quote = (s: string) => JSON.stringify(s)

// ---------------------------------------------------------------------------
// Entry point

/**
 * Validates `courses/<courseId>/` under the content root. Never throws for
 * content problems; they are findings.
 */
export function validateCourse(
  courseId: string,
  opts: ValidateOptions = {}
): ValidationResult {
  const root = opts.root ?? contentRoot()
  const out = new Findings()
  const result = () => ({
    courseId,
    ok: out.errorCount === 0,
    findings: out.list,
  })

  const base = `courses/${courseId}`
  const dir = join(root, "courses", courseId)
  if (!ID.test(courseId)) {
    out.error("files", base, [], "a course id must be kebab-case")
    return result()
  }
  if (!isDir(dir)) {
    out.error("files", base, [], "course folder not found")
    return result()
  }

  const loaded = load(dir, root, base, out)
  if (!loaded) return result()

  const v = new CourseChecks(loaded, base, out)
  v.run()
  if (opts.publish) checkAudit(loaded, v, root, base, out)
  return result()
}

// ---------------------------------------------------------------------------
// Loading and files

/**
 * Parses every file on its own first, so one run reports every file that
 * fails the schema, then loads the course the way the app does.
 */
function load(
  dir: string,
  root: string,
  base: string,
  out: Findings
): LoadedCourse | null {
  const courseFile = `${base}/course.yaml`
  let course: Course
  try {
    course = parseContentFile(Course, root, join(dir, "course.yaml"), "yaml")
  } catch (error) {
    if (!(error instanceof ContentError)) throw error
    out.fromContentError(error)
    checkStrayFiles(dir, base, null, out)
    return null
  }
  const folderId = base.split("/").at(-1)!
  if (course.id !== folderId)
    out.error(
      "schema",
      courseFile,
      ["id"],
      `${quote(course.id)} does not match the folder ${quote(folderId)}`
    )

  const listed = new Set<string>()
  course.modules.forEach((m, mi) =>
    m.lessons.forEach((lessonId, li) => {
      if (listed.has(lessonId))
        out.error(
          "files",
          courseFile,
          ["modules", mi, "lessons", li],
          `lesson ${quote(lessonId)} is listed more than once; each lesson belongs to exactly one module`
        )
      listed.add(lessonId)
    })
  )

  for (const lessonId of listed) {
    const yaml = join(dir, "lessons", `${lessonId}.yaml`)
    const file = `${base}/lessons/${lessonId}.yaml`
    try {
      const lesson = parseContentFile(Lesson, root, yaml, "yaml")
      if (lesson.id !== lessonId)
        out.error(
          "schema",
          file,
          ["id"],
          `${quote(lesson.id)} does not match the file name ${quote(lessonId)}`
        )
    } catch (error) {
      if (!(error instanceof ContentError)) throw error
      out.fromContentError(error)
    }
    if (!existsSync(join(dir, "lessons", `${lessonId}.md`)))
      out.error(
        "schema",
        `${base}/lessons/${lessonId}.md`,
        [],
        "file not found: every lesson needs a brief"
      )
  }

  checkStrayFiles(dir, base, listed, out)
  if (out.errorCount) return null
  try {
    return loadCourseDir(dir, null, root)
  } catch (error) {
    if (!(error instanceof ContentError)) throw error
    out.fromContentError(error)
    return null
  }
}

const COURSE_ENTRIES: Record<string, "file" | "dir"> = {
  "course.yaml": "file",
  lessons: "dir",
  assets: "dir",
  [AUDIT_DIR]: "dir",
}

/**
 * No stray files: only `course.yaml`, the listed lessons' `.yaml` and `.md`,
 * SVGs in `assets/` (unused ones are caught once briefs are read) and
 * `_audit/`, whose contents the publish checks own. Dotfiles are ignored.
 */
function checkStrayFiles(
  dir: string,
  base: string,
  listed: Set<string> | null,
  out: Findings
) {
  for (const name of visible(dir)) {
    const kind = COURSE_ENTRIES[name]
    const actual = isDir(join(dir, name)) ? "dir" : "file"
    if (kind !== actual)
      out.error(
        "files",
        `${base}/${name}`,
        [],
        "stray file: a course folder holds only course.yaml, lessons/, assets/ and _audit/"
      )
  }
  if (listed && isDir(join(dir, "lessons")))
    for (const name of visible(join(dir, "lessons"))) {
      const m = /^(.+)\.(yaml|md)$/.exec(name)
      if (m && listed.has(m[1]) && !isDir(join(dir, "lessons", name))) continue
      out.error(
        "files",
        `${base}/lessons/${name}`,
        [],
        m
          ? `lesson ${quote(m[1])} is not in any module of course.yaml`
          : "stray file: lessons/ holds only <lesson-id>.yaml and <lesson-id>.md"
      )
    }
  if (isDir(join(dir, "assets")))
    for (const name of visible(join(dir, "assets")))
      if (
        !name.toLowerCase().endsWith(".svg") ||
        isDir(join(dir, "assets", name))
      )
        out.error(
          "files",
          `${base}/assets/${name}`,
          [],
          "stray file: assets/ holds only .svg figures"
        )
}

function visible(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => !n.startsWith("."))
    .sort()
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Structure checks

type Where = { file: string; path: Finding["path"] }

/** One inline `Md` value and where it is. */
type InlineField = Where & { value: string; blank?: boolean }

type BriefInfo = {
  file: string
  tree: MdastRoot
  anchors: Map<string, Nodes[]>
  analogies: Map<string, Nodes[]>
  guesses: Map<string, Nodes[]>
  misconceptions: Map<string, Nodes[]>
  figures: string[]
}

type ExerciseInfo = {
  exercise: Exercise
  lessonId: string
  where: Where
}

class CourseChecks {
  readonly courseFile: string
  /** Lesson id → its brief, parsed. */
  readonly briefs = new Map<string, BriefInfo>()
  /** Lesson id → sources cited in its brief and inline fields. */
  readonly citedByLesson = new Map<string, Set<string>>()
  /** Sources cited in `outOfScope` and `policyNote`. */
  readonly citedByCourse = new Set<string>()
  readonly exercises = new Map<string, ExerciseInfo>()
  /** Concept id → the lesson that teaches it. */
  readonly conceptLesson = new Map<string, string>()
  readonly moduleOfLesson = new Map<string, string>()
  readonly misconceptionIds = new Set<string>()
  private contestedLabels = 0

  constructor(
    readonly c: LoadedCourse,
    readonly base: string,
    readonly out: Findings
  ) {
    this.courseFile = `${base}/course.yaml`
    for (const m of c.course.modules)
      for (const l of m.lessons) this.moduleOfLesson.set(l, m.id)
    for (const { lesson } of c.lessons) {
      for (const concept of lesson.concepts)
        if (!this.conceptLesson.has(concept.id))
          this.conceptLesson.set(concept.id, lesson.id)
      for (const m of lesson.misconceptions) this.misconceptionIds.add(m.id)
      lesson.exercises.forEach((exercise, i) => {
        if (!this.exercises.has(exercise.id))
          this.exercises.set(exercise.id, {
            exercise,
            lessonId: lesson.id,
            where: { file: this.yaml(lesson.id), path: ["exercises", i] },
          })
      })
    }
  }

  yaml(lessonId: string) {
    return `${this.base}/lessons/${lessonId}.yaml`
  }
  md(lessonId: string) {
    return `${this.base}/lessons/${lessonId}.md`
  }

  run() {
    this.markdown()
    this.ids()
    this.references()
    this.placement()
    this.citations()
    this.analogies()
    this.exerciseRules()
    this.practice()
    this.checkpoints()
    this.coverage()
    this.shape()
    this.policies()
    this.copyright()
    this.assets()
  }

  // --- Markdown: the brief format and every inline field ------------------

  private markdown() {
    const { c, out } = this
    const courseCtx: RenderContext = { sourceNumbers: c.sourceNumbers }
    const courseFields: InlineField[] = [
      {
        file: this.courseFile,
        path: ["outOfScope"],
        value: c.course.outOfScope,
      },
    ]
    if (c.course.policyNote)
      courseFields.push({
        file: this.courseFile,
        path: ["policyNote"],
        value: c.course.policyNote,
      })
    for (const f of courseFields) this.inline(f, courseCtx, null)

    for (const { lesson, brief } of c.lessons) {
      const file = this.md(lesson.id)
      const ctx: RenderContext = {
        sourceNumbers: c.sourceNumbers,
        lesson,
        assetsDir: join(c.dir, "assets"),
      }
      for (const issue of checkBrief(brief, ctx))
        out.error(
          issue.sanitized ? "files" : "markdown",
          file,
          [],
          issue.message
        )

      const tree = parseMarkdown(brief)
      const info = briefInfo(file, tree)
      this.briefs.set(lesson.id, info)
      this.cite(lesson.id, tree)

      const h1 = tree.children.filter(
        (n) => n.type === "heading" && n.depth === 1
      )
      const first = tree.children.find((n) => n.type !== "definition")
      if (h1.length !== 1 || first !== h1[0])
        out.error(
          "markdown",
          file,
          [],
          `${at(h1[1] ?? first)}a brief starts with its one # Title heading (found ${h1.length})`
        )

      for (const f of lessonInlineFields(lesson, this.yaml(lesson.id)))
        this.inline(f, ctx, lesson.id)
    }
  }

  private inline(f: InlineField, ctx: RenderContext, lessonId: string | null) {
    for (const issue of checkInline(f.value, ctx, { blank: f.blank }))
      this.out.error("markdown", f.file, f.path, issue.message)
    this.cite(lessonId, parseMarkdown(f.value))
  }

  /**
   * Records `:cite` sources, per lesson or for the course's own fields, and
   * counts `:contested` labels.
   */
  private cite(lessonId: string | null, tree: MdastRoot) {
    let set = this.citedByCourse
    if (lessonId !== null) {
      set = this.citedByLesson.get(lessonId) ?? new Set()
      this.citedByLesson.set(lessonId, set)
    }
    visit(tree, "textDirective", (node) => {
      if (node.name === "cite")
        for (const id of plainText(node).split(","))
          if (id.trim()) set.add(id.trim())
      if (node.name === "contested") this.contestedLabels += 1
    })
  }

  // --- Ids ----------------------------------------------------------------

  /** Ids inside a course are unique across all kinds (§5.1). */
  private ids() {
    const { c, out } = this
    const seen = new Map<string, string[]>()
    const add = (id: string, what: string) =>
      seen.set(id, [...(seen.get(id) ?? []), what])

    for (const s of c.course.sources) add(s.id, "a source")
    for (const { lesson } of c.lessons) {
      add(lesson.id, "a lesson")
      for (const x of lesson.concepts) add(x.id, `a concept in ${lesson.id}`)
      for (const x of lesson.guesses) add(x.id, `a guess in ${lesson.id}`)
      for (const x of lesson.misconceptions)
        add(x.id, `a misconception in ${lesson.id}`)
      for (const x of lesson.exercises) add(x.id, `an exercise in ${lesson.id}`)
      const brief = this.briefs.get(lesson.id)!
      for (const [id, nodes] of brief.anchors)
        nodes.forEach(() => add(id, `an anchor in ${lesson.id}.md`))
      for (const [id, nodes] of brief.analogies)
        nodes.forEach(() => add(id, `an analogy in ${lesson.id}.md`))
    }
    for (const [id, uses] of seen)
      if (uses.length > 1)
        out.error(
          "ids",
          this.courseFile,
          [],
          `id ${quote(id)} is used more than once (${uses.join(", ")}); ids are unique within a course, and each concept and misconception belongs to one lesson`
        )

    const qids = new Set<string>()
    c.course.keyQuestions.forEach((q, i) => {
      if (qids.has(q.id))
        out.error(
          "ids",
          this.courseFile,
          ["keyQuestions", i, "id"],
          `key question ${q.id} is listed twice`
        )
      qids.add(q.id)
    })

    for (const { lesson } of c.lessons) {
      const file = this.yaml(lesson.id)
      const beyondIds = new Set<string>()
      const beyond = [
        ...lesson.beyond.simplified.map((s, i) => ({
          id: s.id,
          path: ["beyond", "simplified", i, "id"],
        })),
        ...lesson.beyond.notCovered.map((s, i) => ({
          id: s.id,
          path: ["beyond", "notCovered", i, "id"],
        })),
      ]
      for (const b of beyond) {
        if (beyondIds.has(b.id))
          out.error(
            "ids",
            file,
            b.path,
            `${quote(b.id)} is used by two Beyond this lesson entries`
          )
        beyondIds.add(b.id)
      }
    }
  }

  // --- References -----------------------------------------------------------

  private references() {
    const { c, out } = this
    const qids = new Set<string>(c.course.keyQuestions.map((q) => q.id))
    const q = (value: string, file: string, path: Finding["path"]) => {
      if (!qids.has(value))
        out.error(
          "references",
          file,
          path,
          `unknown key question ${quote(value)}`
        )
    }

    for (const { lesson } of c.lessons) {
      const file = this.yaml(lesson.id)
      const brief = this.briefs.get(lesson.id)!
      lesson.keyQuestions.forEach((k, i) => q(k, file, ["keyQuestions", i]))
      if (lesson.hook) q(lesson.hook.keyQuestion, file, ["hook", "keyQuestion"])
      for (const [kind, list] of [
        ["simplified", lesson.beyond.simplified],
        ["notCovered", lesson.beyond.notCovered],
      ] as const)
        list.forEach((entry, i) =>
          entry.links.forEach((link, j) => {
            if (link.recommended)
              q(link.recommended, file, [
                "beyond",
                kind,
                i,
                "links",
                j,
                "recommended",
              ])
          })
        )

      lesson.guesses.forEach((g, i) => {
        this.options(g.options, file, ["guesses", i, "options"])
        if (!g.options.some((o) => o.id === g.correct))
          out.error(
            "references",
            file,
            ["guesses", i, "correct"],
            `${quote(g.correct)} is not one of the guess's options`
          )
      })

      lesson.beyond.simplified.forEach((s, i) => {
        if (s.analogy && !brief.analogies.has(s.analogy))
          out.error(
            "references",
            file,
            ["beyond", "simplified", i, "analogy"],
            `the brief has no analogy block ${quote(s.analogy)}`
          )
      })

      lesson.exercises.forEach((e, i) => {
        const path = ["exercises", i]
        e.concepts.forEach((id, j) => {
          if (!this.conceptLesson.has(id))
            out.error(
              "references",
              file,
              [...path, "concepts", j],
              `unknown concept ${quote(id)}`
            )
        })
        const key = (
          list: Opt[],
          listName: string,
          keyName: string,
          value: string
        ) => {
          this.options(list, file, [...path, listName])
          if (!list.some((o) => o.id === value))
            out.error(
              "references",
              file,
              [...path, keyName],
              `${quote(value)} is not one of the exercise's ${listName}`
            )
        }
        if (e.type === "mc" || e.type === "scenario")
          key(e.options, "options", "correct", e.correct)
        if (e.type === "spot") {
          key(e.sentences, "sentences", "faulty", e.faulty)
          key(e.fixes, "fixes", "correctFix", e.correctFix)
        }
        if (![...this.briefs.values()].some((b) => b.anchors.has(e.anchor)))
          out.error(
            "references",
            file,
            [...path, "anchor"],
            `no brief has the anchor ${quote(e.anchor)}`
          )
      })
    }

    c.course.modules.forEach((m, mi) =>
      m.checkpoint.forEach((id, i) => {
        if (!this.exercises.has(id))
          out.error(
            "references",
            this.courseFile,
            ["modules", mi, "checkpoint", i],
            `unknown exercise ${quote(id)}`
          )
      })
    )
  }

  /** An option list: misconceptions resolve, ids are unique, texts distinct. */
  private options(list: Opt[], file: string, path: Finding["path"]) {
    const ids = new Set<string>()
    const texts = new Map<string, string>()
    list.forEach((o, i) => {
      if (o.misconception && !this.misconceptionIds.has(o.misconception))
        this.out.error(
          "references",
          file,
          [...path, i, "misconception"],
          `unknown misconception ${quote(o.misconception)}`
        )
      if (ids.has(o.id))
        this.out.error(
          "ids",
          file,
          [...path, i, "id"],
          `option id ${quote(o.id)} is used twice in this list`
        )
      ids.add(o.id)
      const t = o.text.trim().replace(/\s+/g, " ").toLowerCase()
      const other = texts.get(t)
      if (other)
        this.out.error(
          "exercises",
          file,
          [...path, i, "text"],
          `option text repeats ${quote(other)}; option texts are distinct`
        )
      else texts.set(t, o.id)
    })
  }

  // --- Placement ------------------------------------------------------------

  private placement() {
    for (const { lesson } of this.c.lessons) {
      const brief = this.briefs.get(lesson.id)!
      const check = (
        list: { id: string }[],
        placed: Map<string, Nodes[]>,
        kind: "guess" | "misconception"
      ) =>
        list.forEach((x, i) => {
          const n = placed.get(x.id)?.length ?? 0
          if (n !== 1)
            this.out.error(
              "placement",
              this.yaml(lesson.id),
              [kind === "guess" ? "guesses" : "misconceptions", i],
              `${kind} ${quote(x.id)} is placed in the brief ${n} times; place it exactly once with ::${kind}{#${x.id}}`
            )
        })
      check(lesson.guesses, brief.guesses, "guess")
      check(lesson.misconceptions, brief.misconceptions, "misconception")
    }
  }

  // --- Citations ------------------------------------------------------------

  private citations() {
    const { c, out } = this
    for (const { lesson } of c.lessons) {
      const brief = this.briefs.get(lesson.id)!
      for (const node of uncitedBlocks(brief.tree))
        out.error(
          "citations",
          brief.file,
          [],
          `${at(node)}${node.type === "listItem" ? "list item" : "paragraph"} has no :cite or content label (:general, :uncertain, :contested)`
        )
    }
    const cited = new Set(this.citedByCourse)
    for (const set of this.citedByLesson.values())
      for (const id of set) cited.add(id)
    c.course.sources.forEach((s, i) => {
      if (!cited.has(s.id))
        out.error(
          "citations",
          this.courseFile,
          ["sources", i],
          `source ${quote(s.id)} is never cited`
        )
    })
  }

  // --- Analogies ------------------------------------------------------------

  private analogies() {
    for (const { lesson } of this.c.lessons) {
      const brief = this.briefs.get(lesson.id)!
      const referenced = new Set(lesson.beyond.simplified.map((s) => s.analogy))
      for (const [id, nodes] of brief.analogies)
        if (!referenced.has(id))
          this.out.error(
            "analogies",
            brief.file,
            [],
            `${at(nodes[0])}analogy ${quote(id)} is not referenced by a beyond.simplified entry, which says where it breaks down`
          )
    }
  }

  // --- Exercises ------------------------------------------------------------

  private exerciseRules() {
    const { out } = this
    const checkpointModule = new Map<string, string>()
    for (const m of this.c.course.modules)
      for (const id of m.checkpoint) checkpointModule.set(id, m.id)

    for (const [id, { exercise: e, lessonId, where }] of this.exercises) {
      const { file, path } = where
      if (e.type === "fill") {
        const blanks = countBlanks(e.prompt)
        if (blanks !== 1)
          out.error(
            "exercises",
            file,
            [...path, "prompt"],
            `a fill-in prompt has exactly one blank (3+ underscores); found ${blanks}`
          )
        const seen = new Map<string, string>()
        e.accepted.forEach((a, i) => {
          const n = normalizeAnswer(a)
          if (!n)
            out.error(
              "exercises",
              file,
              [...path, "accepted", i],
              `${quote(a)} is empty after normalizing`
            )
          else if (seen.has(n))
            out.error(
              "exercises",
              file,
              [...path, "accepted", i],
              `${quote(a)} is the same answer as ${quote(seen.get(n)!)} after normalizing`
            )
          else seen.set(n, a)
        })
      }
      if (e.type === "short" && e.pool === "review")
        out.error(
          "exercises",
          file,
          [...path, "pool"],
          "short answers are allowed in the recall and checkpoint pools only"
        )

      if (e.pool === "recall" || e.pool === "review") {
        if (e.concepts.length !== 1)
          out.error(
            "exercises",
            file,
            [...path, "concepts"],
            `a ${e.pool} exercise tags exactly one concept (found ${e.concepts.length})`
          )
        e.concepts.forEach((cid, j) => {
          const owner = this.conceptLesson.get(cid)
          if (owner && owner !== lessonId)
            out.error(
              "exercises",
              file,
              [...path, "concepts", j],
              `concept ${quote(cid)} is taught in ${owner}; a ${e.pool} exercise tags a concept of its own lesson`
            )
        })
      } else {
        const moduleId = checkpointModule.get(id)
        if (moduleId)
          e.concepts.forEach((cid, j) => {
            const owner = this.conceptLesson.get(cid)
            if (owner && this.moduleOfLesson.get(owner) !== moduleId)
              out.error(
                "exercises",
                file,
                [...path, "concepts", j],
                `concept ${quote(cid)} is taught outside module ${quote(moduleId)}; a checkpoint exercise tags concepts of its module`
              )
          })
      }

      const teaching = new Set(
        e.concepts.map((cid) => this.conceptLesson.get(cid)).filter(Boolean)
      )
      const anchorLessons = [...this.briefs]
        .filter(([, b]) => b.anchors.has(e.anchor))
        .map(([l]) => l)
      if (anchorLessons.length && !anchorLessons.some((l) => teaching.has(l)))
        out.error(
          "exercises",
          file,
          [...path, "anchor"],
          `anchor ${quote(e.anchor)} is in ${anchorLessons.join(", ")}, which teaches none of the exercise's concepts`
        )
    }
  }

  // --- Enough practice ------------------------------------------------------

  private practice() {
    for (const { lesson } of this.c.lessons)
      lesson.concepts.forEach((concept, i) => {
        const tagged = [...this.exercises.values()].filter((x) =>
          x.exercise.concepts.includes(concept.id)
        )
        for (const pool of ["recall", "review"] as const)
          if (!tagged.some((x) => x.exercise.pool === pool))
            this.out.error(
              "practice",
              this.yaml(lesson.id),
              ["concepts", i],
              `concept ${quote(concept.id)} has no ${pool} exercise`
            )
      })
  }

  // --- Checkpoints ----------------------------------------------------------

  private checkpoints() {
    const { c, out } = this
    const [min, max] = c.course.kind === "mini" ? [4, 12] : [6, 12]
    const uses = new Map<string, number>()

    c.course.modules.forEach((m, mi) => {
      const path = ["modules", mi, "checkpoint"]
      if (m.checkpoint.length < min || m.checkpoint.length > max)
        out.error(
          "checkpoints",
          this.courseFile,
          path,
          `a ${c.course.kind} course's checkpoint has ${min}–${max} exercises (found ${m.checkpoint.length})`
        )
      const tagged = new Set<string>()
      m.checkpoint.forEach((id, i) => {
        uses.set(id, (uses.get(id) ?? 0) + 1)
        const x = this.exercises.get(id)
        if (!x) return
        if (x.exercise.pool !== "checkpoint")
          out.error(
            "checkpoints",
            this.courseFile,
            [...path, i],
            `exercise ${quote(id)} is in the ${x.exercise.pool} pool; checkpoints use checkpoint exercises only`
          )
        for (const cid of x.exercise.concepts) {
          const l = this.conceptLesson.get(cid)
          if (l) tagged.add(l)
        }
      })
      m.lessons.forEach((l, li) => {
        if (!tagged.has(l))
          out.error(
            "checkpoints",
            this.courseFile,
            ["modules", mi, "lessons", li],
            `the checkpoint of ${quote(m.id)} has no exercise on lesson ${quote(l)}`
          )
      })
    })

    for (const [id, { exercise, where }] of this.exercises) {
      const n = uses.get(id) ?? 0
      if (exercise.pool === "checkpoint" && n !== 1)
        out.error(
          "checkpoints",
          where.file,
          where.path,
          n
            ? `checkpoint exercise ${quote(id)} is used ${n} times; each is in exactly one checkpoint`
            : `checkpoint exercise ${quote(id)} is in no module's checkpoint`
        )
    }
  }

  // --- Coverage -------------------------------------------------------------

  private coverage() {
    const { c, out } = this
    const advanced = new Set(c.lessons.flatMap((l) => l.lesson.keyQuestions))
    c.course.keyQuestions.forEach((q, i) => {
      if (!advanced.has(q.id))
        out.error(
          "coverage",
          this.courseFile,
          ["keyQuestions", i],
          `key question ${q.id} is advanced by no lesson`
        )
    })
    c.lessons.forEach(({ lesson }, i) => {
      const last = i === c.lessons.length - 1
      if (last && lesson.hook)
        out.error(
          "coverage",
          this.yaml(lesson.id),
          ["hook"],
          "the course's last lesson has no hook"
        )
      if (!last && !lesson.hook)
        out.error(
          "coverage",
          this.yaml(lesson.id),
          [],
          "every lesson except the course's last has a hook"
        )
    })
  }

  // --- Course shape ---------------------------------------------------------

  private shape() {
    const { c, out } = this
    if (c.course.kind === "mini") {
      if (c.course.modules.length !== 1)
        out.error(
          "shape",
          this.courseFile,
          ["modules"],
          `a mini-course has exactly 1 module (found ${c.course.modules.length})`
        )
      if (c.lessons.length < 1 || c.lessons.length > 2)
        out.error(
          "shape",
          this.courseFile,
          ["modules"],
          `a mini-course has 1–2 lessons (found ${c.lessons.length})`
        )
    }
    for (const { lesson, brief } of c.lessons) {
      const file = this.yaml(lesson.id)
      const links = [
        ...lesson.beyond.simplified,
        ...lesson.beyond.notCovered,
      ].flatMap((b) => b.links)
      const recommended = links.filter((l) => l.recommended).length
      if (recommended > 1)
        out.error(
          "shape",
          file,
          ["beyond"],
          `at most one Go deeper link per lesson is recommended (found ${recommended})`
        )
      if (links.length < 2 || links.length > 3)
        out.warn(
          "shape",
          file,
          ["beyond"],
          `a lesson usually has 2–3 Go deeper links (found ${links.length})`
        )
      const words = briefWordCount(brief)
      if (words < 700 || words > 1800)
        out.warn(
          "shape",
          this.md(lesson.id),
          [],
          `a brief is usually 700–1,800 words (found ${words})`
        )
    }
  }

  // --- Policies -------------------------------------------------------------

  private policies() {
    const { c, out } = this
    const has = (p: Policy) => c.course.policies.includes(p)
    if (has("narrow") && c.course.kind !== "mini")
      out.error(
        "policies",
        this.courseFile,
        ["kind"],
        "a narrow topic is a mini-course (kind: mini)"
      )
    if (has("contested")) {
      if (!this.contestedLabels)
        out.error(
          "policies",
          this.courseFile,
          ["policies"],
          "a contested course labels disagreement with at least one :contested[…]"
        )
      c.course.sources.forEach((s, i) => {
        if (!s.position)
          out.error(
            "policies",
            this.courseFile,
            ["sources", i, "position"],
            "every source of a contested course states its position"
          )
      })
      const positions = new Set(
        c.course.sources
          .map((s) => s.position?.trim().toLowerCase())
          .filter(Boolean)
      )
      if (positions.size < 2)
        out.error(
          "policies",
          this.courseFile,
          ["sources"],
          `a contested course's sources take at least 2 distinct positions (found ${positions.size})`
        )
    }
    for (const p of [
      "health-legal-financial-safety",
      "skill",
      "little-research",
    ] as const)
      if (has(p) && !c.course.policyNote)
        out.error(
          "policies",
          this.courseFile,
          ["policyNote"],
          `the ${p} policy needs a policyNote on the Syllabus`
        )
  }

  // --- Copyright ------------------------------------------------------------

  private copyright() {
    for (const { lesson, brief } of this.c.lessons) {
      const info = this.briefs.get(lesson.id)!
      visit(info.tree, "blockquote", (node) => {
        const { start, end } = node.position ?? {}
        if (start?.offset === undefined || end?.offset === undefined) return
        const text = brief
          .slice(start.offset, end.offset)
          .replace(/^\s*>/gm, " ")
        const words = briefWordCount(text)
        if (words > 40)
          this.out.error(
            "copyright",
            info.file,
            [],
            `${at(node)}a blockquote is at most 40 words (found ${words})`
          )
      })
    }
  }

  // --- Assets ---------------------------------------------------------------

  private assets() {
    const dir = join(this.c.dir, "assets")
    if (!isDir(dir)) return
    const used = new Set([...this.briefs.values()].flatMap((b) => b.figures))
    for (const name of visible(dir))
      if (name.toLowerCase().endsWith(".svg") && !used.has(name))
        this.out.error(
          "files",
          `${this.base}/assets/${name}`,
          [],
          "stray file: no ::figure uses this asset"
        )
  }
}

/** Directive placements in a brief. */
function briefInfo(file: string, tree: MdastRoot): BriefInfo {
  const info: BriefInfo = {
    file,
    tree,
    anchors: new Map(),
    analogies: new Map(),
    guesses: new Map(),
    misconceptions: new Map(),
    figures: [],
  }
  const add = (
    map: Map<string, Nodes[]>,
    id: string | null | undefined,
    node: Nodes
  ) => {
    if (id) map.set(id, [...(map.get(id) ?? []), node])
  }
  visit(tree, (node) => {
    if (node.type === "leafDirective") {
      const id = node.attributes?.id
      if (node.name === "anchor") add(info.anchors, id, node)
      if (node.name === "guess") add(info.guesses, id, node)
      if (node.name === "misconception") add(info.misconceptions, id, node)
      if (node.name === "figure" && node.attributes?.src)
        info.figures.push(node.attributes.src)
    }
    if (node.type === "containerDirective" && node.name === "analogy")
      add(info.analogies, node.attributes?.id, node)
  })
  return info
}

const LABEL_NAMES = new Set<string>(["cite", ...CONTENT_LABELS])

function hasCiteOrLabel(node: Nodes): boolean {
  let found = false
  visit(node, "textDirective", (d) => {
    if (LABEL_NAMES.has(d.name)) found = true
  })
  return found
}

/**
 * Body paragraphs and list items without a citation or content label.
 * Analogy blocks are exempt. A list item counts as one block: a citation
 * anywhere in its own paragraphs covers it, and nested lists are checked
 * item by item.
 */
function uncitedBlocks(tree: MdastRoot): Nodes[] {
  const found: Nodes[] = []
  const walk = (node: Nodes) => {
    if (node.type === "containerDirective" && node.name === "analogy") return
    if (node.type === "paragraph") {
      if (!hasCiteOrLabel(node)) found.push(node)
      return
    }
    if (node.type === "listItem") {
      const own = node.children.filter((n) => n.type === "paragraph")
      if (own.length && !own.some(hasCiteOrLabel)) found.push(node)
      for (const child of node.children)
        if (child.type !== "paragraph") walk(child)
      return
    }
    if ("children" in node)
      for (const child of node.children) walk(child as Nodes)
  }
  walk(tree)
  return found
}

/** Blanks the renderer would mark: runs of 3+ underscores in text nodes. */
function countBlanks(markdown: string): number {
  let n = 0
  visit(parseMarkdown(markdown), "text", (node) => {
    n += node.value.match(/_{3,}/g)?.length ?? 0
  })
  return n
}

function plainText(node: Nodes): string {
  let s = ""
  visit(node, (n) => {
    if ("value" in n && typeof n.value === "string") s += n.value
  })
  return s
}

/** Every inline `Md` field of a lesson, with its YAML path. */
function lessonInlineFields(lesson: Lesson, file: string): InlineField[] {
  const f: InlineField[] = []
  const add = (path: Finding["path"], value: string, blank = false) =>
    f.push({ file, path, value, blank })
  const opts = (list: Opt[], path: Finding["path"]) =>
    list.forEach((o, i) => add([...path, i, "text"], o.text))

  add(["whyThisMatters"], lesson.whyThisMatters)
  lesson.concepts.forEach((c, i) =>
    c.recallPrompts.forEach((p, j) => {
      add(["concepts", i, "recallPrompts", j, "prompt"], p.prompt)
      add(["concepts", i, "recallPrompts", j, "answer"], p.answer)
    })
  )
  lesson.guesses.forEach((g, i) => {
    add(["guesses", i, "prompt"], g.prompt)
    opts(g.options, ["guesses", i, "options"])
    add(["guesses", i, "why"], g.why)
  })
  lesson.misconceptions.forEach((m, i) => {
    add(["misconceptions", i, "belief"], m.belief)
    add(["misconceptions", i, "correction"], m.correction)
  })
  lesson.beyond.simplified.forEach((s, i) =>
    add(["beyond", "simplified", i, "text"], s.text)
  )
  lesson.exercises.forEach((e, i) => {
    const p = ["exercises", i]
    add([...p, "prompt"], e.prompt, e.type === "fill")
    add([...p, "explanation"], e.explanation)
    if (e.type === "scenario") add([...p, "scenario"], e.scenario)
    if (e.type === "mc" || e.type === "scenario")
      opts(e.options, [...p, "options"])
    if (e.type === "spot") {
      opts(e.sentences, [...p, "sentences"])
      opts(e.fixes, [...p, "fixes"])
    }
  })
  return f
}

// ---------------------------------------------------------------------------
// Publish checks (§11.3)

function checkAudit(
  c: LoadedCourse,
  v: CourseChecks,
  root: string,
  base: string,
  out: Findings
) {
  const dir = join(c.dir, AUDIT_DIR)
  const read = <S extends z.ZodType>(
    schema: S,
    name: string
  ): z.infer<S> | null => {
    const file = join(dir, name)
    if (!existsSync(file)) {
      out.error(
        "audit",
        `${base}/${AUDIT_DIR}/${name}`,
        [],
        "file not found: the check stage writes it (§11.3)"
      )
      return null
    }
    try {
      return parseContentFile(schema, root, file, "yaml")
    } catch (error) {
      if (!(error instanceof ContentError)) throw error
      for (const i of error.issues)
        out.error("audit", error.file, i.path, i.message)
      return null
    }
  }

  const claims = read(ClaimsAudit, AUDIT_FILES.claims)
  if (claims)
    checkClaims(c, v, claims, `${base}/${AUDIT_DIR}/${AUDIT_FILES.claims}`, out)
  const solve = read(BlindSolveAudit, AUDIT_FILES.blindSolve)
  if (solve)
    checkBlindSolve(
      v,
      solve,
      `${base}/${AUDIT_DIR}/${AUDIT_FILES.blindSolve}`,
      out
    )
  const review = read(ReviewAudit, AUDIT_FILES.review)
  if (review)
    checkReview(review, `${base}/${AUDIT_DIR}/${AUDIT_FILES.review}`, out)
}

function checkClaims(
  c: LoadedCourse,
  v: CourseChecks,
  audit: ClaimsAudit,
  file: string,
  out: Findings
) {
  const covered = new Map<string, Set<string>>()
  audit.claims.forEach((entry, i) => {
    if (!c.lessonsById.has(entry.lesson))
      out.error(
        "audit",
        file,
        ["claims", i, "lesson"],
        `unknown lesson ${quote(entry.lesson)}`
      )
    if (!c.sourceNumbers.has(entry.source))
      out.error(
        "audit",
        file,
        ["claims", i, "source"],
        `unknown source ${quote(entry.source)}`
      )
    const set =
      covered.get(entry.lesson) ??
      covered.set(entry.lesson, new Set()).get(entry.lesson)!
    set.add(entry.source)
  })
  for (const { lesson } of c.lessons)
    for (const source of v.citedByLesson.get(lesson.id) ?? [])
      if (c.sourceNumbers.has(source) && !covered.get(lesson.id)?.has(source))
        out.error(
          "audit",
          file,
          ["claims"],
          `no claim checks ${quote(source)}, which ${lesson.id} cites`
        )
}

function checkBlindSolve(
  v: CourseChecks,
  audit: BlindSolveAudit,
  file: string,
  out: Findings
) {
  const seen = new Set<string>()
  audit.exercises.forEach((entry, i) => {
    const path = ["exercises", i]
    const x = v.exercises.get(entry.exercise)
    if (!x) {
      out.error(
        "audit",
        file,
        [...path, "exercise"],
        `unknown exercise ${quote(entry.exercise)}`
      )
      return
    }
    if (seen.has(entry.exercise)) {
      out.error(
        "audit",
        file,
        [...path, "exercise"],
        `${quote(entry.exercise)} has more than one entry`
      )
      return
    }
    seen.add(entry.exercise)
    const e = x.exercise
    if (e.type === "short") {
      out.error(
        "audit",
        file,
        [...path, "exercise"],
        `${quote(e.id)} is a short answer, which is not automatically marked`
      )
      return
    }
    if (e.type === "fill") {
      if (!("answer" in entry)) {
        out.error(
          "audit",
          file,
          path,
          `fill-in ${quote(e.id)} needs the solver's own answer`
        )
        return
      }
      const accepted = new Set(e.accepted.map(normalizeAnswer))
      if (!accepted.has(normalizeAnswer(entry.answer)))
        out.error(
          "audit",
          file,
          [...path, "answer"],
          `the solver's answer ${quote(entry.answer)} is not accepted by ${quote(e.id)}`
        )
      return
    }
    if (!("options" in entry)) {
      out.error(
        "audit",
        file,
        path,
        `${quote(e.id)} needs a verdict on every option`
      )
      return
    }
    const groups: { label: string; list: Opt[]; key: string }[] =
      e.type === "spot"
        ? [
            { label: "sentence", list: e.sentences, key: e.faulty },
            { label: "fix", list: e.fixes, key: e.correctFix },
          ]
        : [{ label: "option", list: e.options, key: e.correct }]
    const verdicts = new Map<string, string>()
    const known = new Set(groups.flatMap((g) => g.list.map((o) => o.id)))
    entry.options.forEach((o, j) => {
      if (!known.has(o.option))
        out.error(
          "audit",
          file,
          [...path, "options", j, "option"],
          `${quote(o.option)} is not an option of ${quote(e.id)}`
        )
      else if (verdicts.has(o.option))
        out.error(
          "audit",
          file,
          [...path, "options", j, "option"],
          `${quote(o.option)} has two verdicts`
        )
      verdicts.set(o.option, o.verdict)
    })
    for (const g of groups) {
      const missing = g.list.filter((o) => !verdicts.has(o.id))
      for (const o of missing)
        out.error(
          "audit",
          file,
          [...path, "options"],
          `no verdict on ${g.label} ${quote(o.id)}`
        )
      if (missing.length) continue
      const defensible = g.list
        .filter((o) => verdicts.get(o.id) === "defensible")
        .map((o) => o.id)
      if (defensible.length !== 1)
        out.error(
          "audit",
          file,
          [...path, "options"],
          `${quote(e.id)} has ${defensible.length} defensible ${g.label}s; exactly one must be`
        )
      else if (defensible[0] !== g.key)
        out.error(
          "audit",
          file,
          [...path, "options"],
          `the solver defends ${quote(defensible[0])}, but the key of ${quote(e.id)} is ${quote(g.key)}`
        )
    }
  })
  for (const [id, { exercise }] of v.exercises)
    if (exercise.type !== "short" && !seen.has(id))
      out.error(
        "audit",
        file,
        ["exercises"],
        `no entry for exercise ${quote(id)}`
      )
}

function checkReview(audit: ReviewAudit, file: string, out: Findings) {
  audit.findings.forEach((f, i) => {
    if (!f.resolution)
      out.error(
        "audit",
        file,
        ["findings", i, "resolution"],
        "every finding needs a resolution"
      )
  })
  for (const area of REVIEW_AREAS)
    if (!audit.findings.some((f) => f.area === area))
      out.error(
        "audit",
        file,
        ["findings"],
        `no finding covers ${area}; record one even when nothing needed fixing`
      )
}

// ---------------------------------------------------------------------------
// Online (`--online`; never in CI)

export type UrlFetch = (
  url: string,
  init: { method: string; signal: AbortSignal; redirect: "follow" }
) => Promise<{ status: number; body?: { cancel(): Promise<void> } | null }>

/**
 * Every URL a course shows: sources, Go deeper links, and Markdown links in
 * briefs and inline fields, with where each is.
 */
export function courseUrls(c: LoadedCourse): (Where & { url: string })[] {
  const base = `courses/${c.id}`
  const courseFile = `${base}/course.yaml`
  const urls: (Where & { url: string })[] = c.course.sources.map((s, i) => ({
    url: s.url,
    file: courseFile,
    path: ["sources", i, "url"],
  }))
  const markdownLinks = (markdown: string, where: Where) =>
    visit(parseMarkdown(markdown), (node) => {
      if (
        (node.type === "link" || node.type === "definition") &&
        /^https?:\/\//i.test(node.url)
      )
        urls.push({ url: node.url, ...where })
    })

  markdownLinks(c.course.outOfScope, { file: courseFile, path: ["outOfScope"] })
  if (c.course.policyNote)
    markdownLinks(c.course.policyNote, {
      file: courseFile,
      path: ["policyNote"],
    })
  for (const { lesson, brief } of c.lessons) {
    const file = `${base}/lessons/${lesson.id}.yaml`
    for (const kind of ["simplified", "notCovered"] as const)
      lesson.beyond[kind].forEach((entry, i) =>
        entry.links.forEach((link, j) =>
          urls.push({
            url: link.url,
            file,
            path: ["beyond", kind, i, "links", j, "url"],
          })
        )
      )
    markdownLinks(brief, { file: `${base}/lessons/${lesson.id}.md`, path: [] })
    for (const f of lessonInlineFields(lesson, file))
      markdownLinks(f.value, { file: f.file, path: f.path })
  }
  return urls
}

/**
 * Checks that every URL answers 2xx: HEAD first, then GET when HEAD is
 * refused or fails. Response bodies are discarded, not downloaded.
 */
export async function checkUrls(
  c: LoadedCourse,
  fetchUrl: UrlFetch = fetch as unknown as UrlFetch,
  { timeoutMs = 15_000, concurrency = 4 } = {}
): Promise<Finding[]> {
  const findings: Finding[] = []
  const status = async (url: string, method: string) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchUrl(url, {
        method,
        signal: controller.signal,
        redirect: "follow",
      })
      await res.body?.cancel().catch(() => {})
      return res.status
    } finally {
      clearTimeout(timer)
    }
  }
  const describe = (error: unknown) =>
    `did not answer (${error instanceof Error ? error.message : String(error)})`
  const answer = async (url: string): Promise<string | null> => {
    let s: number | null = null
    try {
      s = await status(url, "HEAD")
    } catch {
      // Some servers drop HEAD; GET decides.
    }
    if (s === null || s < 200 || s >= 300)
      try {
        s = await status(url, "GET")
      } catch (error) {
        return describe(error)
      }
    return s >= 200 && s < 300 ? null : `answered ${s}`
  }
  // A few requests at a time, so a host that many links share does not
  // rate-limit valid links into failures.
  const urls = courseUrls(c)
  const unique = [...new Set(urls.map((u) => u.url))]
  const results = new Map<string, string | null>()
  let next = 0
  const worker = async () => {
    while (next < unique.length) {
      const url = unique[next++]
      results.set(url, await answer(url))
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, unique.length) }, worker)
  )
  const answers = urls.map((u) => results.get(u.url) ?? null)
  urls.forEach((u, i) => {
    if (answers[i])
      findings.push({
        level: "error",
        rule: "online",
        file: u.file,
        path: u.path,
        message: `${u.url} ${answers[i]}`,
      })
  })
  return findings
}
