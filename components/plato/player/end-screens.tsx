"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { CircleCheckBigIcon, ConstructionIcon, TrophyIcon } from "lucide-react"

import { startSession } from "@/app/actions/sessions"
import { Button } from "@/components/ui/button"

import { EmptyIllustration } from "../empty-illustration"
import { PendingSubmit } from "../pending-submit"
import { usePlayer } from "./runtime"

function Screen({
  icon,
  heading,
  children,
}: {
  icon: typeof TrophyIcon
  heading: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <EmptyIllustration icon={icon} />
      <h2 className="text-2xl font-semibold">{heading}</h2>
      {children}
    </div>
  )
}

/**
 * Session complete (WF-E8), plain for now: the summary line, **Keep going**
 * when a new session would hold work, and **Back to Today**.
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
    <Screen icon={CircleCheckBigIcon} heading="Session complete">
      <p className="max-w-md text-sm">{line}</p>
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
    </Screen>
  )
}

/** Course complete (WF-G3), plain until T18: the title and **Continue**. */
export function CourseComplete({ courseTitle }: { courseTitle: string }) {
  const player = usePlayer()
  const [pending, startTransition] = useTransition()
  return (
    <Screen icon={TrophyIcon} heading={`${courseTitle} complete`}>
      <Button
        size="lg"
        className="min-h-11"
        disabled={pending}
        onClick={() =>
          startTransition(() =>
            player.finish(
              { kind: "continue" },
              {
                session: { unit: "end", screen: "course-complete" },
                lesson: null,
              }
            )
          )
        }
      >
        Continue
      </Button>
    </Screen>
  )
}

/** A unit whose screens are not built yet (T16–T18). */
export function PendingUnit() {
  return (
    <Screen icon={ConstructionIcon} heading="Not available yet">
      <p className="max-w-md text-sm text-muted-foreground">
        This part of a session isn&apos;t built yet. Your progress is saved: use
        × to end the session.
      </p>
    </Screen>
  )
}
