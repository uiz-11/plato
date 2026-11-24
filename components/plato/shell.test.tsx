import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { SidebarProvider } from "@/components/ui/sidebar"
import { CHECKPOINT_STATUS_DOT, LESSON_STATUS_DOT } from "@/lib/engine/labels"

import { CourseCard } from "./course-card"
import { CourseRow } from "./course-row"
import { EmptyIllustration } from "./empty-illustration"
import { MasteryMeter } from "./mastery-meter"
import { RequestTile } from "./request-tile"
import { AppSidebar, isActive, PhoneHeader, PhoneTabs } from "./shell-nav"
import { StatusDot } from "./status-dot"
import { StickyNote } from "./sticky-note"

const pathname = vi.hoisted(() => ({ current: "/" }))
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }))

const html = (node: React.ReactNode) => renderToStaticMarkup(node)

describe("isActive", () => {
  it.each([
    ["/", "/", true],
    ["/library", "/", false],
    ["/library", "/library", true],
    ["/courses/mrna/syllabus", "/library", true],
    ["/", "/library", false],
    ["/new", "/new", true],
    ["/newer", "/new", false],
  ])("%s, %s → %s", (path, href, want) => {
    expect(isActive(path, href)).toBe(want)
  })
})

describe("shell nav", () => {
  it("marks the current page in the sidebar", () => {
    pathname.current = "/library"
    const out = html(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    )
    expect(out).toContain('aria-label="Main"')
    expect(out.match(/aria-current="page"/g)).toHaveLength(1)
    expect(out).toMatch(
      /href="\/library"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/library"/
    )
    // Today and Library are in the nav; New request is an action after it.
    const nav = out.slice(out.indexOf("<nav"), out.indexOf("</nav>"))
    expect(nav).toContain(">Today<")
    expect(nav).toContain(">Library<")
    expect(nav).not.toContain("New request")
    expect(out).toMatch(/href="\/new"[^>]*>.*New request/)
  })

  it("has two phone tabs and a + for New request", () => {
    pathname.current = "/"
    const tabs = html(<PhoneTabs />)
    expect(tabs.match(/<a /g)).toHaveLength(2)
    expect(tabs).toContain("Today")
    expect(tabs).toContain("Library")
    expect(tabs).not.toContain("New request")
    const header = html(<PhoneHeader />)
    expect(header).toContain('aria-label="New request"')
    expect(header).toContain('href="/new"')
  })
})

describe("StatusDot", () => {
  it("draws a distinct shape for every lesson and checkpoint status", () => {
    const shapes = new Set([
      ...Object.values(LESSON_STATUS_DOT),
      ...Object.values(CHECKPOINT_STATUS_DOT),
    ])
    expect(shapes).toEqual(
      new Set(["full", "half", "empty", "dashed", "square"])
    )
  })

  it("keeps the status text beside a decorative dot", () => {
    const out = html(
      <StatusDot shape="half">In progress · at Recall</StatusDot>
    )
    expect(out).toContain('aria-hidden="true"')
    expect(out).toContain('data-shape="half"')
    expect(out).toContain("In progress · at Recall")
  })
})

describe("MasteryMeter", () => {
  it.each([
    ["not_yet_reviewed", 0, "Not yet reviewed"],
    ["shaky", 1, "Shaky"],
    ["good", 3, "Good"],
    ["strong", 4, "Strong"],
  ] as const)("%s", (mastery, filled, word) => {
    const out = html(<MasteryMeter mastery={mastery} />)
    expect(out).toContain(`data-filled="${filled}"`)
    expect(out).toContain(`>${word}<`)
  })
})

describe("course and request shapes", () => {
  it("links course rows and cards to the course page", () => {
    const row = html(
      <CourseRow courseId="mrna" title="mRNA" meta="2 of 12 completed" />
    )
    expect(row).toContain('href="/courses/mrna"')
    const card = html(
      <CourseCard
        courseId="mrna"
        title="mRNA"
        coverLabel="mRNA"
        meta="2 of 12 completed"
      />
    )
    expect(card).toContain('href="/courses/mrna"')
    expect(card).toContain("2 of 12 completed")
    expect(card).not.toContain("progressbar")
  })

  it("draws a decorative progress bar when given progress", () => {
    const row = html(
      <CourseRow
        courseId="mrna"
        title="mRNA"
        meta="2 of 12 completed"
        progress={{ completed: 2, total: 12 }}
      />
    )
    expect(row).toMatch(/aria-hidden="true" data-slot="course-progress"/)
    expect(row).toContain('aria-valuenow="17"')
  })

  it("renders requests as dashed tiles with nothing to open", () => {
    const requested = html(<RequestTile title="Climate tipping points" />)
    expect(requested).toContain("border-dashed")
    expect(requested).not.toContain("<a ")
    expect(requested).not.toContain("<button")
    expect(requested).toContain(">requested<")
    const notBuilt = html(
      <RequestTile
        title="Fix my Wi-Fi"
        reason="A support request, not a topic to learn"
      />
    )
    expect(notBuilt).toContain(">not built<")
    expect(notBuilt).toContain("A support request, not a topic to learn")
  })
})

describe("StickyNote and EmptyIllustration", () => {
  it("labels a note with its lesson and can render as a button", () => {
    expect(
      html(<StickyNote label="Lesson 3">No, it can&apos;t.</StickyNote>)
    ).toMatch(/^<div[^>]*>.*No, it can.*Lesson 3/)
    const add = html(<StickyNote variant="add">+ Add note</StickyNote>)
    expect(add).toContain("border-dashed")
    expect(add).toContain("+ Add note")
    expect(
      html(
        <StickyNote label="Lesson 3" render={<button type="button" />}>
          x
        </StickyNote>
      )
    ).toMatch(/^<button type="button"/)
  })

  it("hides the illustration from assistive tech", async () => {
    const { SparklesIcon } = await import("lucide-react")
    expect(html(<EmptyIllustration icon={SparklesIcon} />)).toMatch(
      /^<span aria-hidden="true"/
    )
  })
})
