"use client"

import { useCallback, useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

const BARS = '[data-slot="action-bar"]'

/**
 * Sets `--player-bar-h` on the player to the height of the pinned bar (the
 * tallest, should there be more than one), so focused content scrolls clear
 * of it (globals.css), or clears it when no bar is pinned.
 */
function syncBarHeight(main: HTMLElement) {
  const pinned = [...main.querySelectorAll<HTMLElement>(BARS)].filter(
    (bar) => getComputedStyle(bar).position === "sticky"
  )
  if (pinned.length === 0) {
    main.style.removeProperty("--player-bar-h")
    return
  }
  const height = Math.max(...pinned.map((bar) => bar.offsetHeight))
  main.style.setProperty("--player-bar-h", `${height}px`)
}

/**
 * A player screen's actions (§9.1, WF-I): the submit, confidence and Next
 * buttons sit at the bottom of the screen. On a phone they are pinned there
 * while the item scrolls under them, so they stay within thumb reach; on
 * desktop they follow the item. Its height is kept in `--player-bar-h` on
 * the player, so a control focused above it scrolls clear of it.
 */
export function ActionBar({
  className,
  ref,
  ...props
}: React.ComponentProps<"div">) {
  const own = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = own.current
    const main = el?.closest<HTMLElement>('[data-slot="player-main"]')
    if (!el || !main) return
    const observer = new ResizeObserver(() => syncBarHeight(main))
    observer.observe(el)
    return () => {
      observer.disconnect()
      // Another bar may still be on screen: measure that one instead.
      syncBarHeight(main)
    }
  }, [])

  // Stable, so the caller's ref is not re-bound on every render.
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      own.current = el
      if (typeof ref === "function") ref(el)
      else if (ref) ref.current = el
    },
    [ref]
  )

  return (
    <div
      ref={setRef}
      data-slot="action-bar"
      className={cn(
        "sticky bottom-0 z-10 mt-auto bg-background py-2 md:static md:py-0",
        className
      )}
      {...props}
    />
  )
}
