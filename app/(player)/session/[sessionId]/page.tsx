import "katex/dist/katex.min.css"

import type { Metadata } from "next"

import { Brief, renderContent } from "@/components/plato/content"
import { BeyondLesson, LessonBrief } from "@/components/plato/lesson-brief"
import { CheckpointUnit } from "@/components/plato/player/checkpoint-unit"
import {
  CourseComplete,
  SessionComplete,
} from "@/components/plato/player/end-screens"
import type {
  ExerciseItem,
  ExerciseNodes,
} from "@/components/plato/player/exercise"
import {
  GuessUnit,
  ReadUnit,
  WarmupUnit,
} from "@/components/plato/player/lesson-steps"
import { BRIEF_SHEET_PREFIX } from "@/components/plato/player/logic"
import { PlayerFrame } from "@/components/plato/player/player-frame"
import { RecallExercises } from "@/components/plato/player/recall-exercises"
import { RecallUnit } from "@/components/plato/player/recall-unit"
import {
  ReviewBlock,
  type ReviewItem,
} from "@/components/plato/player/review-block"
import {
  ArrivalFocus,
  PlayerRuntimeProvider,
  UnitBoundary,
} from "@/components/plato/player/runtime"
import { StepsRow } from "@/components/plato/player/steps-row"
import {
  getPlayerUnit,
  type BriefView,
  type ExerciseItemView,
  type PlayerView,
} from "@/lib/dal/player"
import type { RenderedOptions } from "@/lib/content/render"

export const metadata: Metadata = { title: "Session" }

/**
 * The player (§8.4, WF-D to WF-G). The server owns the position: this page
 * renders the session's current unit with all its items, and the client
 * steps through it, recording each event in the background.
 */
export default async function SessionPage(
  props: PageProps<"/session/[sessionId]">
) {
  const { sessionId } = await props.params
  const view = await getPlayerUnit(sessionId)
  const { frame } = view
  return (
    // Keyed by the session: the outbox and the clock belong to one session.
    <PlayerRuntimeProvider
      key={view.sessionId}
      sessionId={view.sessionId}
      activeMs={view.activeMs}
    >
      <PlayerFrame
        kind={view.kind}
        activeMs={view.activeMs}
        minutes={view.minutes}
        hideTimer={view.hideTimer}
        title={frame.title}
        subtitle={frame.subtitle}
        tag={frame.tag}
        timer={frame.timer}
        progress={frame.steps ? <StepsRow {...frame.steps} /> : undefined}
        skip={frame.skip && { ...frame.skip, expected: view.expected }}
      >
        <UnitBoundary>
          {/* Keyed by the position too, so a refresh that finds the server
              elsewhere in the same unit (another tab) starts it afresh. */}
          <Unit
            key={`${view.unitKey}|${JSON.stringify(view.expected)}`}
            view={view}
          />
          <ArrivalFocus
            key={`focus|${view.unitKey}|${JSON.stringify(view.expected)}`}
          />
        </UnitBoundary>
      </PlayerFrame>
    </PlayerRuntimeProvider>
  )
}

function Unit({ view }: { view: PlayerView }) {
  const { unit } = view
  switch (unit.kind) {
    case "reviews": {
      const items = unit.items.map((item): ReviewItem => {
        const ctx = { courseId: item.courseId, surface: "player" as const }
        return item.version.kind === "prompt"
          ? {
              kind: "prompt",
              courseTitle: item.courseTitle,
              courseId: item.courseId,
              conceptId: item.conceptId,
              prompt: renderContent(item.version.prompt, ctx),
              answer: renderContent(item.version.answer, ctx),
            }
          : {
              kind: "exercise",
              courseId: item.courseId,
              courseTitle: item.courseTitle,
              conceptId: item.conceptId,
              ...exerciseItem(item.courseId, item.version),
            }
      })
      return (
        <ReviewBlock
          items={items}
          index={unit.index}
          answered={unit.answered}
          briefs={briefNodes(unit.briefs)}
        />
      )
    }
    case "warmup": {
      const ctx = { courseId: unit.courseId, surface: "player" as const }
      return (
        <WarmupUnit
          lessonId={unit.lessonId}
          pickingUp={unit.pickingUp}
          sourceNumber={unit.sourceNumber}
          prompts={unit.prompts.map((p) => ({
            prompt: renderContent(p.prompt, ctx),
            answer: renderContent(p.answer, ctx),
          }))}
          index={unit.index}
        />
      )
    }
    case "guess": {
      const ctx = { courseId: unit.courseId, surface: "player" as const }
      return (
        <GuessUnit
          lessonId={unit.lessonId}
          pickingUp={unit.pickingUp}
          guesses={unit.guesses.map((g) => ({
            id: g.id,
            prompt: renderContent(g.prompt, ctx),
            options: g.options.map((o) => ({
              id: o.id,
              text: renderContent(o.text, ctx),
            })),
          }))}
          index={unit.index}
        />
      )
    }
    case "read":
      return (
        <ReadUnit
          lessonId={unit.lessonId}
          pickingUp={unit.pickingUp}
          readMinutes={unit.readMinutes}
        >
          <LessonBrief brief={unit.brief} />
          <BeyondLesson beyond={unit.beyond} courseId={unit.courseId} />
        </ReadUnit>
      )
    case "recall-exercises":
      return (
        <RecallExercises
          lessonId={unit.lessonId}
          pickingUp={unit.pickingUp}
          stage={unit.stage}
          lessonLabel={unit.lessonLabel}
          boards={unit.boards}
          boardIndex={unit.boardIndex}
          complete={unit.complete}
          items={unit.items.map((item) => exerciseItem(unit.courseId, item))}
          index={unit.index}
          answered={unit.answered}
          briefs={briefNodes(unit.briefs)}
          drafts={unit.drafts}
        />
      )
    case "recall-write-tick":
      return (
        <RecallUnit
          lessonId={unit.lessonId}
          phase={unit.phase}
          pickingUp={unit.pickingUp}
          draftKey={unit.draftKey}
          draft={unit.draft}
          written={unit.written}
          concepts={unit.concepts}
          exercises={unit.exercises}
        />
      )
    case "summary":
      return <SessionComplete line={unit.line} keepGoing={unit.keepGoing} />
    case "checkpoint":
      return (
        <CheckpointUnit
          moduleId={unit.moduleId}
          lessons={unit.lessons}
          total={unit.total}
          items={unit.items.map((item) => exerciseItem(unit.courseId, item))}
          index={unit.index}
          answered={unit.answered}
          briefs={briefNodes(unit.briefs)}
          drafts={unit.drafts}
          mastery={unit.mastery}
          kind={view.kind}
          minutes={view.minutes}
        />
      )
    case "course-complete":
      return (
        <CourseComplete line={unit.line} keyQuestions={unit.keyQuestions} />
      )
  }
}

/** An exercise's rendered fields as nodes, with its answer key (§8.4). */
function exerciseItem(courseId: string, view: ExerciseItemView): ExerciseItem {
  const ctx = { courseId, surface: "player" as const }
  const r = view.rendered
  const options = (o: RenderedOptions | undefined) =>
    o
      ? Object.fromEntries(
          Object.entries(o).map(([id, tree]) => [id, renderContent(tree, ctx)])
        )
      : undefined
  const nodes: ExerciseNodes = {
    prompt: renderContent(r.prompt, ctx),
    explanation: renderContent(r.explanation, ctx),
    scenario: r.scenario ? renderContent(r.scenario, ctx) : undefined,
    options: options(r.options),
    sentences: options(r.sentences),
    fixes: options(r.fixes),
  }
  return {
    exercise: view.exercise,
    nodes,
    briefKey: view.briefKey,
    draftKey: view.draftKey,
  }
}

/** Each brief a unit points to, rendered once for `BriefSheet` (§8.4). */
function briefNodes(
  briefs: Record<string, BriefView>
): Record<string, React.ReactNode> {
  return Object.fromEntries(
    Object.entries(briefs).map(([key, b]) => [
      key,
      <Brief
        key={key}
        ctx={{
          courseId: b.courseId,
          surface: "player",
          lesson: b.lesson,
          guessPicks: b.guessPicks,
          idPrefix: BRIEF_SHEET_PREFIX,
        }}
      />,
    ])
  )
}
