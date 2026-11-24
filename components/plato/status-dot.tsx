import type { ReactNode } from "react"

import type { DotShape } from "@/lib/engine/labels"
import { cn } from "@/lib/utils"

// Shapes per status: LESSON_STATUS_DOT and CHECKPOINT_STATUS_DOT in
// lib/engine/labels, beside the status words they go with.

/** Dash and gap of the skipped (dashed) circle, in viewBox units. */
const DASH = "2.2 1.7"

function Shape({ shape }: { shape: DotShape }) {
  // 12px, drawn in currentColor so it follows the text and the theme.
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      data-shape={shape}
      className="size-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {shape === "square" ? (
        <rect x="2" y="2" width="8" height="8" rx="1" />
      ) : (
        <circle
          cx="6"
          cy="6"
          r="5"
          fill={shape === "full" ? "currentColor" : "none"}
          strokeDasharray={shape === "dashed" ? DASH : undefined}
        />
      )}
      {shape === "half" && (
        <path d="M6 1 A5 5 0 0 0 6 11 Z" fill="currentColor" stroke="none" />
      )}
    </svg>
  )
}

/** A status dot, always beside its status text (§9.1, WF-C1, WF-H1). */
export function StatusDot({
  shape,
  children,
  className,
}: {
  shape: DotShape
  /** The exact status text, e.g. "In progress · at Recall". */
  children: ReactNode
  className?: string
}) {
  return (
    <span
      data-slot="status-dot"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        className
      )}
    >
      <Shape shape={shape} />
      <span>{children}</span>
    </span>
  )
}
