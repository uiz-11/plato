import Link from "next/link"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

import { CourseProgress, type CourseProgressValue } from "./course-progress"

/**
 * The cover: `coverLabel` on a neutral tile (WF-C1, WF-H1). A square in the
 * course header; a full-width band on top of a course card.
 */
export function CoverTile({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      data-slot="cover-tile"
      className={cn(
        // foreground/70 on muted keeps 12px text above 4.5:1 (WCAG 1.4.3).
        "flex aspect-square w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted p-1 text-center text-xs font-semibold break-words text-foreground/70",
        className
      )}
    >
      {label}
    </span>
  )
}

/** One course card in the Library (WF-H1): opens the course page. */
export function CourseCard({
  courseId,
  title,
  coverLabel,
  meta,
  progress,
  className,
}: {
  courseId: string
  title: string
  coverLabel: string
  /** "2 of 12 completed", "10 lessons · ~4 hrs", "2 of 2 completed ✓". */
  meta: string
  /** Set for courses in progress or complete; draws the bar. */
  progress?: CourseProgressValue
  className?: string
}) {
  return (
    <Link
      href={`/courses/${courseId}`}
      data-slot="course-card"
      className={cn("group/course-card block rounded-xl focus-ring", className)}
    >
      <Card
        size="sm"
        className="h-full pt-0 transition-colors group-hover/course-card:bg-muted/50"
      >
        <CoverTile
          label={coverLabel}
          className="aspect-auto h-14 w-full rounded-none"
        />
        <CardHeader>
          <CardTitle className="line-clamp-2">{title}</CardTitle>
          <CardDescription className="text-xs">{meta}</CardDescription>
        </CardHeader>
        {progress && (
          <CourseProgress {...progress} className="px-(--card-spacing)" />
        )}
      </Card>
    </Link>
  )
}
