import { cn } from "@/lib/utils"

/**
 * One citation number (§5.3, WF-E3). Its accessible name is "Source 2"
 * (WF-J). On the course page it links to the Sources tab; in the player it
 * opens that tab in a new browser tab, so the session is not left.
 */
export function CitationChip({
  courseId,
  number,
  newTab = false,
  className,
}: {
  courseId: string
  number: number
  newTab?: boolean
  className?: string
}) {
  return (
    <a
      href={`/courses/${courseId}/sources#s${number}`}
      aria-label={`Source ${number}`}
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cn(
        "ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-muted-foreground/50 px-1 align-text-top text-[0.625rem] leading-none font-medium text-muted-foreground no-underline hover:border-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        className
      )}
    >
      {number}
    </a>
  )
}
