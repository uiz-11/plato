"use client"

import { useEffect, useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { GRADE_LABEL } from "@/lib/engine/labels"
import type { Grade } from "@/lib/engine/types"

const GRADES: readonly Grade[] = ["forgot", "partly", "remembered"]

/** Whether a key press belongs to a text field rather than a shortcut. */
export function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
      !["checkbox", "radio", "button", "submit"].includes(target.type))
  )
}

/**
 * A recall prompt (§9.1, WF-D1, WF-E1): the prompt and **Show answer**.
 * Revealing shows the answer, then either the rating buttons ("How well did
 * you remember?", keys 1/2/3) or **Next**. The reveal is local state, so a
 * reload shows the prompt unrevealed, unless the item was already answered.
 */
export function RecallPrompt({
  prompt,
  answer,
  mode,
  rated,
  pending = false,
  onRate,
  onNext,
}: {
  prompt: React.ReactNode
  answer: React.ReactNode
  /** Rating buttons (a review) or **Next** (a warm-up, or a rated review). */
  mode: "rate" | "next"
  /** The rating already given, shown on a reload before moving on. */
  rated?: Grade | null
  pending?: boolean
  onRate?: (grade: Grade) => void
  onNext?: () => void
}) {
  const [revealed, setRevealed] = useState(rated != null)
  const answerId = useId()
  const ratingId = useId()
  const rating = mode === "rate" && revealed && rated == null
  const after = useRef<HTMLDivElement>(null)
  const [justRevealed, setJustRevealed] = useState(false)

  // Focus moves to what replaces **Show answer**: the first rating, or Next.
  useEffect(() => {
    if (justRevealed) after.current?.querySelector("button")?.focus()
  }, [justRevealed])

  useEffect(() => {
    if (!rating || !onRate || pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      if (inTextField(e.target)) return
      const grade = GRADES[Number(e.key) - 1]
      if (grade && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault()
        onRate(grade)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [rating, onRate, pending])

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="text-lg leading-relaxed font-medium">{prompt}</div>

      {revealed ? (
        <section
          aria-labelledby={answerId}
          className="rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed"
        >
          <h3
            id={answerId}
            className="mb-1 text-xs font-medium text-muted-foreground"
          >
            Answer
          </h3>
          {answer}
        </section>
      ) : null}

      <div ref={after} className="mt-auto flex flex-col gap-3">
        {!revealed ? (
          <Button
            size="lg"
            className="min-h-11 w-full md:w-auto md:self-start"
            onClick={() => {
              setRevealed(true)
              setJustRevealed(true)
            }}
          >
            Show answer
          </Button>
        ) : mode === "rate" && rated == null ? (
          <div
            role="group"
            aria-labelledby={ratingId}
            className="flex flex-col gap-2"
          >
            <p id={ratingId} className="text-sm font-medium">
              How well did you remember?
            </p>
            <div className="grid grid-cols-3 gap-2">
              {GRADES.map((g, i) => (
                <Button
                  key={g}
                  variant="outline"
                  size="lg"
                  disabled={pending}
                  className="min-h-11"
                  onClick={() => onRate?.(g)}
                  aria-keyshortcuts={String(i + 1)}
                >
                  {GRADE_LABEL[g]}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {rated != null ? (
              <p className="text-sm text-muted-foreground">
                You said: {GRADE_LABEL[rated]}
              </p>
            ) : null}
            <Button
              size="lg"
              disabled={pending}
              className="min-h-11 w-full md:w-auto md:self-start"
              onClick={onNext}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
