"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { CircleCheckBigIcon, TrophyIcon } from "lucide-react"

import { startSession } from "@/app/actions/sessions"
import { Button } from "@/components/ui/button"
import type { CourseCompleteUnitView } from "@/lib/dal/player"

import { PendingSubmit } from "../pending-submit"
import { Celebration } from "./celebration"
import { usePlayer } from "./runtime"

/**
 * Session complete (WF-E8): a celebration with the summary line (§7.7),
 * **Keep going** when a new session would hold work, and **Back to Today**.
 */
export function SessionComplete({
  line,
  keepGoing,
}: {
  line: string
  keepGoing: { courseId: string | null } | null
}) {
  const router = useRouter()
  return (
    <Celebration
      icon={CircleCheckBigIcon}
      heading="Session complete"
      line={line}
    >
      <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
        {keepGoing ? (
          <form
            action={startSession.bind(
              null,
              keepGoing.courseId
                ? { kind: "standard", courseId: keepGoing.courseId }
                : { kind: "standard" }
            )}
          >
            <PendingSubmit size="lg" className="min-h-11 w-full md:w-auto">
              Keep going
            </PendingSubmit>
          </form>
        ) : null}
        <Button
          size="lg"
          variant={keepGoing ? "outline" : "default"}
          className="min-h-11"
          onClick={() => router.replace("/")}
        >
          Back to Today
        </Button>
      </div>
    </Celebration>
  )
}

/**
 * Course complete (WF-G3): the course's shape, then each key question with
 * its number of notes; it ends on the learner's questions, not a score.
 * **Continue** goes to the session summary.
 */
export function CourseComplete({
  line,
  keyQuestions,
}: Pick<CourseCompleteUnitView, "line" | "keyQuestions">) {
  const player = usePlayer()
  const [pending, startTransition] = useTransition()
  const session = { unit: "end", screen: "course-complete" } as const
  return (
    <Celebration icon={TrophyIcon} heading="Course complete" line={line}>
      <ul className="flex w-full max-w-md flex-col divide-y rounded-lg border text-left">
        {keyQuestions.map((q) => (
          <li key={q.id} className="flex items-start gap-3 p-3 text-sm">
            <span className="font-medium text-muted-foreground">
              {q.id.toUpperCase()}
            </span>
            <span className="flex-1">{q.text}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {q.notes}
            </span>
          </li>
        ))}
      </ul>
      <Button
        size="lg"
        className="min-h-11 w-full md:w-auto"
        disabled={pending || player.busy}
        onClick={() =>
          startTransition(async () => {
            await player.finish({ kind: "continue" }, { session, lesson: null })
          })
        }
      >
        Continue
      </Button>
    </Celebration>
  )
}
