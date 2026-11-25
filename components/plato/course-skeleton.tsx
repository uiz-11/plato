import { Skeleton } from "@/components/ui/skeleton"

/** A course tab's body while it loads: the header and tabs stay (§8.2). */
export function CourseTabSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-3/4" />
      <div className="mt-3 flex flex-col gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    </div>
  )
}
