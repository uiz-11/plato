import "katex/dist/katex.min.css"

import type { Metadata } from "next"

import { renderContent } from "@/components/plato/content"
import {
  CourseComplete,
  PendingUnit,
  SessionComplete,
} from "@/components/plato/player/end-screens"
import { PlayerFrame } from "@/components/plato/player/player-frame"
import { RecallUnit } from "@/components/plato/player/recall-unit"
import {
  ReviewBlock,
  type ReviewItem,
} from "@/components/plato/player/review-block"
import {
  PlayerRuntimeProvider,
  UnitBoundary,
} from "@/components/plato/player/runtime"
import { StepsRow } from "@/components/plato/player/steps-row"
import { getPlayerUnit, type PlayerView } from "@/lib/dal/player"

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
      >
        <UnitBoundary>
          {/* Keyed by the position too, so a refresh that finds the server
              elsewhere in the same unit (another tab) starts it afresh. */}
          <Unit
            key={`${view.unitKey}|${JSON.stringify(view.expected)}`}
            view={view}
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
              prompt: renderContent(item.version.prompt, ctx),
              answer: renderContent(item.version.answer, ctx),
            }
          : { kind: "exercise", courseTitle: item.courseTitle }
      })
      return (
        <ReviewBlock
          items={items}
          index={unit.index}
          answered={unit.answered}
        />
      )
    }
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
    case "course-complete":
      return <CourseComplete courseTitle={unit.courseTitle} />
    case "pending":
      return <PendingUnit />
  }
}
