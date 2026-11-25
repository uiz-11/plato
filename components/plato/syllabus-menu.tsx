"use client"

import { useState, useTransition } from "react"
import { unstable_rethrow } from "next/navigation"
import { EllipsisIcon } from "lucide-react"
import { toast } from "sonner"

import { skipLesson, unskipLesson } from "@/app/actions/lessons"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { lessonSkippedToast } from "@/lib/engine/labels"

/**
 * A Syllabus row's ⋯ menu (§9.4, WF-C1.4): *Mark as skipped* on a lesson that
 * is not *Completed* or *Skipped*, with an Undo toast, and *Unskip* on a
 * *Skipped* one. Undo and *Unskip* do the same thing (§7.3, R15).
 */
export function SyllabusMenu({
  courseId,
  lessonId,
  number,
  title,
  offer,
}: {
  courseId: string
  lessonId: string
  /** "Lesson 3", for the menu's name and the toast. */
  number: number
  title: string
  offer: "skip" | "unskip"
}) {
  const [pending, startTransition] = useTransition()
  // The item shown is fixed when the menu opens. The action's refresh changes
  // `offer` while the menu is still fading out, which would flash the other
  // item.
  const [shown, setShown] = useState(offer)
  const ref = { courseId, lessonId }

  function run(action: () => Promise<void>, failed: string, done?: () => void) {
    startTransition(async () => {
      // A rejected transition would replace the page with the error screen.
      try {
        await action()
      } catch (err) {
        // An expired cookie redirects to /unlock: let Next handle it.
        unstable_rethrow(err)
        toast.error(failed)
        return
      }
      done?.()
    })
  }

  const unskip = () =>
    run(() => unskipLesson(ref), "Couldn't unskip the lesson. Try again.")

  const skip = () =>
    run(
      () => skipLesson(ref),
      "Couldn't skip the lesson. Try again.",
      () =>
        toast(lessonSkippedToast(number), {
          // Long enough to reach Undo by keyboard or screen reader.
          duration: 10_000,
          action: { label: "Undo", onClick: unskip },
        })
    )

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setShown(offer)
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            disabled={pending}
            aria-label={`More for Lesson ${number}: ${title}`}
            className="size-11 shrink-0 md:size-8"
          />
        }
      >
        <EllipsisIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {shown === "skip" ? (
          <DropdownMenuItem onClick={skip}>Mark as skipped</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={unskip}>Unskip</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
