"use client"

import { useEffect, useId, useRef, useState, useTransition } from "react"
import { PartyPopperIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { AnsweredView, BoardView, DraftView } from "@/lib/dal/player"
import { exerciseItemLabel } from "@/lib/engine/labels"
import { markExerciseItem, showsRequeueNote } from "@/lib/engine/player"
import { isWrongSure, requeueWrongSure } from "@/lib/engine/marking"
import type { LessonPosition, SessionPosition } from "@/lib/engine/types"

import { StickyNote } from "../sticky-note"
import { Celebration } from "./celebration"
import {
  ExerciseCard,
  exerciseAnsweredFrom,
  type ExerciseAnswered,
  type ExerciseItem,
  type ExerciseItemAnswer,
} from "./exercise"
import { PickingUp } from "./recall-unit"
import {
  forgetLocalDraft,
  newEventId,
  useDraft,
  usePlayer,
  useReportPosition,
} from "./runtime"

/** The retry key in `recall_queue`: the exercise id. */
const keyOf = (item: ExerciseItem) => item.exercise.id

/**
 * Recall exercises (WF-F1 to WF-F3): the exercises in `recall_queue`, one at
 * a time, moved through locally. A wrong *Sure* comes back three exercises
 * later, growing the queue (§7.2). After the last one the lesson moves on to
 * step 5 inside the same unit (WF-E6), and its last board ends the unit; the
 * lesson-complete screen (WF-E7) arrives with the answer.
 */
export function RecallExercises({
  lessonId,
  pickingUp,
  items: startItems,
  index: startIndex,
  answered: startAnswered,
  briefs,
  drafts,
  stage,
  lessonLabel,
  boards,
  boardIndex,
  complete,
}: {
  lessonId: string
  pickingUp: boolean
  stage: "exercises" | "answers" | "done"
  lessonLabel: string
  boards: BoardView[]
  boardIndex: number
  complete: { heading: string; line: string | null } | null
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

  const session: SessionPosition = { unit: "lesson", lessonId }
  const lessonAt = (answeredId?: string): LessonPosition =>
    answeredId
      ? { step: "recall", phase: "exercises", index, answered: answeredId }
      : { step: "recall", phase: "exercises", index }

  if (complete) return <LessonComplete lessonId={lessonId} {...complete} />
  if (done || stage !== "exercises" || !item)
    return (
      <AnswerBoards
        lessonId={lessonId}
        pickingUp={pickingUp && stage === "answers"}
        arrived={stage === "exercises"}
        lessonLabel={lessonLabel}
        boards={boards}
        index={stage === "answers" ? boardIndex : 0}
      />
    )

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
      <ReportPosition
        position={{ session, lesson: lessonAt(answered?.attemptId) }}
      />
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

function ReportPosition({
  position,
}: {
  position: Parameters<typeof useReportPosition>[0]
}) {
  useReportPosition(position)
  return null
}

/**
 * Add to your answers (WF-E6, spec F7): one board per key question the
 * lesson advances, each with its earlier notes and a blank sticky note.
 * **Stick it** saves the note and moves to the next board; **Skip this
 * step** skips every board left. Either on the last board completes the
 * lesson. Never graded.
 */
function AnswerBoards({
  lessonId,
  pickingUp,
  lessonLabel,
  boards,
  index: startIndex,
  arrived,
}: {
  lessonId: string
  pickingUp: boolean
  lessonLabel: string
  boards: BoardView[]
  index: number
  /** Reached from the last exercise on this page, not loaded at a board. */
  arrived: boolean
}) {
  const player = usePlayer()
  const [index, setIndex] = useState(startIndex)
  const heading = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)
  const session: SessionPosition = { unit: "lesson", lessonId }
  const lesson: LessonPosition = { step: "answers", index }
  useReportPosition({ session, lesson })

  useEffect(() => {
    // Arriving from the last exercise, or moving to the next board; a load
    // or reload at a board leaves focus where it is, like any other unit.
    if (first.current) {
      first.current = false
      if (!arrived) return
    }
    heading.current?.focus()
    player.announce("Add to your answers")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  /** Boards from `from` on will not be stuck: forget their typed text. */
  const dropDrafts = (from: number) => {
    for (const b of boards.slice(from)) {
      player.clearDraft(b.draftKey)
      forgetLocalDraft(b.draftKey)
    }
  }

  const board = boards[index]
  if (!board) return null
  return (
    <div className="flex flex-1 flex-col gap-6">
      {pickingUp && index === startIndex ? <PickingUp /> : null}
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">Optional</p>
        <h2
          ref={heading}
          tabIndex={-1}
          className="text-lg font-medium outline-none"
        >
          Add to your answers
        </h2>
      </div>
      <Board
        // Each board has its own draft.
        key={board.keyQuestionId}
        board={board}
        lessonLabel={lessonLabel}
        onStick={(text, onSent) => {
          const event = { kind: "note-stick", text } as const
          if (index + 1 < boards.length) {
            player.send(event, { session, lesson }, { onSent })
            setIndex(index + 1)
            return Promise.resolve(true)
          }
          return player.finish(event, { session, lesson }).then((ok) => {
            if (ok) {
              onSent()
              dropDrafts(index + 1)
            }
            return ok
          })
        }}
        onSkip={() =>
          player
            .finish({ kind: "answers-skip" }, { session, lesson })
            .then((ok) => {
              // The server drops what the skipped boards held.
              if (ok) dropDrafts(index)
            })
        }
      />
    </div>
  )
}

function Board({
  board,
  lessonLabel,
  onStick,
  onSkip,
}: {
  board: BoardView
  lessonLabel: string
  /**
   * Resolves true once the note is on its way (at once inside the unit;
   * once the server has it on the last board). `onSent` runs once the
   * server has it.
   */
  onStick: (text: string, onSent: () => void) => Promise<boolean>
  onSkip: () => Promise<void>
}) {
  const player = usePlayer()
  const { text, change, blur, submit, forget } = useDraft(
    board.draftKey,
    board.draft
  )
  const [pending, startTransition] = useTransition()
  const id = useId()
  const qLabel = board.keyQuestionId.toUpperCase()
  const busy = pending || player.busy
  return (
    <>
      <section aria-labelledby={id} className="flex flex-col gap-4">
        <h3 id={id} className="text-sm font-medium">
          <span className="mr-2 text-muted-foreground">{qLabel}</span>
          {board.text}
        </h3>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {board.notes.map((n) => (
            <li key={n.id}>
              <StickyNote label={n.lessonLabel ?? undefined}>
                {n.text}
              </StickyNote>
            </li>
          ))}
          <li>
            <div
              data-slot="sticky-note"
              className="flex min-h-24 w-full flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm shadow-xs focus-within:ring-3 focus-within:ring-ring/50"
            >
              <Textarea
                aria-label={`Your note for ${qLabel}`}
                placeholder="what did this lesson add?"
                value={text}
                onChange={(e) => change(e.target.value)}
                onBlur={blur}
                maxLength={2000}
                className="min-h-20 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
              <span className="mt-auto text-xs font-medium text-muted-foreground">
                {lessonLabel}
              </span>
            </div>
          </li>
        </ul>
      </section>
      <div className="sticky bottom-0 mt-auto flex flex-col-reverse gap-2 bg-background py-2 md:static md:flex-row md:py-0">
        <Button
          size="lg"
          variant="outline"
          className="min-h-11"
          disabled={busy}
          onClick={() => startTransition(onSkip)}
        >
          Skip this step
        </Button>
        <Button
          size="lg"
          className="min-h-11"
          disabled={busy || text.trim() === ""}
          onClick={() =>
            startTransition(async () => {
              // × keeps saving the text as a draft until the note is sent.
              if (await onStick(text.trim(), forget)) submit()
            })
          }
        >
          Stick it
        </Button>
      </div>
    </>
  )
}

/** Lesson complete (WF-E7): the celebration line, then **Continue**. */
function LessonComplete({
  lessonId,
  heading,
  line,
}: {
  lessonId: string
  heading: string
  line: string | null
}) {
  const player = usePlayer()
  const [pending, startTransition] = useTransition()
  const session: SessionPosition = { unit: "lesson", lessonId }
  useReportPosition({ session, lesson: { step: "done" } })
  return (
    <Celebration icon={PartyPopperIcon} heading={heading} line={line}>
      <Button
        size="lg"
        className="min-h-11 w-full md:w-auto"
        disabled={pending || player.busy}
        onClick={() =>
          startTransition(async () => {
            await player.finish(
              { kind: "continue" },
              { session, lesson: { step: "done" } }
            )
          })
        }
      >
        Continue
      </Button>
    </Celebration>
  )
}
