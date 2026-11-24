import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

/**
 * The thin bar under a course's meta line (WF-A1, WF-H1). Decorative: the
 * meta text already says "2 of 12 completed".
 */
export function CourseProgress({
  completed,
  total,
  className,
}: {
  completed: number
  total: number
  className?: string
}) {
  const value = total > 0 ? Math.round((completed / total) * 100) : 0
  return (
    <div
      aria-hidden
      data-slot="course-progress"
      className={cn("w-full", className)}
    >
      <Progress value={value} />
    </div>
  )
}

/** Lessons completed out of the total, for the bar. */
export interface CourseProgressValue {
  completed: number
  total: number
}
