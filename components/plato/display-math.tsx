"use client"

import { useEffect, useRef, useState, type ComponentProps } from "react"

/**
 * KaTeX's display math block (`.katex-display`). Wider than the column, it
 * scrolls sideways (globals.css, §11.4), and only then takes focus, so the
 * keyboard can scroll it without every formula becoming a tab stop.
 */
export function DisplayMath(props: ComponentProps<"span">) {
  const ref = useRef<HTMLSpanElement>(null)
  const [scrolls, setScrolls] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // The column's width changes with the window; the formula does not.
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return <span ref={ref} {...props} tabIndex={scrolls ? 0 : undefined} />
}
