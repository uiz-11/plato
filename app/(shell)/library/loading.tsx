import { Skeleton } from "@/components/ui/skeleton"

// The Library's skeleton (§8.2): the heading and a grid of course cards.
export default function Loading() {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6"
    >
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-4 w-24" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  )
}
