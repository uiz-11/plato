"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import type { AnsweredView } from "@/lib/dal/player"
import { reviewItemLabel } from "@/lib/engine/labels"
import {
  markExerciseItem,
  nextReviewPosition,
  showsRequeueNote,
} from "@/lib/engine/player"
import { isWrongSure, requeueWrongSure } from "@/lib/engine/marking"
import type { Grade, SessionPosition } from "@/lib/engine/types"
import { cn } from "@/lib/utils"

import {
  ExerciseCard,
  exerciseAnsweredFrom,
  type ExerciseAnswered,
  type ExerciseItem,
  type ExerciseItemAnswer,
} from "./exercise"
import { RecallPrompt } from "./recall-prompt"
import { newEventId, usePlayer } from "./runtime"

export type ReviewItem = {
  courseId: string
  courseTitle: string
  conceptId: string
} & (
  | { kind: "prompt"; prompt: React.ReactNode; answer: React.ReactNode }
  | ({ kind: "exercise" } & ExerciseItem)
)

/** The item's retry key, as the server's `reviewKey`. */
const keyOf = (item: Pick<ReviewItem, "courseId" | "conceptId">) =>
  `${item.courseId}:${item.conceptId}`

type Answered =
  | { attemptId: string; grade: Grade; exercise: null }
  | { attemptId: string; grade: Grade; exercise: ExerciseAnswered }

function answeredFrom(
  item: ReviewItem | undefined,
  stored: AnsweredView | null
): Answered | null {
  if (!item || !stored) return null
  if (item.kind === "prompt")
    return { attemptId: stored.attemptId, grade: stored.grade, exercise: null }
  const exercise = exerciseAnsweredFrom(item.exercise, stored)
  return exercise
    ? { attemptId: stored.attemptId, grade: stored.grade, exercise }
    : null
}

/**
 * The review block (WF-D1, WF-D2): one review at a time, moved through
 * locally. A recall prompt is rated; an exercise is answered with a
 * confidence and shows its feedback. A wrong *Sure* comes back three items
 * later, growing the block (§7.2). The block's last item ends the unit.
 */
export function ReviewBlock({
  items: startItems,
  index: startIndex,
  answered: startAnswered,
  briefs,
}: {
  items: ReviewItem[]
  index: number
  answered: AnsweredView | null
  /** Each brief an exercise points to, by its `briefKey`. */
  briefs: Record<string, React.ReactNode>
}) {
  const player = usePlayer()
  const [items, setItems] = useState(startItems)
  const [index, setIndex] = useState(startIndex)
  const [answered, setAnswered] = useState(() =>
    answeredFrom(startItems[startIndex], startAnswered)
  )
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
    setAnswered({ attemptId: id, grade, exercise: null })
    next(id)
  }

  const answerExercise = (answer: ExerciseItemAnswer) => {
    if (item.kind !== "exercise") return
    const marked = markExerciseItem(item.exercise, answer)
    const id = newEventId()
    player.send(
      { kind: "answer", answer },
      { session: position(), lesson: null },
      { id }
    )
    // The same re-queue the server applies, so both queues stay equal.
    const grown = isWrongSure(marked)
      ? requeueWrongSure(items, index, keyOf)
      : null
    if (grown) setItems(grown)
    setAnswered({
      attemptId: id,
      grade: marked.grade,
      exercise: { answer, marked },
    })
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
        <ExerciseCard
          // A new item, or its retry, starts unanswered.
          key={index}
          item={item}
          answered={answered?.exercise ?? null}
          requeued={
            answered?.exercise
              ? showsRequeueNote(items, index, keyOf, answered.exercise.marked)
              : false
          }
          brief={briefs[item.briefKey] ?? null}
          pending={pending}
          onAnswer={answerExercise}
          onNext={() => answered && next(answered.attemptId)}
        />
      )}
    </div>
  )
}
