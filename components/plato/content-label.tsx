import type { ReactNode } from "react"

import type { ContentLabelKind } from "@/lib/content/render"
import { cn } from "@/lib/utils"

export const CONTENT_LABEL_TEXT: Record<ContentLabelKind, string> = {
  uncertain: "uncertain",
  general: "general knowledge",
  contested: "contested",
}

/**
 * A labelled claim (§5.3, WF-E3): the claim, then its content label as
 * bracketed text. Styled as quiet italic text, unlike status badges.
 */
export function ContentLabel({
  kind,
  children,
  className,
}: {
  kind: ContentLabelKind
  children?: ReactNode
  className?: string
}) {
  return (
    <span className={className}>
      {children}{" "}
      <span
        className={cn("text-xs whitespace-nowrap text-muted-foreground italic")}
      >
        [{CONTENT_LABEL_TEXT[kind]}]
      </span>
    </span>
  )
}
