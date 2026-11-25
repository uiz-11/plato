"use client"

import { useOptimistic, useState, useTransition } from "react"
import { unstable_rethrow } from "next/navigation"
import { ChevronDownIcon } from "lucide-react"
import { toast } from "sonner"

import { setSessionMinutes } from "@/app/actions/settings"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { SessionMinutes } from "@/lib/engine/types"
import { cn } from "@/lib/utils"

/** The lengths Today offers (spec F8). */
export const SESSION_MINUTES = [
  10, 15, 20, 30,
] as const satisfies readonly SessionMinutes[]

const LABEL = "Session length"

const isMinutes = (v: unknown): v is SessionMinutes =>
  SESSION_MINUTES.includes(v as SessionMinutes)

/**
 * The session-length menu beside **Start session** (§9.4, WF-A1.1): a
 * dropdown radio group on desktop and a bottom sheet holding a radio group on
 * phone (WF-I1.1). The choice saves immediately and is remembered. Both
 * triggers are rendered and CSS at `md` shows one, so nothing shifts after
 * hydration (as in the shell nav).
 */
export function SessionLengthMenu({
  minutes,
  className,
}: {
  minutes: SessionMinutes
  className?: string
}) {
  const [shown, setShown] = useOptimistic(minutes)
  const [, startTransition] = useTransition()
  const [sheetOpen, setSheetOpen] = useState(false)

  function choose(value: unknown) {
    setSheetOpen(false)
    const m = Number(value)
    if (!isMinutes(m) || m === shown) return
    startTransition(async () => {
      setShown(m)
      // A rejected transition would throw to the error boundary and replace
      // Today. Instead the optimistic value falls back to the saved one.
      try {
        await setSessionMinutes(m)
      } catch (err) {
        // An expired cookie redirects to /unlock: let Next handle it.
        unstable_rethrow(err)
        toast.error("Couldn't save the session length. Try again.")
      }
    })
  }

  const trigger = (
    <Button
      variant="outline"
      size="lg"
      // The visible text is the value; the name says what it sets.
      aria-label={`${LABEL}: ${shown} min`}
      className="min-h-11 md:min-h-9"
    />
  )
  const text = (
    <>
      {shown} min
      <ChevronDownIcon data-icon="inline-end" aria-hidden />
    </>
  )

  return (
    <span data-slot="session-length-menu" className={cn("contents", className)}>
      <span className="hidden md:contents">
        <DropdownMenu>
          <DropdownMenuTrigger render={trigger}>{text}</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{LABEL}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                aria-label={LABEL}
                value={String(shown)}
                onValueChange={choose}
              >
                {SESSION_MINUTES.map((m) => (
                  <DropdownMenuRadioItem key={m} value={String(m)}>
                    {m} min
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      <span className="contents md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger render={trigger}>{text}</SheetTrigger>
          <SheetContent
            side="bottom"
            className="pb-[env(safe-area-inset-bottom)]"
          >
            <SheetHeader>
              <SheetTitle>{LABEL}</SheetTitle>
            </SheetHeader>
            <RadioGroup
              aria-label={LABEL}
              value={String(shown)}
              onValueChange={choose}
              className="gap-2 px-4 pb-4"
            >
              {SESSION_MINUTES.map((m) => (
                <label
                  key={m}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm has-focus-visible:bg-muted"
                >
                  <RadioGroupItem value={String(m)} />
                  {m} min
                </label>
              ))}
            </RadioGroup>
          </SheetContent>
        </Sheet>
      </span>
    </span>
  )
}
