"use client"

import { useEffect, useId } from "react"

import { Button } from "@/components/ui/button"
import { CONFIDENCE_LABEL } from "@/lib/engine/labels"
import type { Confidence } from "@/lib/engine/types"

import { notAShortcut } from "./recall-prompt"

const CONFIDENCES: readonly Confidence[] = ["sure", "not_sure", "guess"]

/**
 * Confidence is the submit button (§9.1, spec F5, WF-D2.1): "How sure are
 * you?" Sure, Not sure, Guess, of equal weight, disabled until the exercise
 * is answered. Keys 1/2/3, off while focus is in a text field or a menu or
 * dialog is open.
 */
export function ConfidenceButtons({
  disabled,
  onPick,
}: {
  disabled: boolean
  onPick: (confidence: Confidence) => void
}) {
  const id = useId()

  useEffect(() => {
    if (disabled) return
    const onKey = (e: KeyboardEvent) => {
      if (notAShortcut(e)) return
      if (!["1", "2", "3"].includes(e.key)) return
      e.preventDefault()
      onPick(CONFIDENCES[Number(e.key) - 1])
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [disabled, onPick])

  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
      <p id={id} className="text-sm font-medium">
        How sure are you?
      </p>
      <div className="grid grid-cols-3 gap-2">
        {CONFIDENCES.map((c, i) => (
          <Button
            key={c}
            variant="outline"
            size="lg"
            disabled={disabled}
            className="min-h-11"
            onClick={() => onPick(c)}
            aria-keyshortcuts={String(i + 1)}
          >
            {CONFIDENCE_LABEL[c]}
          </Button>
        ))}
      </div>
    </div>
  )
}
