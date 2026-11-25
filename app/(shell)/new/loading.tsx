import { Skeleton } from "@/components/ui/skeleton"

// New request's skeleton (§8.2): the heading and the text box.
export default function Loading() {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-6"
    >
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-40 rounded-lg" />
    </div>
  )
}
