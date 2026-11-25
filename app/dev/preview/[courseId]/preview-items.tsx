"use client"

import type { ExerciseResponse } from "@/lib/engine/marking"
import type { Exercise } from "@/lib/content/schema"

import {
  ExerciseCard,
  type ExerciseAnswered,
  type ExerciseItem,
} from "@/components/plato/player/exercise"
import { RecallPrompt } from "@/components/plato/player/recall-prompt"
import { PlayerRuntimeProvider } from "@/components/plato/player/runtime"

// The display check's preview (§11.4): the player's own components with
// fixed, fake learner state. Nothing here records anything: the handlers are
// no-ops, and no event is ever sent.

const noop = () => {}

/** The runtime the player components need; this preview never sends to it. */
export function PreviewRuntime({ children }: { children: React.ReactNode }) {
  return (
    <PlayerRuntimeProvider sessionId="display-check-preview" activeMs={0}>
      {children}
    </PlayerRuntimeProvider>
  )
}

/**
 * A fixed wrong answer where one exists, so the feedback shows the pick, the
 * correct option and the explanation open (§9.1). A short answer shows the
 * sample as what was written, with every point ticked.
 */
export function fixedAnswer(exercise: Exercise): ExerciseAnswered {
  const wrong = (ids: string[], correct: string) =>
    ids.find((id) => id !== correct) ?? correct
  let response: ExerciseResponse
  let correct: boolean | null = false
  switch (exercise.type) {
    case "mc":
    case "scenario":
      response = {
        type: exercise.type,
        optionId: wrong(
          exercise.options.map((o) => o.id),
          exercise.correct
        ),
      }
      break
    case "fill":
      response = { type: "fill", text: "a wrong answer" }
      break
    case "spot":
      response = {
        type: "spot",
        sentenceId: wrong(
          exercise.sentences.map((o) => o.id),
          exercise.faulty
        ),
        fixId: wrong(
          exercise.fixes.map((o) => o.id),
          exercise.correctFix
        ),
      }
      break
    case "short":
      response = {
        type: "short",
        text: exercise.sample,
        ticked: exercise.checklist.map((_, i) => i),
      }
      correct = null
      break
  }
  return {
    answer: {
      kind: "exercise",
      response,
      confidence: exercise.type === "short" ? null : "sure",
    },
    marked: {
      correct,
      confidence: exercise.type === "short" ? null : "sure",
      selfMark: exercise.type === "short" ? "full" : null,
      grade: exercise.type === "short" ? "remembered" : "forgot",
    },
  }
}

export function PreviewExercise({ item }: { item: ExerciseItem }) {
  return (
    <ExerciseCard
      item={item}
      answered={fixedAnswer(item.exercise)}
      requeued={false}
      brief={null}
      draftKey={item.draftKey}
      draft={null}
      pending={false}
      onAnswer={noop}
      onNext={noop}
    />
  )
}

export function PreviewRecall({
  prompt,
  answer,
}: {
  prompt: React.ReactNode
  answer: React.ReactNode
}) {
  return (
    <RecallPrompt
      prompt={prompt}
      answer={answer}
      mode="rate"
      rated="remembered"
      onNext={noop}
    />
  )
}
