// Brief and inline Markdown rendering (§5.3, §5.4).
//
//   remark-parse → remark-gfm → remark-math → remark-directive → remarkPlato
//   → remark-rehype (no raw HTML) → rehype-katex
//
// The output is HAST. It is the expensive part, so `getRenderedLesson` keeps
// it for the life of the process in production. Turning HAST into React
// elements is cheap and happens per request (`components/plato/content.tsx`),
// where learner data such as a guess pick reaches the component map as props.
//
// `remarkPlato` is also the directive parser the validator imports (§5.5):
// `checkBrief` and `checkInline` return every problem it finds, so the app and
// the validator cannot disagree about what a brief means.
//
// No `server-only` here: the validator loads it in plain Node.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { Element, ElementContent, Root as HastRoot } from "hast"
import type {
  Nodes,
  Paragraph,
  PhrasingContent,
  Root as MdastRoot,
  Text,
} from "mdast"
import type {
  ContainerDirective,
  LeafDirective,
  TextDirective,
} from "mdast-util-directive"
import rehypeKatex from "rehype-katex"
import remarkDirective from "remark-directive"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"
import { SKIP, visit } from "unist-util-visit"

import {
  contentRoot,
  ContentError,
  getCourse,
  type ContentIssue,
  type LoadedCourse,
  type LoadOptions,
} from "./load"
import { memo } from "./memo"
import type { Exercise, Lesson, Opt, QId } from "./schema"
import { sanitizeSvg } from "./svg"

// ---------------------------------------------------------------------------
// Context

/** What directives resolve against. */
export type RenderContext = {
  /** Source id → citation number (`LoadedCourse.sourceNumbers`). */
  sourceNumbers: ReadonlyMap<string, number>
  /** The lesson whose brief this is; guesses and misconceptions resolve here. */
  lesson?: Lesson
  /** The course's `assets/` folder, for `::figure`. */
  assetsDir?: string
}

export const CONTENT_LABELS = ["uncertain", "general", "contested"] as const
export type ContentLabelKind = (typeof CONTENT_LABELS)[number]

const KNOWN_TEXT_DIRECTIVES = new Set<string>(["cite", ...CONTENT_LABELS])
/** Leaf and container directives, for a clearer error when written inline. */
const BLOCK_DIRECTIVES = new Set([
  "anchor",
  "guess",
  "misconception",
  "figure",
  "analogy",
])

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** A file name in `assets/`: no folders, no `..`. */
const FIGURE_SRC = /^[a-z0-9]+([._-][a-z0-9]+)*\.svg$/i

// ---------------------------------------------------------------------------
// remarkPlato

type Mode = "brief" | "inline"

type PlatoOptions = {
  ctx: RenderContext
  mode: Mode
  /** Turn each run of 3+ underscores into a `plato-blank` (fill prompts). */
  blank?: boolean
  /** A problem that stops rendering. */
  error: (message: string, node?: Nodes) => void
  /** A problem the renderer fixed (SVG sanitizing); still a validation error. */
  sanitized: (message: string, node?: Nodes) => void
}

type Directive = ContainerDirective | LeafDirective | TextDirective

/**
 * Turns the closed directive set into `plato-*` elements and rejects what a
 * brief may not hold (§5.3): unknown directives, raw HTML, Markdown images,
 * footnotes and headings deeper than `###`. In inline mode the value must be
 * a single paragraph (`run` unwraps it to its phrasing content after the HAST
 * conversion, which would otherwise put line breaks between the children).
 *
 * Elements it produces (their HAST properties in brackets):
 *
 * - `plato-cite` [dataSources, dataNumbers]: space-separated, in written order
 * - `plato-label` [dataKind]: wraps the claim
 * - `plato-anchor` [id]
 * - `plato-guess` [dataId], `plato-misconception` [dataId]: empty; the
 *   component looks the id up in the rendered lesson
 * - `plato-analogy` [id]: wraps its block content
 * - `plato-figure` [dataSrc, dataAlt, dataCaption]: holds the sanitized `<svg>`
 * - `plato-blank`: a fill-in blank
 */
function remarkPlato(opts: PlatoOptions) {
  const { ctx, mode, error, sanitized } = opts

  const attrs = (node: Directive, allowed: string[]) => {
    for (const key of Object.keys(node.attributes ?? {}))
      if (!allowed.includes(key))
        error(
          `${syntax(node)} has an unknown attribute "${key === "class" ? "." : key}"`,
          node
        )
    return node.attributes ?? {}
  }

  const noLabel = (node: LeafDirective) => {
    if (node.children.length) error(`${syntax(node)} takes no [label]`, node)
  }

  const idAttr = (node: Directive): string | null => {
    const id = attrs(node, ["id"]).id
    if (!id) {
      error(
        `${syntax(node)} needs an id, as in ${syntax(node)}{#some-id}`,
        node
      )
      return null
    }
    if (!ID.test(id)) {
      error(`${syntax(node)}{#${id}}: the id must be kebab-case`, node)
      return null
    }
    return id
  }

  const set = (
    node: Directive,
    hName: string,
    hProperties: Record<string, string> = {},
    hChildren?: ElementContent[]
  ) => {
    node.data = { hName, hProperties, ...(hChildren ? { hChildren } : {}) }
  }

  const textDirective = (node: TextDirective) => {
    if (node.name === "cite") {
      attrs(node, [])
      const ids = labelText(node)
        .split(",")
        .map((s) => s.trim())
      const numbers: number[] = []
      for (const id of ids) {
        const n = id ? ctx.sourceNumbers.get(id) : undefined
        if (n === undefined)
          error(
            id
              ? `:cite: unknown source "${id}"`
              : ":cite needs source ids, as in :cite[src-a,src-b]",
            node
          )
        else numbers.push(n)
      }
      set(
        node,
        "plato-cite",
        { dataSources: ids.join(" "), dataNumbers: numbers.join(" ") },
        []
      )
      return
    }
    if ((CONTENT_LABELS as readonly string[]).includes(node.name)) {
      attrs(node, [])
      if (!labelText(node).trim())
        error(
          `${syntax(node)} needs the claim it labels, as in :${node.name}[…]`,
          node
        )
      set(node, "plato-label", { dataKind: node.name })
      return
    }
    if (node.name === "analogy")
      error(
        ":analogy is a block: wrap whole paragraphs in :::analogy{#id} … :::",
        node
      )
    else if (BLOCK_DIRECTIVES.has(node.name))
      error(
        `:${node.name} must be on its own line, as in ::${node.name}${node.name === "figure" ? '{src="x.svg" alt="…"}' : "{#id}"}`,
        node
      )
    else error(`unknown directive ${syntax(node)}`, node)
  }

  const leafDirective = (node: LeafDirective) => {
    if (mode === "inline") {
      error(`${syntax(node)} can only be used in a brief`, node)
      return
    }
    switch (node.name) {
      case "anchor": {
        noLabel(node)
        const id = idAttr(node)
        if (id) set(node, "plato-anchor", { id })
        return
      }
      case "guess":
      case "misconception": {
        noLabel(node)
        const id = idAttr(node)
        if (!id) return
        const list =
          node.name === "guess"
            ? ctx.lesson?.guesses
            : ctx.lesson?.misconceptions
        if (!list?.some((x) => x.id === id))
          error(
            `${syntax(node)}{#${id}}: the lesson has no ${node.name} "${id}"`,
            node
          )
        set(node, `plato-${node.name}`, { dataId: id })
        return
      }
      case "figure":
        noLabel(node)
        figure(node)
        return
      default:
        error(`unknown directive ${syntax(node)}`, node)
    }
  }

  let figureCount = 0
  const figure = (node: LeafDirective) => {
    const a = attrs(node, ["src", "alt", "caption"])
    const src = a.src ?? ""
    const alt = a.alt ?? ""
    const caption = a.caption ?? ""
    if (!alt.trim()) error(`::figure needs alt text`, node)
    if (!FIGURE_SRC.test(src)) {
      error(
        `::figure src must be an .svg file name in assets/ (got ${JSON.stringify(src)})`,
        node
      )
      return
    }
    let source: string
    try {
      if (!ctx.assetsDir) throw new Error("no assets folder")
      source = readFileSync(join(ctx.assetsDir, src), "utf8")
    } catch {
      error(`::figure: assets/${src} not found`, node)
      return
    }
    figureCount += 1
    const stem = src
      .replace(/\.svg$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
    const { svg, issues } = sanitizeSvg(source, {
      idPrefix: `fig-${stem}-${figureCount}`,
      alt: alt.trim(),
    })
    for (const issue of issues)
      sanitized(`assets/${src}: ${issue.message}`, node)
    set(
      node,
      "plato-figure",
      { dataSrc: src, dataAlt: alt.trim(), dataCaption: caption.trim() },
      svg ? [svg] : []
    )
  }

  const containerDirective = (node: ContainerDirective) => {
    if (mode === "inline") {
      error(`${syntax(node)} can only be used in a brief`, node)
      return
    }
    if (node.name !== "analogy") {
      error(`unknown directive ${syntax(node)}`, node)
      return
    }
    const id = idAttr(node)
    // The `[label]` of a container is its first child paragraph.
    const first = node.children[0]
    if (
      first?.data &&
      "directiveLabel" in first.data &&
      first.data.directiveLabel
    )
      error(`:::analogy takes no [label]`, node)
    if (!node.children.length) error(`:::analogy{#${id}} is empty`, node)
    set(node, "plato-analogy", id ? { id } : {})
  }

  return (tree: MdastRoot, file: { value: unknown }) => {
    const source = String(file.value)
    visit(tree, (node, index, parent) => {
      switch (node.type) {
        case "html":
          error("raw HTML is not allowed", node)
          return
        case "image":
        case "imageReference":
          error("Markdown images are not allowed; use ::figure", node)
          return
        case "delete":
          error("strikethrough is not allowed", node)
          return
        case "listItem":
          if (typeof node.checked === "boolean")
            error("task list items are not allowed", node)
          return
        case "link":
          // GFM autolink literals (a bare URL in prose) are not CommonMark.
          // `[text](url)` and `<url>` are.
          if (!/^[[<]/.test(source.slice(node.position?.start.offset ?? 0)))
            error(
              `bare URLs are not allowed; write [text](${node.url}) or <${node.url}>`,
              node
            )
          return
        case "footnoteReference":
        case "footnoteDefinition":
          error("footnotes are not allowed", node)
          return
        case "heading":
          if (mode === "inline") error("headings are not allowed here", node)
          else if (node.depth > 3)
            error(
              `headings go down to ### (found ${"#".repeat(node.depth)})`,
              node
            )
          return
        case "textDirective": {
          // `a:b`, `12:30` and `Note:this` parse as bare text directives. One
          // that is not in the closed set and has no [label] and no
          // {attributes} is put back as text. A known name always needs its
          // brackets, so a forgotten `[…]` after `:cite` is an error.
          if (
            !KNOWN_TEXT_DIRECTIVES.has(node.name) &&
            !node.children.length &&
            !Object.keys(node.attributes ?? {}).length &&
            !hasBrackets(node) &&
            parent &&
            index !== undefined
          ) {
            parent.children[index] = { type: "text", value: `:${node.name}` }
            return SKIP
          }
          textDirective(node)
          return
        }
        case "leafDirective":
          leafDirective(node)
          return
        case "containerDirective":
          containerDirective(node)
          return
      }
    })

    if (mode === "inline") checkSingleParagraph(tree, error)
    if (opts.blank) markBlanks(tree)
  }
}

/** `[]` written after a text directive, even when empty: `:cite[]`. */
function hasBrackets(node: TextDirective): boolean {
  const { start, end } = node.position ?? {}
  return !!start && !!end && end.offset! - start.offset! > node.name.length + 1
}

function syntax(node: Directive): string {
  const colons =
    node.type === "containerDirective"
      ? ":::"
      : node.type === "leafDirective"
        ? "::"
        : ":"
  return `${colons}${node.name}`
}

function labelText(node: { children: PhrasingContent[] }): string {
  let s = ""
  visit({ type: "paragraph", children: node.children } as Paragraph, (n) => {
    if ("value" in n && typeof n.value === "string") s += n.value
  })
  return s
}

function checkSingleParagraph(
  tree: MdastRoot,
  error: (message: string, node?: Nodes) => void
): void {
  // Link reference definitions render nothing and are not block content.
  const blocks = tree.children.filter((n) => n.type !== "definition")
  const [only] = blocks
  if (blocks.length !== 1 || only.type !== "paragraph") {
    const kind = blocks.find((n) => n.type !== "paragraph")?.type
    error(
      kind
        ? `must be inline Markdown, without block elements (found ${describeBlock(kind)})`
        : "must be a single paragraph",
      blocks[1] ?? only
    )
    return
  }
}

function describeBlock(type: string): string {
  return (
    {
      list: "a list",
      blockquote: "a blockquote",
      code: "a code block",
      math: "display math",
      table: "a table",
      thematicBreak: "a horizontal rule",
      heading: "a heading",
      leafDirective: "a directive",
      containerDirective: "a directive",
    }[type] ?? type
  )
}

/** Splits text nodes on runs of 3+ underscores into `plato-blank`s. */
function markBlanks(tree: MdastRoot): void {
  visit(tree, "text", (node: Text, index, parent) => {
    if (!parent || index === undefined || !/_{3,}/.test(node.value)) return
    const parts: Text[] = []
    let last = 0
    for (const m of node.value.matchAll(/_{3,}/g)) {
      if (m.index > last)
        parts.push({ type: "text", value: node.value.slice(last, m.index) })
      parts.push({
        type: "text",
        value: m[0],
        data: { hName: "plato-blank", hChildren: [] },
      })
      last = m.index + m[0].length
    }
    if (last < node.value.length)
      parts.push({ type: "text", value: node.value.slice(last) })
    parent.children.splice(index, 1, ...parts)
    return index + parts.length
  })
}

// ---------------------------------------------------------------------------
// Pipeline

export type RenderIssue = ContentIssue & {
  /** True when the renderer removed the problem (SVG); still a validation error. */
  sanitized?: boolean
}

type RunResult = { tree: HastRoot; issues: RenderIssue[] }

function run(
  markdown: string,
  ctx: RenderContext,
  mode: Mode,
  extra: { blank?: boolean } = {}
): RunResult {
  const issues: RenderIssue[] = []
  const at = (node?: Nodes) =>
    mode === "brief" && node?.position
      ? `line ${node.position.start.line}: `
      : ""
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDirective)
    .use(remarkPlato, {
      ctx,
      mode,
      blank: extra.blank,
      error: (message, node) =>
        issues.push({ path: [], message: at(node) + message }),
      sanitized: (message, node) =>
        issues.push({ path: [], message: at(node) + message, sanitized: true }),
    })
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeKatex, { strict: "ignore", output: "htmlAndMathml" })

  const tree = processor.runSync(
    processor.parse(markdown),
    markdown
  ) as HastRoot
  if (mode === "inline") {
    const [p] = tree.children
    if (tree.children.length === 1 && p.type === "element" && p.tagName === "p")
      tree.children = p.children
  }

  // rehype-katex reports formulas it cannot render as file messages and
  // leaves a `.katex-error` in place (§11.4 checks for it too).
  visit(tree, "element", (el: Element) => {
    const cls = el.properties.className
    if (Array.isArray(cls) && cls.includes("katex-error"))
      issues.push({
        path: [],
        message: `math does not render: ${String(el.properties.title ?? "").replace(/^ParseError: KaTeX parse error: /, "")}`,
      })
  })
  return { tree, issues }
}

/** Every problem in a brief (for the validator). */
export function checkBrief(
  markdown: string,
  ctx: RenderContext
): RenderIssue[] {
  return run(markdown, ctx, "brief").issues
}

/** Every problem in an inline `Md` value (for the validator). */
export function checkInline(
  markdown: string,
  ctx: RenderContext,
  opts: { blank?: boolean } = {}
): RenderIssue[] {
  return run(markdown, ctx, "inline", opts).issues
}

function orThrow(
  result: RunResult,
  file: string,
  path: (string | number)[]
): HastRoot {
  const fatal = result.issues.filter((i) => !i.sanitized)
  if (fatal.length)
    throw new ContentError(
      file,
      fatal.map((i) => ({ path, message: i.message }))
    )
  return result.tree
}

/**
 * A brief as HAST. Throws a `ContentError` naming `file` when the brief does
 * not parse; SVG problems are sanitized away instead (the validator reports
 * them).
 */
export function renderBrief(
  markdown: string,
  ctx: RenderContext,
  file = "brief"
): HastRoot {
  return orThrow(run(markdown, ctx, "brief"), file, [])
}

/** An inline `Md` value as HAST phrasing content. */
export function renderInline(
  markdown: string,
  ctx: RenderContext,
  opts: { blank?: boolean; file?: string; path?: (string | number)[] } = {}
): HastRoot {
  return orThrow(
    run(markdown, ctx, "inline", opts),
    opts.file ?? "inline Markdown",
    opts.path ?? []
  )
}

// ---------------------------------------------------------------------------
// Rendered lessons

export type RenderedOptions = Record<string, HastRoot>

export type RenderedExercise = {
  prompt: HastRoot
  explanation: HastRoot
  scenario?: HastRoot
  options?: RenderedOptions
  sentences?: RenderedOptions
  fixes?: RenderedOptions
}

/** A lesson's brief and every inline `Md` field, as HAST, keyed by id. */
export type RenderedLesson = {
  courseId: string
  lessonId: string
  brief: HastRoot
  /** With a `plato-question` chip [dataId] appended per key question. */
  whyThisMatters: HastRoot
  /** Concept id → its recall prompts, in order. */
  concepts: Record<string, { prompt: HastRoot; answer: HastRoot }[]>
  guesses: Record<
    string,
    {
      prompt: HastRoot
      options: RenderedOptions
      correct: string
      why: HastRoot
    }
  >
  misconceptions: Record<string, { belief: HastRoot; correction: HastRoot }>
  /** `beyond.simplified` id → its text. */
  simplified: Record<string, HastRoot>
  exercises: Record<string, RenderedExercise>
}

export type RenderedCourse = {
  outOfScope: HastRoot
  policyNote: HastRoot | null
}

function lessonFiles(courseId: string, lessonId: string) {
  const base = `courses/${courseId}/lessons/${lessonId}`
  return { yaml: `${base}.yaml`, md: `${base}.md` }
}

/** Renders one lesson of a loaded course. Not memoized. */
export function renderLesson(
  course: LoadedCourse,
  lessonId: string
): RenderedLesson {
  const loaded = course.lessonsById.get(lessonId)
  if (!loaded)
    throw new Error(`course "${course.id}" has no lesson "${lessonId}"`)
  const { lesson } = loaded
  const files = lessonFiles(course.id, lessonId)
  const ctx: RenderContext = {
    sourceNumbers: course.sourceNumbers,
    lesson,
    assetsDir: join(course.dir, "assets"),
  }
  const md = (value: string, path: (string | number)[], blank = false) =>
    renderInline(value, ctx, { file: files.yaml, path, blank })
  const opts = (list: Opt[], path: (string | number)[]): RenderedOptions =>
    Object.fromEntries(
      list.map((o, i) => [o.id, md(o.text, [...path, i, "text"])])
    )

  const whyThisMatters = md(lesson.whyThisMatters, ["whyThisMatters"])
  for (const q of lesson.keyQuestions)
    whyThisMatters.children.push(...questionChip(q))

  return {
    courseId: course.id,
    lessonId,
    brief: renderBrief(loaded.brief, ctx, files.md),
    whyThisMatters,
    concepts: Object.fromEntries(
      lesson.concepts.map((c, i) => [
        c.id,
        c.recallPrompts.map((p, j) => ({
          prompt: md(p.prompt, ["concepts", i, "recallPrompts", j, "prompt"]),
          answer: md(p.answer, ["concepts", i, "recallPrompts", j, "answer"]),
        })),
      ])
    ),
    guesses: Object.fromEntries(
      lesson.guesses.map((g, i) => [
        g.id,
        {
          prompt: md(g.prompt, ["guesses", i, "prompt"]),
          options: opts(g.options, ["guesses", i, "options"]),
          correct: g.correct,
          why: md(g.why, ["guesses", i, "why"]),
        },
      ])
    ),
    misconceptions: Object.fromEntries(
      lesson.misconceptions.map((m, i) => [
        m.id,
        {
          belief: md(m.belief, ["misconceptions", i, "belief"]),
          correction: md(m.correction, ["misconceptions", i, "correction"]),
        },
      ])
    ),
    simplified: Object.fromEntries(
      lesson.beyond.simplified.map((s, i) => [
        s.id,
        md(s.text, ["beyond", "simplified", i, "text"]),
      ])
    ),
    exercises: Object.fromEntries(
      lesson.exercises.map((e, i) => [
        e.id,
        renderExercise(e, ["exercises", i], md, opts),
      ])
    ),
  }
}

function renderExercise(
  e: Exercise,
  path: (string | number)[],
  md: (value: string, path: (string | number)[], blank?: boolean) => HastRoot,
  opts: (list: Opt[], path: (string | number)[]) => RenderedOptions
): RenderedExercise {
  const out: RenderedExercise = {
    prompt: md(e.prompt, [...path, "prompt"], e.type === "fill"),
    explanation: md(e.explanation, [...path, "explanation"]),
  }
  if (e.type === "scenario")
    out.scenario = md(e.scenario, [...path, "scenario"])
  if (e.type === "mc" || e.type === "scenario")
    out.options = opts(e.options, [...path, "options"])
  if (e.type === "spot") {
    out.sentences = opts(e.sentences, [...path, "sentences"])
    out.fixes = opts(e.fixes, [...path, "fixes"])
  }
  return out
}

function questionChip(q: QId): ElementContent[] {
  return [
    { type: "text", value: " " },
    {
      type: "element",
      tagName: "plato-question",
      properties: { dataId: q },
      children: [],
    },
  ]
}

/**
 * A lesson's rendered brief and inline fields, or null when the course or
 * lesson is unknown. Memoized for the life of the process in production.
 */
export function getRenderedLesson(
  courseId: string,
  lessonId: string,
  opts: LoadOptions = {}
): RenderedLesson | null {
  const root = opts.root ?? contentRoot()
  const course = getCourse(courseId, { ...opts, root })
  if (!course?.lessonsById.has(lessonId)) return null
  return memo(`rendered\0${root}\0${courseId}\0${lessonId}`, () =>
    readOnly(renderLesson(course, lessonId))
  )
}

/** The course's own inline fields (the Syllabus line, spec F9). Memoized in production. */
export function getRenderedCourse(
  courseId: string,
  opts: LoadOptions = {}
): RenderedCourse | null {
  const root = opts.root ?? contentRoot()
  const course = getCourse(courseId, { ...opts, root })
  if (!course) return null
  return memo(`rendered-course\0${root}\0${courseId}`, () => {
    const ctx: RenderContext = { sourceNumbers: course.sourceNumbers }
    const file = `courses/${courseId}/course.yaml`
    const { outOfScope, policyNote } = course.course
    return readOnly({
      outOfScope: renderInline(outOfScope, ctx, { file, path: ["outOfScope"] }),
      policyNote: policyNote
        ? renderInline(policyNote, ctx, { file, path: ["policyNote"] })
        : null,
    })
  })
}

/**
 * Rendered trees are shared: in production one object serves every request.
 * Outside production they are frozen, so a caller that changes one fails in
 * development instead of corrupting the cache. Copy a tree before changing it.
 */
function readOnly<T>(value: T): T {
  if (process.env.NODE_ENV === "production") return value
  const freeze = (v: unknown) => {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      Object.freeze(v)
      for (const child of Object.values(v)) freeze(child)
    }
  }
  freeze(value)
  return value
}
