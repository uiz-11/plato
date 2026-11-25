"use client"

import { useEffect, useRef, useState } from "react"

import type { AnsweredView, DraftView } from "@/lib/dal/player"
import { exerciseItemLabel } from "@/lib/engine/labels"
import { markExerciseItem, showsRequeueNote } from "@/lib/engine/player"
import { isWrongSure, requeueWrongSure } from "@/lib/engine/marking"
import type { LessonPosition, SessionPosition } from "@/lib/engine/types"

import { PendingUnit } from "./end-screens"
import {
  ExerciseCard,
  exerciseAnsweredFrom,
  type ExerciseAnswered,
  type ExerciseItem,
  type ExerciseItemAnswer,
} from "./exercise"
import { PickingUp } from "./recall-unit"
import { newEventId, usePlayer } from "./runtime"

/** The retry key in `recall_queue`: the exercise id. */
const keyOf = (item: ExerciseItem) => item.exercise.id

/**
 * Recall exercises (WF-F1 to WF-F3): the exercises in `recall_queue`, one at
 * a time, moved through locally. A wrong *Sure* comes back three exercises
 * later, growing the queue (§7.2). After the last one the lesson moves on to
 * step 5 inside the same unit; its boards come in T17.
 */
export function RecallExercises({
  lessonId,
  pickingUp,
  items: startItems,
  index: startIndex,
  answered: startAnswered,
  briefs,
  drafts,
}: {
  lessonId: string
  pickingUp: boolean
  items: ExerciseItem[]
  index: number
  answered: AnsweredView | null
  briefs: Record<string, React.ReactNode>
  /** Short answers' drafts, by draft key. */
  drafts: Record<string, DraftView>
}) {
  const player = usePlayer()
  const [items, setItems] = useState(startItems)
  const [index, setIndex] = useState(startIndex)
  const [answered, setAnswered] = useState<{
    attemptId: string
    exercise: ExerciseAnswered
  } | null>(() => {
    const item = startItems[startIndex]
    const exercise =
      item && startAnswered
        ? exerciseAnsweredFrom(item.exercise, startAnswered)
        : null
    return exercise && startAnswered
      ? { attemptId: startAnswered.attemptId, exercise }
      : null
  })
  const [done, setDone] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)

  const item = items[index]
  const label = item
    ? exerciseItemLabel(index, items.length, item.exercise.type)
    : ""

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus()
    player.announce(label)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  if (done || !item) return <PendingUnit />

  const session: SessionPosition = { unit: "lesson", lessonId }
  const lessonAt = (answeredId?: string): LessonPosition =>
    answeredId
      ? { step: "recall", phase: "exercises", index, answered: answeredId }
      : { step: "recall", phase: "exercises", index }

  const next = (attemptId: string) => {
    player.send(
      { kind: "answer-next" },
      { session, lesson: lessonAt(attemptId) }
    )
    setAnswered(null)
    if (index + 1 < items.length) setIndex(index + 1)
    else setDone(true)
  }

  const answer = (
    given: ExerciseItemAnswer,
    opts?: { next?: boolean; onSent?: () => void }
  ) => {
    const marked = markExerciseItem(item.exercise, given)
    const id = newEventId()
    player.send(
      { kind: "answer", answer: given },
      { session, lesson: lessonAt() },
      { id, onSent: opts?.onSent }
    )
    // The same re-queue the server applies, so both queues stay equal.
    const grown = isWrongSure(marked)
      ? requeueWrongSure(items, index, keyOf)
      : null
    if (grown) setItems(grown)
    if (opts?.next) {
      next(id)
    } else {
      setAnswered({ attemptId: id, exercise: { answer: given, marked } })
    }
  }

  const { draftKey } = item

  return (
    <div className="flex flex-1 flex-col gap-6">
      {pickingUp && index === startIndex ? <PickingUp /> : null}
      <h2
        ref={heading}
        tabIndex={-1}
        className="text-xs font-medium text-muted-foreground outline-none"
      >
        {label}
      </h2>
      <ExerciseCard
        // A new exercise, or its retry, starts unanswered.
        key={index}
        item={item}
        answered={answered?.exercise ?? null}
        requeued={
          answered
            ? showsRequeueNote(items, index, keyOf, answered.exercise.marked)
            : false
        }
        brief={briefs[item.briefKey] ?? null}
        draftKey={draftKey}
        draft={draftKey ? (drafts[draftKey] ?? null) : null}
        pending={player.busy}
        onAnswer={answer}
        onNext={() => answered && next(answered.attemptId)}
      />
    </div>
  )
}
