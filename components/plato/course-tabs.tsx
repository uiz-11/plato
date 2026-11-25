"use client"

import Link from "next/link"
import { useSelectedLayoutSegment } from "next/navigation"

import { cn } from "@/lib/utils"

export const COURSE_TABS = [
  { segment: "syllabus", label: "Syllabus" },
  { segment: "answers", label: "Answers" },
  { segment: "sources", label: "Sources" },
] as const

/**
 * The course page tabs (§8.1, WF-C): a `<nav>` of links styled as tabs, each
 * its own URL, with `aria-current="page"` on the active one. Links rather
 * than an ARIA tablist, because each tab is a page.
 */
export function CourseTabs({ courseId }: { courseId: string }) {
  const segment = useSelectedLayoutSegment()
  return (
    <nav aria-label="Course" data-slot="course-tabs" className="border-b">
      <ul className="-mb-px flex gap-2">
        {COURSE_TABS.map((tab) => {
          const current = segment === tab.segment
          return (
            <li key={tab.segment}>
              <Link
                href={`/courses/${courseId}/${tab.segment}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-t-md border-b-2 px-3 text-sm font-medium focus-ring transition-colors md:min-h-9",
                  current
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
