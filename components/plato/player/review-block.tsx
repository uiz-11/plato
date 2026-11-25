"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import { reviewItemLabel } from "@/lib/engine/labels"
import { nextReviewPosition } from "@/lib/engine/player"
import type { Grade, SessionPosition } from "@/lib/engine/types"
import { cn } from "@/lib/utils"

import { RecallPrompt } from "./recall-prompt"
import { newEventId, usePlayer } from "./runtime"

export type ReviewItem = {
  courseTitle: string
} & (
  | { kind: "prompt"; prompt: React.ReactNode; answer: React.ReactNode }
  | { kind: "exercise" }
)

/**
 * The review block (WF-D1): one review at a time, moved through locally.
 * Rating a recall prompt records the answer and moves on; the block's last
 * item ends the unit (§8.4).
 */
export function ReviewBlock({
  items,
  index: startIndex,
  answered: startAnswered,
}: {
  items: ReviewItem[]
  index: number
  answered: { attemptId: string; grade: Grade } | null
}) {
  const player = usePlayer()
  const [index, setIndex] = useState(startIndex)
  const [answered, setAnswered] = useState(startAnswered)
  const [pending, startTransition] = useTransition()
  const heading = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)

  const item = items[index]
  const label = item
    ? reviewItemLabel(index, items.length, item.courseTitle)
    : ""

  // Each new item focuses its heading and is announced (WF-J). The first
  // one is left alone, so a page load does not jump.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus()
    player.announce(label)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  if (!item) return null

  const position = (answeredId?: string): SessionPosition =>
    answeredId
      ? { unit: "reviews", index, answered: answeredId }
      : { unit: "reviews", index }

  const next = (attemptId: string) => {
    const expected = { session: position(attemptId), lesson: null }
    const to = nextReviewPosition(index, items.length)
    if (to) {
      player.send({ kind: "answer-next" }, expected)
      setAnswered(null)
      setIndex(index + 1)
    } else {
      startTransition(() => player.finish({ kind: "answer-next" }, expected))
    }
  }

  const rate = (grade: Grade) => {
    const id = newEventId()
    player.send(
      { kind: "answer", answer: { kind: "rating", grade } },
      { session: position(), lesson: null },
      { id }
    )
    setAnswered({ attemptId: id, grade })
    next(id)
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ol aria-hidden className="flex gap-1">
        {items.map((_, i) => (
          <li
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              i < index
                ? "bg-foreground"
                : i === index
                  ? "bg-foreground/50"
                  : "bg-muted"
            )}
          />
        ))}
      </ol>
      <h2
        ref={heading}
        tabIndex={-1}
        className="text-xs font-medium text-muted-foreground outline-none"
      >
        {label}
      </h2>
      {item.kind === "prompt" ? (
        <RecallPrompt
          // A new item starts unrevealed.
          key={index}
          prompt={item.prompt}
          answer={item.answer}
          mode={answered ? "next" : "rate"}
          rated={answered?.grade ?? null}
          pending={pending}
          onRate={rate}
          onNext={() => answered && next(answered.attemptId)}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          This kind of review can&apos;t be shown yet. Your progress so far is
          saved.
        </p>
      )}
    </div>
  )
}
