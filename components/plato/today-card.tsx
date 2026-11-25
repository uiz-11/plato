import Link from "next/link"
import { CoffeeIcon, PlayIcon, SparklesIcon } from "lucide-react"

import { startSession } from "@/app/actions/sessions"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import type { TodayAction, TodayCard as Card_ } from "@/lib/engine/today"
import type { SessionMinutes } from "@/lib/engine/types"
import { cn } from "@/lib/utils"

import { EmptyIllustration } from "./empty-illustration"
import { PendingSubmit } from "./pending-submit"
import { SessionLengthMenu } from "./session-length-menu"

/** The card's heading and the line under it, per state (WF-A2). */
function cardText(card: Card_): { title: string; line?: string } {
  switch (card.kind) {
    case "welcome-back":
      return {
        title: "Welcome back",
        line: card.text.replace(/^Welcome back\.\s*/, ""),
      }
    case "session":
      return { title: "Your session", line: card.line }
    case "next":
      return { title: "Your session", line: card.text }
    case "reviews-due":
      return { title: card.text }
    case "ready":
      return { title: card.text, line: card.meta }
    case "first-run":
      return {
        title: card.text,
        line: "Describe it and Plato builds a course. This takes a while.",
      }
    case "caught-up": {
      const line = card.text.replace(/^All caught up\.\s*/, "")
      return { title: "All caught up", line: line || undefined }
    }
  }
}

/** Opens the player with a new session (§8.3 `startSession`). */
function StartButton({
  kind,
  courseId,
  variant = "default",
  primary = true,
  children,
}: {
  kind: "standard" | "reviews_only" | "full_lesson"
  courseId?: string
  variant?: "default" | "outline"
  primary?: boolean
  children: React.ReactNode
}) {
  return (
    <form
      action={startSession.bind(null, courseId ? { kind, courseId } : { kind })}
    >
      <PendingSubmit
        variant={variant}
        size={primary ? "lg" : "default"}
        className={cn(
          "min-h-11 w-full md:w-auto",
          primary ? "md:min-h-9" : "md:min-h-8"
        )}
      >
        {primary && <PlayIcon data-icon="inline-start" aria-hidden />}
        {children}
      </PendingSubmit>
    </form>
  )
}

function RequestCourseLink({ primary }: { primary: boolean }) {
  return (
    <Link
      href="/new"
      className={cn(
        buttonVariants({
          variant: primary ? "default" : "outline",
          size: "lg",
        }),
        "min-h-11 focus-visible:ring-ring md:min-h-9"
      )}
    >
      Request course
    </Link>
  )
}

const has = (card: Card_, a: TodayAction) => card.actions.includes(a)

/**
 * Today's session card (§7.8, WF-A1, WF-A2): one clear next step per state.
 * The engine picks the state and its actions; this only draws them.
 */
export function TodayCard({
  card,
  minutes,
}: {
  card: Card_
  minutes: SessionMinutes
}) {
  const { title, line } = cardText(card)
  const empty = card.kind === "first-run" || card.kind === "caught-up"
  const secondary = has(card, "reviews-only") || has(card, "full-lesson")

  return (
    <section aria-labelledby="today-card-title" className="flex flex-col gap-3">
      <Card
        data-slot="today-card"
        data-state={card.kind}
        className={cn(empty && "items-center text-center")}
      >
        {empty && (
          <EmptyIllustration
            icon={card.kind === "first-run" ? SparklesIcon : CoffeeIcon}
          />
        )}
        <CardHeader className={cn("w-full", empty && "justify-items-center")}>
          <h2 id="today-card-title" className="text-base font-medium">
            {title}
          </h2>
          {line && <p className="text-sm text-muted-foreground">{line}</p>}
        </CardHeader>
        <CardContent
          className={cn(
            "flex w-full flex-col gap-2 md:flex-row md:flex-wrap md:items-center",
            empty && "md:justify-center"
          )}
        >
          {has(card, "start-session") && (
            <div className="flex gap-2">
              <div className="flex-1 md:flex-none">
                <StartButton kind="standard">Start session</StartButton>
              </div>
              <SessionLengthMenu minutes={minutes} />
            </div>
          )}
          {has(card, "start-reviews") && (
            <StartButton kind="standard">Start reviews</StartButton>
          )}
          {card.kind === "ready" && has(card, "start-lesson-1") && (
            <StartButton kind="standard" courseId={card.courseId}>
              Start Lesson 1
            </StartButton>
          )}
          {has(card, "request-course") && (
            <RequestCourseLink primary={card.kind === "first-run"} />
          )}
        </CardContent>
      </Card>
      {secondary && (
        <div className="flex gap-2 *:flex-1 md:*:flex-none">
          {card.kind === "session" && has(card, "reviews-only") && (
            <StartButton kind="reviews_only" variant="outline" primary={false}>
              Reviews only · ~{card.reviewsOnlyMinutes} min
            </StartButton>
          )}
          {has(card, "full-lesson") && (
            <StartButton kind="full_lesson" variant="outline" primary={false}>
              Full lesson
            </StartButton>
          )}
        </div>
      )}
    </section>
  )
}
