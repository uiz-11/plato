// The Read step's brief (§5.3, WF-E3): "Why this matters" under the brief's
// heading, the body, then "Beyond this lesson". Server-safe: it renders the
// memoized HAST with the learner's guesses, and passes on as nodes.

import type { ComponentProps } from "react"

import type { Link } from "@/lib/content/schema"
import type { BeyondView, BriefView } from "@/lib/dal/player"

import { Badge } from "@/components/ui/badge"

import { Brief, renderContent, type ContentContext } from "./content"

/** The brief, with "Why this matters" right under its `# Title`. */
export function LessonBrief({ brief }: { brief: BriefView }) {
  const ctx: ContentContext & { lesson: BriefView["lesson"] } = {
    courseId: brief.courseId,
    surface: "player",
    lesson: brief.lesson,
    guessPicks: brief.guessPicks,
  }
  const why = renderContent(brief.lesson.whyThisMatters, ctx)
  return (
    <Brief
      ctx={{
        ...ctx,
        components: {
          h1: (p: ComponentProps<"h1">) => (
            <>
              <h1
                className="mb-4 text-2xl font-semibold tracking-tight"
                {...p}
              />
              <p data-slot="why-this-matters" className="my-3">
                <span className="font-medium">Why this matters:</span> {why}
              </p>
            </>
          ),
        },
      }}
    />
  )
}

function GoDeeper({ links }: { links: Link[] }) {
  if (links.length === 0) return null
  return (
    <ul className="mt-1.5 flex flex-col gap-1 pl-5 text-xs text-muted-foreground">
      {links.map((l) => (
        <li key={l.url} className="flex flex-wrap items-center gap-x-1.5">
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-4"
          >
            {l.title}
          </a>
          <span>
            · adds: {l.adds} · ~{l.minutes} min · {l.level}
          </span>
          {l.recommended ? <Badge variant="outline">recommended</Badge> : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * "Beyond this lesson" (spec F4): ≈ *Simplified* and ○ *Not covered*
 * entries, each with its Go deeper links. The symbols read as their words
 * (WF-J).
 */
export function BeyondLesson({
  beyond,
  courseId,
}: {
  beyond: BeyondView
  courseId: string
}) {
  if (beyond.simplified.length === 0 && beyond.notCovered.length === 0)
    return null
  const ctx: ContentContext = { courseId, surface: "player" }
  return (
    <section
      aria-labelledby="beyond-this-lesson"
      data-slot="beyond-this-lesson"
      className="mt-8 border-t pt-6 text-sm leading-relaxed"
    >
      <h2 id="beyond-this-lesson" className="mb-3 text-lg font-semibold">
        Beyond this lesson
      </h2>
      <ul className="flex flex-col gap-4">
        {beyond.simplified.map((e) => (
          <li key={e.id}>
            <p className="flex gap-2">
              <span aria-hidden="true" className="w-3 shrink-0">
                ≈
              </span>
              <span>
                <span className="sr-only">Simplified: </span>
                {renderContent(e.text, ctx)}
              </span>
            </p>
            <GoDeeper links={e.links} />
          </li>
        ))}
        {beyond.notCovered.map((e) => (
          <li key={e.id}>
            <p className="flex gap-2">
              <span aria-hidden="true" className="w-3 shrink-0">
                ○
              </span>
              <span>
                Not covered: {e.topic}
                <span className="text-muted-foreground"> · {e.why}</span>
              </span>
            </p>
            <GoDeeper links={e.links} />
          </li>
        ))}
      </ul>
    </section>
  )
}
