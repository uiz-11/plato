"use client"

import { useEffect, useId, useRef, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { recallTickButton } from "@/lib/engine/labels"
import { selectRecallExercises } from "@/lib/engine/lesson"
import type { Exercise } from "@/lib/content/schema"
import type { SessionPosition } from "@/lib/engine/types"

import {
  forgetLocalDraft,
  useDraft,
  usePlayer,
  useReportPosition,
  type DraftCopy,
} from "./runtime"

type RecallExercise = Pick<Exercise, "id" | "pool" | "concepts">

/** "Picking up where you stopped" (WF-E4.1). */
export function PickingUp() {
  return (
    <p className="text-xs text-muted-foreground">
      Picking up where you stopped
    </p>
  )
}

/**
 * Recall, write then tick (WF-E4, WF-E5): one unit. **Check** records the
 * text and moves to the ticks locally; **Practice what you missed** ends the
 * unit, and the Recall exercises arrive with the answer (§8.4).
 */
export function RecallUnit({
  lessonId,
  phase: startPhase,
  pickingUp,
  draftKey,
  draft,
  written,
  concepts,
  exercises,
}: {
  lessonId: string
  phase: "write" | "tick"
  pickingUp: boolean
  draftKey: string
  draft: DraftCopy | null
  written: string | null
  concepts: { id: string; statement: string }[]
  exercises: RecallExercise[]
}) {
  const player = usePlayer()
  const [phase, setPhase] = useState(startPhase)
  const [text, setText] = useState(written ?? "")
  const heading = useRef<HTMLHeadingElement>(null)
  const session: SessionPosition = { unit: "lesson", lessonId }
  useReportPosition({ session, lesson: { step: "recall", phase } })

  // Loaded at the ticks: the server has the text, so a local copy left by a
  // send that was confirmed after a reload is no longer needed.
  useEffect(() => {
    if (startPhase === "tick") forgetLocalDraft(draftKey)
  }, [startPhase, draftKey])

  useEffect(() => {
    if (phase === "tick" && startPhase === "write") {
      heading.current?.focus()
      player.announce("Tick what you recalled")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  return (
    <div className="flex flex-1 flex-col gap-4">
      {pickingUp ? <PickingUp /> : null}
      {phase === "write" ? (
        <RecallWrite
          draftKey={draftKey}
          draft={draft}
          onCheck={(value, onSent) => {
            player.send(
              { kind: "recall-write", text: value },
              { session, lesson: { step: "recall", phase: "write" } },
              { onSent }
            )
            setText(value)
            setPhase("tick")
          }}
        />
      ) : (
        <RecallTick
          heading={heading}
          written={text}
          concepts={concepts}
          exercises={exercises}
          onPractice={(ticked) =>
            player
              .finish(
                { kind: "recall-tick", ticked },
                { session, lesson: { step: "recall", phase: "tick" } }
              )
              .then(() => undefined)
          }
        />
      )}
    </div>
  )
}

function RecallWrite({
  draftKey,
  draft,
  onCheck,
}: {
  draftKey: string
  draft: DraftCopy | null
  /** `onSent` runs once the server has the text. */
  onCheck: (text: string, onSent: () => void) => void
}) {
  const { text, change, blur, submit, forget } = useDraft(draftKey, draft)
  const id = useId()
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-lg font-medium">
          What do you remember?
        </h2>
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          Keywords are fine.
        </p>
      </div>
      <Textarea
        aria-labelledby={id}
        aria-describedby={`${id}-help`}
        value={text}
        onChange={(e) => change(e.target.value)}
        onBlur={blur}
        className="min-h-40"
      />
      <div className="mt-auto">
        <Button
          size="lg"
          className="min-h-11 w-full md:w-auto"
          onClick={() => {
            submit()
            onCheck(text, forget)
          }}
        >
          Check
        </Button>
      </div>
    </>
  )
}

function RecallTick({
  heading,
  written,
  concepts,
  exercises,
  onPractice,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>
  written: string
  concepts: { id: string; statement: string }[]
  exercises: RecallExercise[]
  onPractice: (ticked: string[]) => Promise<void>
}) {
  const player = usePlayer()
  const [ticked, setTicked] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const id = useId()
  const missed = concepts.length - ticked.length
  const queue = selectRecallExercises({ concepts, exercises }, ticked)

  const toggle = (conceptId: string, on: boolean) => {
    const next = on
      ? concepts
          .map((c) => c.id)
          .filter((c) => c === conceptId || ticked.includes(c))
      : ticked.filter((c) => c !== conceptId)
    setTicked(next)
    player.announce(`${next.length} of ${concepts.length} recalled`)
  }

  return (
    <>
      <h2
        ref={heading}
        id={id}
        tabIndex={-1}
        className="text-lg font-medium outline-none"
      >
        Tick what you recalled
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-muted/40 p-4 text-sm md:order-2">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            You wrote
          </h3>
          <p className="whitespace-pre-wrap">
            {written.trim() ? written : "Nothing written"}
          </p>
        </section>
        <ul aria-labelledby={id} className="flex flex-col gap-3 md:order-1">
          {concepts.map((c) => (
            <li key={c.id}>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={ticked.includes(c.id)}
                  onCheckedChange={(on) => toggle(c.id, on === true)}
                />
                <span>{c.statement}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto">
        <Button
          size="lg"
          className="min-h-11 w-full md:w-auto"
          disabled={pending}
          onClick={() => startTransition(() => onPractice(ticked))}
        >
          {recallTickButton(missed, queue.length)}
        </Button>
      </div>
    </>
  )
}
