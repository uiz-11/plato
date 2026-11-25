"use client"

import { useId, useState, type ReactNode } from "react"
import { ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A *Completed* lesson's "Mastery" disclosure (§9.4, WF-C1.3), collapsed by
 * default. The trigger sits in the row; the concepts, rendered on the server,
 * open indented under it.
 */
export function MasteryDisclosure({
  lessonNumber,
  children,
}: {
  lessonNumber: number
  /** The concept list. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        // "Mastery" alone repeats on every completed row.
        aria-label={`Mastery, Lesson ${lessonNumber}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground focus-ring transition-colors hover:text-foreground md:min-h-8"
      >
        Mastery
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
      </button>
      <div id={id} hidden={!open} className="basis-full">
        {children}
      </div>
    </>
  )
}
