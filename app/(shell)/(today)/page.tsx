import { CourseRow } from "@/components/plato/course-row"
import { RequestTile } from "@/components/plato/request-tile"
import { TodayCard } from "@/components/plato/today-card"
import { getTodayView } from "@/lib/dal/today"

// Today (§7.8, §9.4, WF-A1, WF-A2, WF-I1): the shown-up counter, the session
// card, then the In progress, Ready and Requested rows.
export default async function TodayPage() {
  const view = await getTodayView()
  const hasRows =
    view.inProgress.length + view.ready.length + view.requested.length > 0

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold md:text-3xl">Today</h1>
        {/* A total that only grows: no streak, no gaps (WF-A1.4). */}
        <p
          data-slot="shown-up"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <span className="text-2xl font-semibold text-foreground tabular-nums">
            {view.shownUpDays}
          </span>
          <span className="max-w-20 leading-tight">
            {view.shownUpDays === 1 ? "day" : "days"} you&apos;ve shown up
          </span>
        </p>
      </header>

      <div
        className={
          hasRows ? "grid gap-6 md:grid-cols-2 md:items-start" : "grid gap-6"
        }
      >
        <TodayCard card={view.card} minutes={view.minutes} />

        {hasRows && (
          <div className="flex flex-col gap-6">
            {view.inProgress.length > 0 && (
              <RowSection title="In progress">
                {view.inProgress.map((c) => (
                  <li key={c.courseId}>
                    <CourseRow {...c} />
                  </li>
                ))}
              </RowSection>
            )}
            {view.ready.length > 0 && (
              <RowSection title="Ready">
                {view.ready.map((c) => (
                  <li key={c.courseId}>
                    <CourseRow {...c} />
                  </li>
                ))}
              </RowSection>
            )}
            {view.requested.length > 0 && (
              <RowSection title="Requested" gap>
                {view.requested.map((r) => (
                  <li key={r.id}>
                    <RequestTile title={r.text} reason={r.reason} />
                  </li>
                ))}
              </RowSection>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function RowSection({
  title,
  gap,
  children,
}: {
  title: string
  /** Request tiles have their own border, so they sit apart. */
  gap?: boolean
  children: React.ReactNode
}) {
  const id = `today-${title.toLowerCase().replace(/\s+/g, "-")}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-xs font-medium text-muted-foreground">
        {title}
      </h2>
      <ul className={gap ? "flex flex-col gap-2" : "-mx-3 flex flex-col"}>
        {children}
      </ul>
    </section>
  )
}
