import type { Metadata } from "next"

import { CourseCard } from "@/components/plato/course-card"
import { RequestTile } from "@/components/plato/request-tile"
import { getLibraryView, type LibraryCourseCard } from "@/lib/dal/library"

export const metadata: Metadata = { title: "Library" }

const GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"

// Library (§9.4, spec F9, WF-H1): every course grouped by status, then the
// learner's open requests as dashed tiles.
export default async function LibraryPage() {
  const view = await getLibraryView()
  const empty =
    view.inProgress.length +
      view.ready.length +
      view.complete.length +
      view.requested.length ===
    0

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <h1 className="text-2xl font-semibold md:text-3xl">Library</h1>
      {empty && (
        <p className="text-sm text-muted-foreground">
          No courses or requests yet.
        </p>
      )}
      <CourseSection title="In progress" courses={view.inProgress} />
      <CourseSection title="Ready" courses={view.ready} />
      <CourseSection title="Complete" courses={view.complete} />
      {view.requested.length > 0 && (
        <Section title="Requested">
          {view.requested.map((r) => (
            <li key={r.id}>
              <RequestTile
                title={r.text}
                reason={r.reason}
                className="h-full"
              />
            </li>
          ))}
        </Section>
      )}
    </div>
  )
}

function CourseSection({
  title,
  courses,
}: {
  title: string
  courses: LibraryCourseCard[]
}) {
  if (courses.length === 0) return null
  return (
    <Section title={title}>
      {courses.map((c) => (
        <li key={c.courseId}>
          <CourseCard {...c} className="h-full" />
        </li>
      ))}
    </Section>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const id = `library-${title.toLowerCase().replace(/\s+/g, "-")}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-sm font-medium text-muted-foreground">
        {title}
      </h2>
      <ul className={GRID}>{children}</ul>
    </section>
  )
}
