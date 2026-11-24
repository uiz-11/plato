import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"

import { CourseProgress, type CourseProgressValue } from "./course-progress"

/** One course row on Today (WF-A1): opens the course page. */
export function CourseRow({
  courseId,
  title,
  meta,
  progress,
  className,
}: {
  courseId: string
  title: string
  /** "2 of 12 completed · Checkpoint 1 open", "10 lessons · ~4 hrs". */
  meta: string
  /** Set for courses in progress or complete; draws the bar. */
  progress?: CourseProgressValue
  className?: string
}) {
  return (
    <Link
      href={`/courses/${courseId}`}
      data-slot="course-row"
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 focus-ring transition-colors hover:bg-muted/50",
        className
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{meta}</span>
        {progress && <CourseProgress {...progress} className="max-w-48" />}
      </span>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Link>
  )
}
