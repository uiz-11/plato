"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { EllipsisIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { setHideTimer } from "@/app/actions/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { lessonSkippedToast } from "@/lib/engine/labels"
import { minutesUsedLabel, timerLabel } from "@/lib/engine/player"
import type { SessionKind } from "@/lib/engine/types"

import type { ExpectedPosition } from "@/lib/engine/player"

import { newEventId, usePlayer } from "./runtime"

/** The lesson ⋯ *Mark as skipped* skips, and where the server has it. */
export interface SkipTarget {
  lessonId: string
  number: number
  /** The unit's loaded position, used until the unit reports its own. */
  expected: ExpectedPosition
}

export interface FrameProps {
  kind: SessionKind
  /** The stored `active_ms`: what an ended session used. */
  activeMs: number
  minutes: number
  hideTimer: boolean
  title: string
  subtitle: string | null
  tag: string | null
  timer: "live" | "used" | "none"
  /** The progress row under the top bar, when the frame draws it. */
  progress?: React.ReactNode
  /** *Mark as skipped* in ⋯, while a lesson is the current unit (§9.2). */
  skip?: SkipTarget | null
  children: React.ReactNode
}

/** Re-renders every second while the tab is visible, for the timer. */
function useTick(on: boolean) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setTick((t) => t + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [on])
}

/**
 * The player frame (§9.2, WF-D): × · title (subtitle and tag) · timer · ⋯,
 * then the progress row, the item near the top and its actions at the
 * bottom. The timer pauses while the tab is hidden and is not a live region,
 * so nothing is announced as it changes (WF-J).
 */
export function PlayerFrame({
  kind,
  activeMs,
  minutes,
  hideTimer: initialHide,
  title,
  subtitle,
  tag,
  timer,
  progress,
  skip = null,
  children,
}: FrameProps) {
  const player = usePlayer()
  const [hidden, setHidden] = useState(initialHide)
  const [exiting, startExit] = useTransition()
  const [, startSkip] = useTransition()
  const skipToasts = useRef(new Set<string | number>())
  // The toast's Undo belongs to this session's player: leaving it (Back to
  // Today, a new session) takes the toast away.
  useEffect(
    () => () => {
      for (const id of skipToasts.current) toast.dismiss(id)
    },
    []
  )
  const router = useRouter()
  const ended = timer !== "live"
  useTick(timer === "live" && !hidden)

  const toggleTimer = () => {
    const next = !hidden
    setHidden(next)
    setHideTimer(next).catch(() => {
      // The choice still holds on this screen; it is only not remembered.
    })
  }

  // The player's *Mark as skipped* (§7.7): the session moves on to its next
  // target, and the toast's Undo returns to the lesson where it stopped.
  const skipLesson = (s: SkipTarget) => {
    const reported = player.current()
    const expected =
      reported?.session.unit === "lesson" &&
      reported.session.lessonId === s.lessonId
        ? reported
        : s.expected
    const id = newEventId()
    startSkip(async () => {
      const ok = await player.finish({ kind: "skip-lesson" }, expected, { id })
      if (!ok) return
      const toastId = toast(lessonSkippedToast(s.number), {
        // Long enough to reach Undo by keyboard or screen reader.
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: () => startSkip(() => player.undoSkip(s.lessonId, id)),
        },
        onDismiss: () => skipToasts.current.delete(toastId),
        onAutoClose: () => skipToasts.current.delete(toastId),
      })
      skipToasts.current.add(toastId)
    })
  }

  const time =
    timer === "live"
      ? timerLabel(kind, minutes, player.activeMs())
      : timer === "used"
        ? minutesUsedLabel(activeMs)
        : null

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-2 py-2 md:px-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label={ended ? "Close session" : "Exit session, progress saved"}
          className="size-11 shrink-0 md:size-8"
          disabled={exiting || player.busy}
          onClick={() =>
            // On the end screens the session is already over (§7.7).
            ended ? router.replace("/") : startExit(() => player.exit())
          }
        >
          <XIcon aria-hidden />
        </Button>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="truncate text-sm font-medium">{title}</h1>
          {subtitle ? (
            <span className="hidden truncate text-xs text-muted-foreground md:inline">
              {subtitle}
            </span>
          ) : null}
          {tag ? <Badge variant="outline">{tag}</Badge> : null}
        </div>
        {player.saving ? (
          <span className="text-xs text-muted-foreground">Saving…</span>
        ) : null}
        {time !== null && !hidden ? (
          <span
            data-slot="player-timer"
            className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
          >
            {time}
          </span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="More"
                className="size-11 shrink-0 md:size-8"
              />
            }
          >
            <EllipsisIcon aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={toggleTimer}>
              {hidden ? "Show timer" : "Hide timer"}
            </DropdownMenuItem>
            {skip ? (
              <DropdownMenuItem
                disabled={player.busy}
                onClick={() => skipLesson(skip)}
              >
                Mark as skipped
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-6">
        {progress}
        {children}
      </main>
    </div>
  )
}
