import { PlayIcon } from "lucide-react"

import { startSession } from "@/app/actions/sessions"
import { Badge } from "@/components/ui/badge"
import type { CourseHeaderView } from "@/lib/dal/course"

import { CoverTile } from "./course-card"
import { PendingSubmit } from "./pending-submit"

/**
 * The course header (§9.4, WF-C1): cover tile, title, status badge, details
 * and the main button. It stays on every tab. The main button starts a
 * standard session on this course: due reviews first, then its next target
 * (WF-C1.1).
 */
export function CourseHeader({ header }: { header: CourseHeaderView }) {
  return (
    <header
      data-slot="course-header"
      className="flex flex-col gap-4 md:flex-row md:items-center"
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {/* Wide enough for a 12-character label (§5.2). */}
        <CoverTile label={header.coverLabel} className="w-20" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-2xl font-semibold">{header.title}</h1>
            {header.badge && (
              <Badge variant="secondary" data-status={header.status}>
                {header.badge}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{header.meta}</p>
        </div>
      </div>
      {header.mainButton && (
        <form
          action={startSession.bind(null, {
            kind: "standard",
            courseId: header.courseId,
          })}
        >
          <PendingSubmit size="lg" className="min-h-11 w-full md:min-h-9">
            <PlayIcon data-icon="inline-start" aria-hidden />
            {header.mainButton.label}
          </PendingSubmit>
        </form>
      )}
    </header>
  )
}
