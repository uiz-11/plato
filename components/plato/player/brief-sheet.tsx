"use client"

import { useRef } from "react"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

import { BRIEF_SHEET_PREFIX } from "./logic"

/**
 * The brief, read-only, in a sheet scrolled to an exercise's anchor (§9.1,
 * R3). It opens only from "In the brief", after an answer is submitted.
 * `children` is the brief rendered with `BRIEF_SHEET_PREFIX`.
 */
export function BriefSheet({
  open,
  onOpenChange,
  anchor,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchor: string
  children: React.ReactNode
}) {
  const body = useRef<HTMLDivElement>(null)

  // Once the sheet has opened (its focus and animation done), so neither
  // moves the scroll afterwards. `contentId()` under BRIEF_SHEET_PREFIX; not
  // imported, as it would bring the content renderer into the client bundle.
  const scrollToAnchor = (isOpen: boolean) => {
    if (!isOpen) return
    const target = body.current?.querySelector<HTMLElement>(
      `#${CSS.escape(`${BRIEF_SHEET_PREFIX}-${anchor}`)}`
    )
    target?.scrollIntoView({ block: "start" })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={scrollToAnchor}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="border-b">
          <SheetTitle>In the brief</SheetTitle>
        </SheetHeader>
        <div
          ref={body}
          className="flex-1 overflow-y-auto px-4 pb-8 [&_.scroll-mt-20]:scroll-mt-4"
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
