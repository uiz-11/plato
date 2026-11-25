"use client"

import { useEffect, useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import type { Exercise } from "@/lib/content/schema"
import {
  REQUEUE_NOTE,
  resultLine,
  shortAnswerTickLine,
} from "@/lib/engine/labels"
import { canSubmitFill, explanationOpens } from "@/lib/engine/marking"
import type { ExerciseResponse, MarkedAnswer } from "@/lib/engine/marking"
import type { ItemAnswer } from "@/lib/engine/player"
import type { Confidence } from "@/lib/engine/types"
import { cn } from "@/lib/utils"

import { BriefSheet } from "./brief-sheet"
import { ConfidenceButtons } from "./confidence-buttons"
import { useDraft, usePlayer, type DraftCopy } from "./runtime"

// One exercise (§9.3, WF-D2, WF-F1 to WF-F3): the four automatically marked
// types answer and submit with a confidence; a short answer is written, then
// marked by ticking its checklist. All five end in the same `Feedback`.

/** An exercise's rendered fields, as React nodes from the server. */
export interface ExerciseNodes {
  prompt: React.ReactNode
  explanation: React.ReactNode
  scenario?: React.ReactNode
  options?: Record<string, React.ReactNode>
  sentences?: Record<string, React.ReactNode>
  fixes?: Record<string, React.ReactNode>
}

export interface ExerciseItem {
  /** The content with its answer key, so the client marks at once (§7.2). */
  exercise: Exercise
  nodes: ExerciseNodes
  /** Which of the unit's briefs "In the brief" opens. */
  briefKey: string
  /** A short answer's draft key (§8.4 Typed text). */
  draftKey?: string
}

export type ExerciseItemAnswer = Extract<ItemAnswer, { kind: "exercise" }>

/**
 * An answered exercise: what was given and how it was marked. `answer` is
 * null when a stored answer cannot be read back; the feedback then shows
 * the result without the picks, and Next still moves on.
 */
export interface ExerciseAnswered {
  answer: ExerciseItemAnswer | null
  marked: MarkedAnswer
}

/**
 * Rebuilds an answered exercise from what the server stored (§8.4), so a
 * reload shows its feedback. Null only when nothing was stored.
 */
export function exerciseAnsweredFrom(
  exercise: Pick<Exercise, "type">,
  stored: {
    answer: ItemAnswer | null
    correct: boolean | null
    confidence: Confidence | null
    selfMark: MarkedAnswer["selfMark"]
    grade: MarkedAnswer["grade"]
  } | null
): ExerciseAnswered | null {
  if (!stored) return null
  const answer = stored.answer
  return {
    answer:
      answer?.kind === "exercise" && answer.response.type === exercise.type
        ? answer
        : null,
    marked: {
      correct: stored.correct,
      confidence: stored.confidence,
      selfMark: stored.selfMark,
      grade: stored.grade,
    },
  }
}

/**
 * The local copy of a short answer's check (§9.3): it was submitted, and
 * which checklist points are ticked, so a reload returns to the checklist as
 * it was. The text itself is the draft.
 */
const checkKey = (draftKey: string) => `plato:short-check:${draftKey}`

function readCheck(draftKey: string): number[] | null {
  try {
    const raw = localStorage.getItem(checkKey(draftKey))
    if (raw === null) return null
    const v = JSON.parse(raw) as { ticked?: unknown }
    return Array.isArray(v.ticked)
      ? v.ticked.filter((i): i is number => Number.isInteger(i))
      : []
  } catch {
    return null
  }
}

function writeCheck(draftKey: string, ticked: number[] | null): void {
  try {
    if (ticked === null) localStorage.removeItem(checkKey(draftKey))
    else localStorage.setItem(checkKey(draftKey), JSON.stringify({ ticked }))
  } catch {
    // No storage: a reload shows the text box with the draft.
  }
}

export function ExerciseCard({
  item,
  answered,
  requeued,
  brief,
  draftKey,
  draft,
  pending,
  onAnswer,
  onNext,
}: {
  item: ExerciseItem
  answered: ExerciseAnswered | null
  /** A wrong *Sure* whose retry is queued: the feedback says so. */
  requeued: boolean
  brief: React.ReactNode | null
  /** A short answer's draft key and the server's copy (§8.4). */
  draftKey?: string
  draft?: DraftCopy | null
  pending: boolean
  /**
   * Records the answer. A short answer is recorded with **Next**, so it
   * moves on too (`next`); `onSent` runs once the server has it.
   */
  onAnswer: (
    answer: ExerciseItemAnswer,
    opts?: { next?: boolean; onSent?: () => void }
  ) => void
  onNext: () => void
}) {
  const { exercise } = item
  if (exercise.type === "short") {
    if (!draftKey) throw new Error("A short answer needs a draft key")
    return (
      <ShortAnswer
        exercise={exercise}
        nodes={item.nodes}
        answered={answered}
        brief={brief}
        draftKey={draftKey}
        draft={draft ?? null}
        pending={pending}
        onAnswer={onAnswer}
        onNext={onNext}
      />
    )
  }
  return (
    <AutoExercise
      exercise={exercise}
      nodes={item.nodes}
      answered={answered}
      requeued={requeued}
      brief={brief}
      pending={pending}
      onAnswer={onAnswer}
      onNext={onNext}
    />
  )
}

// --- Automatically marked ---------------------------------------------------

type AutoType = Exclude<Exercise, { type: "short" }>

function AutoExercise({
  exercise,
  nodes,
  answered,
  requeued,
  brief,
  pending,
  onAnswer,
  onNext,
}: {
  exercise: AutoType
  nodes: ExerciseNodes
  answered: ExerciseAnswered | null
  requeued: boolean
  brief: React.ReactNode | null
  pending: boolean
  onAnswer: (answer: ExerciseItemAnswer) => void
  onNext: () => void
}) {
  const given = answered?.answer?.response
  const [optionId, setOptionId] = useState(
    given && "optionId" in given ? given.optionId : ""
  )
  const [sentenceId, setSentenceId] = useState(
    given?.type === "spot" ? given.sentenceId : ""
  )
  const [fixId, setFixId] = useState(given?.type === "spot" ? given.fixId : "")
  const [text, setText] = useState(given?.type === "fill" ? given.text : "")
  // Focus moves to the result after a submit, not on a reload (WF-J).
  const [justAnswered, setJustAnswered] = useState(false)

  const response = (): ExerciseResponse | null => {
    switch (exercise.type) {
      case "mc":
      case "scenario":
        return optionId ? { type: exercise.type, optionId } : null
      case "fill":
        return canSubmitFill(text) ? { type: "fill", text } : null
      case "spot":
        return sentenceId && fixId ? { type: "spot", sentenceId, fixId } : null
    }
  }
  const ready = response() !== null

  const submit = (confidence: Confidence) => {
    const r = response()
    if (!r || answered || pending) return
    setJustAnswered(true)
    onAnswer({ kind: "exercise", response: r, confidence })
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {exercise.type === "scenario" && nodes.scenario ? (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed">
          {nodes.scenario}
        </div>
      ) : null}
      {exercise.type === "spot" ? (
        <div className="text-sm font-medium text-muted-foreground">
          {nodes.prompt}
        </div>
      ) : (
        <div className="text-lg leading-relaxed font-medium">
          {nodes.prompt}
        </div>
      )}

      {exercise.type === "mc" || exercise.type === "scenario" ? (
        <Options
          label="Options"
          ids={exercise.options.map((o) => o.id)}
          nodes={nodes.options ?? {}}
          value={optionId}
          onChange={setOptionId}
          marked={
            answered ? { picked: optionId, correct: exercise.correct } : null
          }
        />
      ) : null}

      {exercise.type === "fill" ? (
        <FillAnswer
          value={text}
          onChange={setText}
          marked={
            answered
              ? {
                  correct: answered.marked.correct === true,
                  answer: exercise.accepted[0],
                }
              : null
          }
        />
      ) : null}

      {exercise.type === "spot" ? (
        <>
          <Options
            label="Part 1 · Which sentence is wrong?"
            showLabel
            ids={exercise.sentences.map((o) => o.id)}
            nodes={nodes.sentences ?? {}}
            value={sentenceId}
            onChange={setSentenceId}
            marked={
              answered ? { picked: sentenceId, correct: exercise.faulty } : null
            }
          />
          <Options
            label="Part 2 · Pick the fix"
            showLabel
            ids={exercise.fixes.map((o) => o.id)}
            nodes={nodes.fixes ?? {}}
            value={fixId}
            onChange={setFixId}
            marked={
              answered ? { picked: fixId, correct: exercise.correctFix } : null
            }
          />
        </>
      ) : null}

      {answered ? (
        <Feedback
          result={resultLine(
            answered.marked.correct === true,
            answered.marked.confidence ?? "sure"
          )}
          note={requeued ? REQUEUE_NOTE : null}
          explanation={nodes.explanation}
          explanationOpen={explanationOpens(answered.marked)}
          anchor={exercise.anchor}
          brief={brief}
          focus={justAnswered}
          pending={pending}
          onNext={onNext}
        />
      ) : (
        <div className="mt-auto">
          <ConfidenceButtons disabled={!ready || pending} onPick={submit} />
        </div>
      )}
    </div>
  )
}

/**
 * An option list: a `RadioGroup` before answering (arrow keys, WF-J), then
 * the same options with the pick and the correct one marked by a symbol and
 * text as well as style (§9.1 Feedback). Guess first uses it unmarked.
 */
export function Options({
  label,
  showLabel = false,
  ids,
  nodes,
  value,
  onChange,
  marked,
}: {
  label: string
  showLabel?: boolean
  ids: string[]
  nodes: Record<string, React.ReactNode>
  value: string
  onChange: (id: string) => void
  marked: { picked: string; correct: string } | null
}) {
  const id = useId()
  const heading = showLabel ? (
    <h3 id={id} className="text-sm font-medium">
      {label}
    </h3>
  ) : null
  const named = showLabel ? { "aria-labelledby": id } : { "aria-label": label }

  if (marked) {
    return (
      <div className="flex flex-col gap-2">
        {heading}
        <ul {...named} className="flex flex-col gap-2">
          {ids.map((optionId) => {
            const right = optionId === marked.correct
            const picked = optionId === marked.picked
            const tag = picked
              ? right
                ? "Your answer · correct"
                : "Your answer"
              : right
                ? "Correct"
                : null
            return (
              <li
                key={optionId}
                data-correct={right || undefined}
                data-picked={picked || undefined}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
                  right && "border-foreground",
                  picked && !right && "border-dashed",
                  !right && !picked && "text-muted-foreground"
                )}
              >
                <span aria-hidden="true" className="w-4 shrink-0">
                  {right ? "✓" : picked ? "✗" : ""}
                </span>
                <span className="flex-1">{nodes[optionId]}</span>
                {tag ? (
                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    {tag}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {heading}
      <RadioGroup
        {...named}
        value={value}
        onValueChange={(v) => onChange(String(v))}
        className="gap-2"
      >
        {ids.map((optionId) => (
          <label
            key={optionId}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-data-checked:border-foreground"
          >
            <RadioGroupItem value={optionId} className="mt-0.5" />
            <span className="flex-1">{nodes[optionId]}</span>
          </label>
        ))}
      </RadioGroup>
    </div>
  )
}

function FillAnswer({
  value,
  onChange,
  marked,
}: {
  value: string
  onChange: (text: string) => void
  marked: { correct: boolean; answer: string } | null
}) {
  if (marked) {
    return (
      <ul aria-label="Your answer" className="flex flex-col gap-2 text-sm">
        {/* Empty only when a stored answer could not be read back. */}
        {value === "" ? null : (
          <li
            data-correct={marked.correct || undefined}
            data-picked
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5",
              marked.correct ? "border-foreground" : "border-dashed"
            )}
          >
            <span aria-hidden="true" className="w-4 shrink-0">
              {marked.correct ? "✓" : "✗"}
            </span>
            <span className="flex-1 whitespace-pre-wrap">{value}</span>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {marked.correct ? "Your answer · correct" : "Your answer"}
            </span>
          </li>
        )}
        {marked.correct ? null : (
          <li
            data-correct
            className="flex items-start gap-3 rounded-lg border border-foreground px-3 py-2.5"
          >
            <span aria-hidden="true" className="w-4 shrink-0">
              ✓
            </span>
            <span className="flex-1">{marked.answer}</span>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              Correct
            </span>
          </li>
        )}
      </ul>
    )
  }
  return (
    <Input
      aria-label="Type the missing word"
      placeholder="Type the missing word"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 md:max-w-sm"
    />
  )
}

// --- Short answer -----------------------------------------------------------

/** About 25 words (spec F5): the counter warns past this. */
const SHORT_ANSWER_WORDS = 25

const wordCount = (text: string) =>
  text.trim() === "" ? 0 : text.trim().split(/\s+/).length

function ShortAnswer({
  exercise,
  nodes,
  answered,
  brief,
  draftKey,
  draft,
  pending,
  onAnswer,
  onNext,
}: {
  exercise: Extract<Exercise, { type: "short" }>
  nodes: ExerciseNodes
  answered: ExerciseAnswered | null
  brief: React.ReactNode | null
  draftKey: string
  draft: DraftCopy | null
  pending: boolean
  onAnswer: (
    answer: ExerciseItemAnswer,
    opts?: { next?: boolean; onSent?: () => void }
  ) => void
  onNext: () => void
}) {
  const player = usePlayer()
  const { text, change, blur, submit, forget } = useDraft(draftKey, draft)
  const given = answered?.answer?.response
  const stored = given?.type === "short" ? given : null
  const [submitted, setSubmitted] = useState(answered !== null)
  const [ticked, setTicked] = useState<number[]>(stored?.ticked ?? [])
  const [justSubmitted, setJustSubmitted] = useState(false)
  const id = useId()
  const words = wordCount(text)

  // A reload after Submit returns to the checklist as it was (§9.3): the
  // text is still a draft, and the local check copy holds the ticks. Once
  // the server has the answer, both local copies are left over: drop them.
  useEffect(() => {
    if (answered) {
      writeCheck(draftKey, null)
      forget()
      return
    }
    const check = readCheck(draftKey)
    if (check === null) return
    // Read after hydration: localStorage is not readable on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitted(true)
    setTicked(check.filter((i) => i >= 0 && i < exercise.checklist.length))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  const total = exercise.checklist.length
  // An answer read back without its ticks shows no count.
  const line =
    answered && !stored ? null : shortAnswerTickLine(ticked.length, total)

  if (!submitted) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <h3 id={id} className="text-lg leading-relaxed font-medium">
          {nodes.prompt}
        </h3>
        <div className="flex flex-col gap-1.5">
          <Textarea
            aria-labelledby={id}
            aria-describedby={`${id}-count`}
            value={text}
            onChange={(e) => change(e.target.value)}
            onBlur={blur}
            className="min-h-24"
          />
          <p
            id={`${id}-count`}
            className={cn(
              "text-xs text-muted-foreground",
              words > SHORT_ANSWER_WORDS && "text-foreground"
            )}
          >
            {words > SHORT_ANSWER_WORDS
              ? `${words} words · aim for ${SHORT_ANSWER_WORDS} or fewer`
              : `${words} of about ${SHORT_ANSWER_WORDS} words`}
          </p>
        </div>
        <div className="mt-auto">
          <Button
            size="lg"
            className="min-h-11 w-full md:w-auto"
            disabled={text.trim() === "" || pending}
            onClick={() => {
              writeCheck(draftKey, [])
              // The text stays a draft until Next; the server gets it now.
              blur()
              setJustSubmitted(true)
              setSubmitted(true)
            }}
          >
            Submit
          </Button>
        </div>
      </div>
    )
  }

  const written = stored?.text ?? text
  const toggle = (i: number, on: boolean) => {
    const next = on
      ? exercise.checklist
          .map((_, j) => j)
          .filter((j) => j === i || ticked.includes(j))
      : ticked.filter((j) => j !== i)
    setTicked(next)
    writeCheck(draftKey, next)
    player.announce(shortAnswerTickLine(next.length, total))
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="text-lg leading-relaxed font-medium">{nodes.prompt}</div>
      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-lg border p-4 text-sm">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            You wrote
          </h3>
          <p className="whitespace-pre-wrap">{written}</p>
        </section>
        <section className="rounded-lg border bg-muted/40 p-4 text-sm">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            Sample answer
          </h3>
          <p>{exercise.sample}</p>
        </section>
      </div>
      <div className="flex flex-col gap-2">
        <h3 id={`${id}-ticks`} className="text-sm font-medium">
          Tick what you covered
        </h3>
        <ul aria-labelledby={`${id}-ticks`} className="flex flex-col gap-1">
          {exercise.checklist.map((point, i) => (
            <li key={i}>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={ticked.includes(i)}
                  disabled={answered !== null}
                  onCheckedChange={(on) => toggle(i, on === true)}
                />
                <span>{point}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <Feedback
        result={null}
        explanation={nodes.explanation}
        explanationOpen
        anchor={exercise.anchor}
        brief={brief}
        focus={justSubmitted}
        footer={line}
        pending={pending}
        onNext={() => {
          if (answered) return onNext()
          submit()
          // Dropped now, not once sent: if the server refuses the answer,
          // nothing would clear it later.
          writeCheck(draftKey, null)
          onAnswer(
            {
              kind: "exercise",
              response: { type: "short", text: written, ticked },
              confidence: null,
            },
            { next: true, onSent: forget }
          )
        }}
      />
    </div>
  )
}

// --- Feedback ---------------------------------------------------------------

/**
 * After an answer (§9.1, WF-F1 to WF-F3): the result line, the explanation
 * (open, or behind "Why?" after a correct *Sure*), "In the brief", and Next.
 * Focus moves to the result after a submit, and the result is announced.
 */
export function Feedback({
  result,
  note = null,
  explanation,
  explanationOpen,
  anchor,
  brief,
  focus,
  footer,
  pending,
  onNext,
}: {
  result: string | null
  note?: string | null
  explanation: React.ReactNode
  explanationOpen: boolean
  anchor: string
  brief: React.ReactNode | null
  /** Move focus here: true right after a submit, false on a reload. */
  focus: boolean
  /** Beside Next, e.g. a short answer's tick line. */
  footer?: React.ReactNode
  pending: boolean
  onNext: () => void
}) {
  const player = usePlayer()
  const [why, setWhy] = useState(explanationOpen)
  const [sheet, setSheet] = useState(false)
  const first = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!focus) return
    first.current?.focus()
    if (result) player.announce(note ? `${result}. ${note}` : result)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <section
        aria-label="Feedback"
        className="flex flex-col gap-3 rounded-lg border p-4 text-sm leading-relaxed"
      >
        <div
          ref={first}
          tabIndex={-1}
          className="flex flex-col gap-1 outline-none"
        >
          {result ? <p className="font-medium">{result}</p> : null}
          {note ? <p className="text-muted-foreground">{note}</p> : null}
          {why ? <div className="[&_p]:my-0">{explanation}</div> : null}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {why ? null : (
            <Button
              variant="link"
              className="h-auto min-h-11 px-0 md:min-h-0"
              onClick={() => setWhy(true)}
            >
              Why?
            </Button>
          )}
          {brief ? (
            <Button
              variant="link"
              className="h-auto min-h-11 px-0 md:min-h-0"
              onClick={() => setSheet(true)}
            >
              In the brief
            </Button>
          ) : null}
        </div>
      </section>
      <div className="mt-auto flex items-center justify-between gap-3">
        {footer ? (
          <span className="text-sm text-muted-foreground">{footer}</span>
        ) : (
          <span />
        )}
        <Button
          size="lg"
          disabled={pending}
          className="min-h-11 flex-1 md:flex-none"
          onClick={onNext}
        >
          Next
        </Button>
      </div>
      {brief ? (
        <BriefSheet open={sheet} onOpenChange={setSheet} anchor={anchor}>
          {brief}
        </BriefSheet>
      ) : null}
    </>
  )
}
