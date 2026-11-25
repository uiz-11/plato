"use client"

import { useEffect, useRef } from "react"
import type { LucideIcon } from "lucide-react"

import { EmptyIllustration } from "../empty-illustration"

/**
 * A celebration (§9.1, WF-E7): a decorative icon, a heading, one line and a
 * short `canvas-confetti` burst on arrival, with no confetti under
 * `prefers-reduced-motion`. The heading takes focus, so the new screen is
 * announced.
 */
export function Celebration({
  icon,
  heading,
  line,
  children,
}: {
  icon: LucideIcon
  heading: string
  line: string | null
  children: React.ReactNode
}) {
  const ref = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    ref.current?.focus()
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let cancelled = false
    let reset: (() => void) | undefined
    void import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelled) return
      reset = () => confetti.reset()
      void confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        disableForReducedMotion: true,
      })
    })
    return () => {
      cancelled = true
      reset?.()
    }
  }, [])

  return (
    <div
      data-slot="celebration"
      className="flex flex-1 flex-col items-center justify-center gap-6 text-center"
    >
      <EmptyIllustration icon={icon} />
      <div className="flex flex-col gap-2">
        <h2
          ref={ref}
          tabIndex={-1}
          className="text-2xl font-semibold outline-none"
        >
          {heading}
        </h2>
        {line ? <p className="max-w-md text-sm">{line}</p> : null}
      </div>
      {children}
    </div>
  )
}
