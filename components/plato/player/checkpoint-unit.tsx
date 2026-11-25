"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import type {
  AnsweredView,
  DraftView,
  MasterySummaryView,
} from "@/lib/dal/player"
import { checkpointItemLabel } from "@/lib/engine/labels"
import { isWrongSure, requeueWrongSure } from "@/lib/engine/marking"
import {
  checkpointAnsweredBefore,
  isCheckpointRetry,
  markExerciseItem,
  showsRequeueNote,
} from "@/lib/engine/player"
import { budgetAllows, checkpointExerciseEstimate } from "@/lib/engine/session"
import type { SessionKind, SessionPosition } from "@/lib/engine/types"

import { MasteryMeter } from "../mastery-meter"
import { ActionBar } from "./action-bar"
import {
  ExerciseCard,
  exerciseAnsweredFrom,
  type ExerciseAnswered,
  type ExerciseItem,
  type ExerciseItemAnswer,
} from "./exercise"
import { newEventId, usePlayer, useReportPosition } from "./runtime"

/** The retry key in `checkpoint_queue`: the exercise id. */
const keyOf = (item: ExerciseItem) => item.exercise.id

/**
 * A checkpoint (WF-G1): its exercises one at a time, moved through locally,
 * with no intro screen. A wrong *Sure* comes back three exercises later
 * (§7.2), while the label's total stays the number of exercises. Before
 * each next exercise the client applies the budget rule, and sends
 * `budget-end` when it fails (§7.7). Next on the last exercise ends the
 * unit's exercises; the mastery summary (WF-G2) arrives with the answer.
 */
export function CheckpointUnit({
  moduleId,
  lessons,
  total,
  items: startItems,
  index: startIndex,
  answered: startAnswered,
  briefs,
  drafts,
  mastery,
  kind,
  minutes,
}: {
  moduleId: string
  lessons: string
  total: number
  items: ExerciseItem[]
  index: number
  answered: AnsweredView | null
  briefs: Record<string, React.ReactNode>
  drafts: Record<string, DraftView>
  mastery: MasterySummaryView | null
  kind: SessionKind
  minutes: number
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
  const [pending, startTransition] = useTransition()
  const heading = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)

  const ids = items.map(keyOf)
  const item = items[index]
  const label = item
    ? checkpointItemLabel({
        answeredBefore: checkpointAnsweredBefore(ids, index, total),
        total,
        isRetry: isCheckpointRetry(ids, index),
        lessons,
      })
    : ""

  // Each new exercise focuses its heading and is announced (WF-J).
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus()
    player.announce(label)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  const position = (answeredId?: string): SessionPosition =>
    answeredId
      ? { unit: "checkpoint", moduleId, index, answered: answeredId }
      : { unit: "checkpoint", moduleId, index }

  if (mastery)
    return (
      <MasterySummary
        moduleId={moduleId}
        index={startIndex}
        summary={mastery}
      />
    )
  if (!item) return null

  const next = (attemptId: string) => {
    const expected = { session: position(attemptId), lesson: null }
    const to = index + 1
    if (to >= items.length) {
      // The mastery summary follows the last exercise with no budget check.
      startTransition(async () => {
        await player.finish({ kind: "answer-next" }, expected)
      })
      return
    }
    player.send({ kind: "answer-next" }, expected)
    const fits = budgetAllows({
      kind,
      minutes,
      activeMs: player.activeMs(),
      estimateSeconds: checkpointExerciseEstimate,
    })
    if (fits) {
      setAnswered(null)
      setIndex(to)
      return
    }
    // The server checks again and ends the session, or keeps it here.
    startTransition(async () => {
      await player.finish(
        { kind: "budget-end" },
        { session: { unit: "checkpoint", moduleId, index: to }, lesson: null }
      )
    })
  }

  const answer = (
    given: ExerciseItemAnswer,
    opts?: { next?: boolean; onSent?: () => void }
  ) => {
    const marked = markExerciseItem(item.exercise, given)
    const id = newEventId()
    player.send(
      { kind: "answer", answer: given },
      { session: position(), lesson: null },
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
  const busy = pending || player.busy

  return (
    <div className="flex flex-1 flex-col gap-6">
      <ReportPosition
        position={{ session: position(answered?.attemptId), lesson: null }}
      />
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
        pending={busy}
        onAnswer={answer}
        onNext={() => answered && next(answered.attemptId)}
      />
    </div>
  )
}

function ReportPosition({
  position,
}: {
  position: Parameters<typeof useReportPosition>[0]
}) {
  useReportPosition(position)
  return null
}

/**
 * The mastery summary (WF-G2): "Module N mastery", the score, then each
 * concept of the module with its meter and word, then **Continue**.
 */
function MasterySummary({
  moduleId,
  index,
  summary,
}: {
  moduleId: string
  index: number
  summary: MasterySummaryView
}) {
  const player = usePlayer()
  const [pending, startTransition] = useTransition()
  const session: SessionPosition = { unit: "checkpoint", moduleId, index }
  useReportPosition({ session, lesson: null })

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 tabIndex={-1} className="text-2xl font-semibold outline-none">
          {summary.heading}
        </h2>
        <p className="text-sm text-muted-foreground">{summary.score}</p>
      </div>
      <ul className="flex flex-col divide-y rounded-lg border">
        {summary.concepts.map((c) => (
          <li
            key={c.conceptId}
            className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <span className="text-sm">{c.statement}</span>
            <MasteryMeter mastery={c.mastery} className="shrink-0" />
          </li>
        ))}
      </ul>
      <ActionBar>
        <Button
          size="lg"
          className="min-h-11 w-full md:w-auto"
          disabled={pending || player.busy}
          onClick={() =>
            startTransition(async () => {
              await player.finish(
                { kind: "continue" },
                { session, lesson: null }
              )
            })
          }
        >
          Continue
        </Button>
      </ActionBar>
    </div>
  )
}
