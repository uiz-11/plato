import { ExternalLinkIcon } from "lucide-react"

import { getSourcesView } from "@/lib/dal/course"

// Sources (§9.4, spec F9, WF-C3): grouped by kind, dated in one column. Each
// number matches the citation chips in briefs, which link to `#s<n>`.
export default async function SourcesPage(
  props: PageProps<"/courses/[courseId]/sources">
) {
  const { courseId } = await props.params
  const view = await getSourcesView(courseId)

  return (
    <div className="flex flex-col gap-6">
      {view.groups.map((g, i) => {
        const id = `source-group-${i + 1}`
        return (
          <section
            key={g.group}
            aria-labelledby={id}
            className="flex flex-col gap-1"
          >
            <h2 id={id} className="text-xs font-medium text-muted-foreground">
              {g.group}
            </h2>
            <ul className="flex flex-col divide-y">
              {g.sources.map((s) => (
                <li
                  key={s.id}
                  id={s.anchor}
                  data-slot="source-row"
                  className="flex scroll-mt-20 items-baseline gap-3 rounded-md py-2 text-sm target:bg-muted/60"
                >
                  <span className="w-6 shrink-0 text-right text-xs font-medium text-muted-foreground tabular-nums">
                    <span className="sr-only">Source </span>
                    {s.number}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-sm underline-offset-4 focus-ring hover:underline"
                    >
                      <span className="text-muted-foreground">
                        {s.publisher} ·{" "}
                      </span>
                      {s.title}
                      <ExternalLinkIcon
                        aria-hidden
                        className="ml-1 inline size-3 align-baseline text-muted-foreground"
                      />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                    {s.position && (
                      <span className="text-xs text-muted-foreground">
                        Position: {s.position}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {/* Years only, as in WF-C3; the full date stays in the
                        markup. */}
                    <time dateTime={s.date}>{s.date.slice(0, 4)}</time>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
