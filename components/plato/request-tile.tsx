import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * A request the learner made (WF-A1, WF-B2, WF-H1): dashed, muted and not
 * clickable, since there is nothing to open yet. The title is the start of
 * the learner's own words, cut with an ellipsis. Shaped like a course card
 * so it sits in the same grid.
 */
export function RequestTile({
  title,
  reason,
  className,
}: {
  /** The learner's request text. */
  title: string
  /** Set when the request is *Not built* (§7.9). */
  reason?: string
  className?: string
}) {
  const notBuilt = reason !== undefined
  return (
    <div
      data-slot="request-tile"
      className={cn(
        "flex flex-col items-start gap-2 rounded-xl border border-dashed p-3 text-muted-foreground",
        className
      )}
    >
      <span className="line-clamp-2 text-sm" title={title}>
        {title}
      </span>
      {notBuilt && <span className="text-xs">{reason}</span>}
      <Badge variant="outline">{notBuilt ? "not built" : "requested"}</Badge>
    </div>
  )
}
