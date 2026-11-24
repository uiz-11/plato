// Rendered content (HAST from `lib/content/render.ts`) to React elements, per
// request (§5.4). The HAST is memoized; this step is cheap and is where
// learner data reaches the component map, as ordinary props.
//
// Nothing here uses browser APIs or state (only `useId`), so it runs in Server Components,
// and its output can be passed into client components as `ReactNode` props
// (prompts, options, explanations) without shipping Markdown or KaTeX code to
// the browser.
//
// The layouts that show content import `katex/dist/katex.min.css`.

import type { Element, Root } from "hast"
import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime"
import { useId, type ComponentProps, type ReactNode } from "react"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"

import type { ContentLabelKind, RenderedLesson } from "@/lib/content/render"
import { withIdSuffix } from "@/lib/content/svg"
import { cn } from "@/lib/utils"

import { CitationChip } from "./citation-chip"
import { ContentLabel } from "./content-label"

export type ContentContext = {
  courseId: string
  /** Where the content is shown. In the player, citations open a new tab. */
  surface: "course" | "player"
  /** The lesson the content belongs to; `::guess` and `::misconception` need it. */
  lesson?: RenderedLesson
  /** Guess id → the option the learner picked (WF-E3 "Your guess"). */
  guessPicks?: Readonly<Record<string, string | undefined>>
  /**
   * Prefixes the brief's own ids (anchors, analogies) and in-page links to
   * them. A page that shows a brief twice, such as a `BriefSheet` beside the
   * brief, gives one copy a prefix so ids stay unique; scroll to an anchor
   * with `contentId(ctx, anchorId)`.
   */
  idPrefix?: string
  /** Replaces or adds elements, e.g. an input for `plato-blank` in the player. */
  components?: Partial<ContentComponents>
}

/**
 * Props of a `plato-*` element: its HAST properties as attributes
 * (`dataNumbers` arrives as `data-numbers`), and its children.
 */
export type PlatoProps = Record<string, unknown> & { children?: ReactNode }

/** The `plato-*` elements `remarkPlato` produces, plus the HTML ones styled here. */
export type ContentComponents = Components &
  Record<`plato-${string}`, (props: PlatoProps) => ReactNode>

const attr = (props: PlatoProps, name: string): string => {
  const v = props[name]
  return v === undefined || v === null ? "" : String(v)
}

/** The DOM id an authored id (anchor, analogy) gets under `ctx.idPrefix`. */
export function contentId(
  ctx: Pick<ContentContext, "idPrefix">,
  id: string
): string {
  return ctx.idPrefix ? `${ctx.idPrefix}-${id}` : id
}

/** Renders a HAST tree from `lib/content/render.ts`. */
export function renderContent(tree: Root, ctx: ContentContext): ReactNode {
  const { tree: lifted, svgs } = liftFigures(tree)
  return toJsxRuntime(lifted, {
    Fragment,
    jsx,
    jsxs,
    components: {
      ...components(ctx, svgs),
      ...ctx.components,
    } as Components,
  })
}

/**
 * Swaps each figure's `<svg>` for a `plato-figure-svg` placeholder (without
 * changing the shared, memoized tree), which renders as `FigureSvg` with ids
 * unique to this render. The figure, built in or replaced through
 * `ctx.components`, receives it as its children.
 */
function liftFigures(tree: Root): { tree: Root; svgs: Element[] } {
  const svgs: Element[] = []
  const walk = <T extends Root | Element>(node: T): T => {
    let changed = false
    const children = node.children.map((child) => {
      if (child.type !== "element") return child
      if (child.tagName === "plato-figure") {
        changed = true
        const svg = child.children.find(
          (c): c is Element => c.type === "element"
        )
        if (svg) svgs.push(svg)
        return {
          ...child,
          children: svg
            ? [
                {
                  type: "element",
                  tagName: "plato-figure-svg",
                  properties: { dataFigure: String(svgs.length - 1) },
                  children: [],
                },
              ]
            : [],
        } satisfies Element
      }
      const next = walk(child)
      if (next !== child) changed = true
      return next
    })
    return changed ? { ...node, children } : node
  }
  return { tree: walk(tree), svgs }
}

/** An inlined figure whose ids are unique to this render. */
function FigureSvg({ svg }: { svg: Element }) {
  const suffix = useId().replace(/[^a-zA-Z0-9]/g, "")
  return toJsxRuntime(withIdSuffix(svg, suffix), { Fragment, jsx, jsxs })
}

/** `renderContent` as a component. */
export function Content({ tree, ctx }: { tree: Root; ctx: ContentContext }) {
  return renderContent(tree, ctx)
}

/** A brief: the body of WF-E3, the course page's brief and `BriefSheet`. */
export function Brief({
  ctx,
  className,
}: {
  ctx: ContentContext & { lesson: RenderedLesson }
  className?: string
}) {
  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      {renderContent(ctx.lesson.brief, ctx)}
    </div>
  )
}

function components(ctx: ContentContext, svgs: Element[]): ContentComponents {
  const newTab = ctx.surface === "player"

  return {
    // --- Markdown -----------------------------------------------------------
    h1: (p: ComponentProps<"h1">) => (
      <h1 className="mb-4 text-2xl font-semibold tracking-tight" {...p} />
    ),
    h2: (p: ComponentProps<"h2">) => (
      <h2 className="mt-8 mb-3 text-lg font-semibold" {...p} />
    ),
    h3: (p: ComponentProps<"h3">) => (
      <h3 className="mt-6 mb-2 font-semibold" {...p} />
    ),
    p: (p: ComponentProps<"p">) => <p className="my-3" {...p} />,
    ul: (p: ComponentProps<"ul">) => (
      <ul className="my-3 list-disc space-y-1 pl-6" {...p} />
    ),
    ol: (p: ComponentProps<"ol">) => (
      <ol className="my-3 list-decimal space-y-1 pl-6" {...p} />
    ),
    blockquote: ({ ...p }: ComponentProps<"blockquote">) => (
      <blockquote
        className="my-4 border-l-2 pl-4 text-muted-foreground italic"
        {...p}
      />
    ),
    a: ({ href = "", ...p }: ComponentProps<"a">) => {
      const external = /^https?:\/\//i.test(href)
      return (
        <a
          href={
            href.startsWith("#") ? `#${contentId(ctx, href.slice(1))}` : href
          }
          className="underline underline-offset-4 hover:text-foreground"
          {...(external
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          {...p}
        />
      )
    },
    code: ({ className, ...p }: ComponentProps<"code">) => (
      <code
        className={cn(
          // Inline code only; a block's <code> is reset by `pre` below.
          "rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]",
          className
        )}
        {...p}
      />
    ),
    // Plain and horizontally scrollable (§5.3): no highlighting.
    pre: (p: ComponentProps<"pre">) => (
      <pre
        tabIndex={0}
        className="my-4 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-xs"
        {...p}
      />
    ),
    table: (p: ComponentProps<"table">) => (
      <div className="my-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm" {...p} />
      </div>
    ),
    th: (p: ComponentProps<"th">) => (
      <th className="border-b px-2 py-1.5 text-left font-medium" {...p} />
    ),
    td: (p: ComponentProps<"td">) => (
      <td className="border-b px-2 py-1.5" {...p} />
    ),

    // --- Directives (§5.3) --------------------------------------------------
    "plato-cite": (props: PlatoProps) => {
      const numbers = attr(props, "data-numbers").split(" ").filter(Boolean)
      return (
        <>
          {numbers.map((n, i) => (
            <CitationChip
              key={i}
              courseId={ctx.courseId}
              number={Number(n)}
              newTab={newTab}
            />
          ))}
        </>
      )
    },
    "plato-label": (props: PlatoProps) => (
      <ContentLabel kind={attr(props, "data-kind") as ContentLabelKind}>
        {props.children}
      </ContentLabel>
    ),
    "plato-anchor": (props: PlatoProps) => (
      <div id={contentId(ctx, attr(props, "id"))} className="scroll-mt-20" />
    ),
    "plato-guess": (props: PlatoProps) => (
      <GuessBox id={attr(props, "data-id")} ctx={ctx} />
    ),
    "plato-misconception": (props: PlatoProps) => (
      <MisconceptionBox id={attr(props, "data-id")} ctx={ctx} />
    ),
    "plato-analogy": (props: PlatoProps) => (
      <aside
        id={attr(props, "id") ? contentId(ctx, attr(props, "id")) : undefined}
        aria-label="Analogy"
        className="my-4 scroll-mt-20 rounded-lg border border-dashed p-4 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0"
      >
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Analogy
        </div>
        {props.children}
      </aside>
    ),
    "plato-figure": (props: PlatoProps) => {
      const caption = attr(props, "data-caption")
      return (
        <figure className="my-6">
          <div className="mx-auto max-w-xl text-foreground [&>svg]:h-auto [&>svg]:w-full">
            {props.children}
          </div>
          {caption ? (
            <figcaption className="mt-2 text-center text-xs text-muted-foreground">
              {caption}
            </figcaption>
          ) : null}
        </figure>
      )
    },
    "plato-figure-svg": (props: PlatoProps) => {
      const svg = svgs[Number(attr(props, "data-figure"))]
      return svg ? <FigureSvg svg={svg} /> : null
    },
    "plato-blank": () => (
      <span className="inline-block w-16 border-b border-foreground align-baseline">
        <span className="sr-only">blank</span>
      </span>
    ),
    "plato-question": (props: PlatoProps) => (
      <span className="text-muted-foreground">
        ({attr(props, "data-id").toUpperCase()})
      </span>
    ),
  }
}

const boxClass =
  "my-4 rounded-lg border bg-muted/40 p-4 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"

/**
 * "Your guess" (WF-E3, spec F4): the learner's pick next to the correct
 * option, each marked in text as well as style, then `why`. Without a pick
 * (the course page, or a guess not made) it shows the answer alone.
 */
function GuessBox({ id, ctx }: { id: string; ctx: ContentContext }) {
  const guess = ctx.lesson?.guesses[id]
  if (!guess) return null
  const pick = ctx.guessPicks?.[id]
  const shown = [
    ...(pick && pick !== guess.correct && guess.options[pick] ? [pick] : []),
    guess.correct,
  ]
  return (
    <section aria-label="Your guess" className={boxClass}>
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        Your guess
      </div>
      <p className="mb-2 font-medium">{renderContent(guess.prompt, ctx)}</p>
      <ul className="mb-3 space-y-1.5">
        {shown.map((optionId) => {
          const right = optionId === guess.correct
          const picked = optionId === pick
          return (
            <li
              key={optionId}
              data-correct={right || undefined}
              data-picked={picked || undefined}
              className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2",
                right
                  ? "border-foreground"
                  : "border-dashed text-muted-foreground"
              )}
            >
              <span aria-hidden="true">{right ? "✓" : "✗"}</span>
              <span className="flex-1">
                {renderContent(guess.options[optionId], ctx)}
              </span>
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {right
                  ? picked
                    ? "Your guess · correct"
                    : "Correct"
                  : "Your guess"}
              </span>
            </li>
          )
        })}
      </ul>
      <p>{renderContent(guess.why, ctx)}</p>
    </section>
  )
}

/** "You might think …" (WF-E3): the belief, then its correction. */
function MisconceptionBox({ id, ctx }: { id: string; ctx: ContentContext }) {
  const m = ctx.lesson?.misconceptions[id]
  if (!m) return null
  return (
    <section aria-label="You might think" className={boxClass}>
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        You might think
      </div>
      <p className="font-medium">{renderContent(m.belief, ctx)}</p>
      <p className="mt-2">{renderContent(m.correction, ctx)}</p>
    </section>
  )
}
