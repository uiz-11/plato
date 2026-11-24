import { MASTERY_DOTS, MASTERY_LABEL, type Mastery } from "@/lib/engine/mastery"
import { cn } from "@/lib/utils"

/**
 * Four dots plus the word (§7.5, WF-C1, WF-G2). The word carries the
 * meaning; the dots are decorative. *Not yet reviewed* shows four faint empty
 * dots.
 */
export function MasteryMeter({
  mastery,
  className,
}: {
  mastery: Mastery
  className?: string
}) {
  const filled = MASTERY_DOTS[mastery]
  const faint = mastery === "not_yet_reviewed"
  return (
    <span
      data-slot="mastery-meter"
      className={cn(
        "inline-flex items-center gap-2 text-xs text-muted-foreground",
        className
      )}
    >
      <span
        aria-hidden
        data-filled={filled}
        className={cn("flex gap-0.5", faint && "opacity-40")}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "size-2 rounded-full border border-current",
              i < filled ? "border-foreground bg-foreground" : "bg-transparent"
            )}
          />
        ))}
      </span>
      <span>{MASTERY_LABEL[mastery]}</span>
    </span>
  )
}
