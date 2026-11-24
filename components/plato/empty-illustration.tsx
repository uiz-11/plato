import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The illustration for empty states (WF-A2 first run and all caught up): a
 * decorative icon in a muted circle, hidden from assistive tech (WF-J).
 */
export function EmptyIllustration({
  icon: Icon,
  className,
}: {
  icon: LucideIcon
  className?: string
}) {
  return (
    <span
      aria-hidden
      data-slot="empty-illustration"
      className={cn(
        "flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground",
        className
      )}
    >
      <Icon className="size-8" />
    </span>
  )
}
