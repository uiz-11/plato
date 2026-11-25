"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { guessItemLabel, warmupItemLabel } from "@/lib/engine/labels"
import type { LessonPosition, SessionPosition } from "@/lib/engine/types"

import { ActionBar } from "./action-bar"
import { Options } from "./exercise"
import { RecallPrompt } from "./recall-prompt"
import { PickingUp } from "./recall-unit"
import { usePlayer, useReportPosition } from "./runtime"

// The lesson steps before Recall (§9.3, WF-E1 to WF-E3). Each is one unit:
// the client moves through its items locally, and the step's last action
// ends the unit, so the next step arrives with the answer (§8.4).

/** Focuses the item heading and announces it when the item changes (WF-J). */
function useItemHeading(index: number, label: string) {
  const player = usePlayer()
  const heading = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus()
    player.announce(label)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])
  return heading
}

function ItemLabel({
  heading,
  children,
}: {
  heading: React.RefObject<HTMLHeadingElement | null>
  children: string
}) {
  return (
    <h2
      ref={heading}
      tabIndex={-1}
      className="text-xs font-medium text-muted-foreground outline-none"
    >
      {children}
    </h2>
  )
}

/**
 * Warm up (WF-E1): the source lesson's prompts. Think, **Show answer**, then
 * **Next**. Nothing is rated, so the schedule is left alone (spec F4).
 */
export function WarmupUnit({
  lessonId,
  pickingUp,
  sourceNumber,
  prompts,
  index: startIndex,
}: {
  lessonId: string
  pickingUp: boolean
  sourceNumber: number
  prompts: { prompt: React.ReactNode; answer: React.ReactNode }[]
  index: number
}) {
  const player = usePlayer()
  const [index, setIndex] = useState(startIndex)
  const [pending, startTransition] = useTransition()
  const label = warmupItemLabel(index, prompts.length, sourceNumber)
  const heading = useItemHeading(index, label)
  const session: SessionPosition = { unit: "lesson", lessonId }
  const lesson: LessonPosition = { step: "warmup", index }
  useReportPosition({ session, lesson })
  const item = prompts[index]
  if (!item) return null

  const next = () => {
    if (index + 1 < prompts.length) {
      player.send({ kind: "warmup-next" }, { session, lesson })
      setIndex(index + 1)
    } else {
      startTransition(async () => {
        await player.finish({ kind: "warmup-next" }, { session, lesson })
      })
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {pickingUp && index === startIndex ? <PickingUp /> : null}
      <ItemLabel heading={heading}>{label}</ItemLabel>
      <RecallPrompt
        // Each prompt starts unrevealed.
        key={index}
        prompt={item.prompt}
        answer={item.answer}
        mode="next"
        pending={pending || player.busy}
        onNext={next}
      />
    </div>
  )
}

/**
 * Guess first (WF-E2): the options as a radio group and **Lock in guess**,
 * disabled until one is picked. No confidence and no feedback: the brief
 * reveals the answer (§9.3).
 */
export function GuessUnit({
  lessonId,
  pickingUp,
  guesses,
  index: startIndex,
}: {
  lessonId: string
  pickingUp: boolean
  guesses: {
    id: string
    prompt: React.ReactNode
    options: { id: string; text: React.ReactNode }[]
  }[]
  index: number
}) {
  const player = usePlayer()
  const [index, setIndex] = useState(startIndex)
  const [picked, setPicked] = useState("")
  const [pending, startTransition] = useTransition()
  const label = guessItemLabel(index, guesses.length)
  const heading = useItemHeading(index, label)
  const session: SessionPosition = { unit: "lesson", lessonId }
  const lesson: LessonPosition = { step: "guess", index }
  useReportPosition({ session, lesson })
  const guess = guesses[index]
  if (!guess) return null

  const lock = () => {
    if (!picked) return
    const event = { kind: "guess-lock", optionId: picked } as const
    if (index + 1 < guesses.length) {
      player.send(event, { session, lesson })
      setPicked("")
      setIndex(index + 1)
    } else {
      startTransition(async () => {
        await player.finish(event, { session, lesson })
      })
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {pickingUp && index === startIndex ? <PickingUp /> : null}
      <ItemLabel heading={heading}>{label}</ItemLabel>
      <div className="text-lg leading-relaxed font-medium">{guess.prompt}</div>
      <Options
        key={guess.id}
        label="Your guess"
        ids={guess.options.map((o) => o.id)}
        nodes={Object.fromEntries(guess.options.map((o) => [o.id, o.text]))}
        value={picked}
        onChange={setPicked}
        marked={null}
      />
      <ActionBar>
        <Button
          size="lg"
          className="min-h-11 w-full md:w-auto"
          disabled={!picked || pending || player.busy}
          onClick={lock}
        >
          Lock in guess
        </Button>
      </ActionBar>
    </div>
  )
}

/**
 * Read (WF-E3, WF-I2): "~7 min read", the brief with "Why this matters"
 * under its heading and the learner's guesses revealed, then "Beyond this
 * lesson", then **Done reading**.
 */
export function ReadUnit({
  lessonId,
  pickingUp,
  readMinutes,
  children,
}: {
  lessonId: string
  pickingUp: boolean
  readMinutes: number
  /** The brief and Beyond, rendered on the server. */
  children: React.ReactNode
}) {
  const player = usePlayer()
  const [pending, startTransition] = useTransition()
  const session: SessionPosition = { unit: "lesson", lessonId }
  const lesson: LessonPosition = { step: "read" }
  useReportPosition({ session, lesson })
  return (
    <div className="flex flex-1 flex-col gap-4">
      {pickingUp ? <PickingUp /> : null}
      <p className="text-xs text-muted-foreground">~{readMinutes} min read</p>
      <article className="min-w-0">{children}</article>
      {/* Not pinned: §9 Phone pins the submit, confidence and Next buttons,
          and a pinned Done reading would cover the brief and end Read on a
          stray tap. */}
      <div className="mt-2">
        <Button
          size="lg"
          className="min-h-11 w-full md:w-auto"
          disabled={pending || player.busy}
          onClick={() =>
            startTransition(async () => {
              await player.finish({ kind: "read-done" }, { session, lesson })
            })
          }
        >
          Done reading
        </Button>
      </div>
    </div>
  )
}
