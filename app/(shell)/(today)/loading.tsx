import { Skeleton } from "@/components/ui/skeleton"

// Today's skeleton (§8.2): the heading, the session card and a few rows.
export default function Loading() {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6"
    >
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-9 w-32" />
      <div className="grid gap-6 md:grid-cols-2 md:items-start">
        <Skeleton className="h-36 rounded-xl" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </div>
    </div>
  )
}
