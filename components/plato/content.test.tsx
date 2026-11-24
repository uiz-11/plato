import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { listCourses } from "@/lib/content/load"
import {
  renderBrief,
  renderInline,
  renderLesson,
  type RenderContext,
  type RenderedLesson,
} from "@/lib/content/render"
import { makeLesson } from "@/test/content"

import { Brief, contentId, renderContent, type ContentContext } from "./content"

// A snapshot per directive (§10, T06): HAST from the renderer through the
// component map to markup.

let assetsDir: string
beforeAll(() => {
  assetsDir = mkdtempSync(join(tmpdir(), "plato-assets-"))
  writeFileSync(
    join(assetsDir, "grad.svg"),
    `<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>`
  )
  writeFileSync(
    join(assetsDir, "box.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="currentColor"/></svg>`
  )
})
afterAll(() => rmSync(assetsDir, { recursive: true, force: true }))

const lesson = makeLesson("one", {
  guesses: [
    {
      id: "g1",
      prompt: "Which is *faster*?",
      options: [
        { id: "g1-a", text: "Symmetric" },
        { id: "g1-b", text: "Public-key" },
        { id: "g1-c", text: "Neither" },
      ],
      correct: "g1-a",
      why: "One key, simple maths. :cite[src-a]",
    },
    ...makeLesson("one").guesses,
  ],
  misconceptions: [
    {
      id: "m1",
      belief: "a secret algorithm is safer.",
      correction: "Open designs get *more* scrutiny.",
    },
  ],
})

const renderCtx = (): RenderContext => ({
  sourceNumbers: new Map([
    ["src-a", 1],
    ["src-b", 2],
  ]),
  lesson,
  assetsDir,
})

/** A rendered lesson whose brief is `md`, with the guesses and misconceptions above. */
function rendered(md: string): RenderedLesson {
  const c = renderCtx()
  const inline = (s: string) => renderInline(s, c)
  return {
    courseId: "c",
    lessonId: "one",
    brief: renderBrief(md, c),
    whyThisMatters: inline("It matters."),
    concepts: {},
    guesses: Object.fromEntries(
      lesson.guesses.map((g) => [
        g.id,
        {
          prompt: inline(g.prompt),
          options: Object.fromEntries(
            g.options.map((o) => [o.id, inline(o.text)])
          ),
          correct: g.correct,
          why: inline(g.why),
        },
      ])
    ),
    misconceptions: Object.fromEntries(
      lesson.misconceptions.map((m) => [
        m.id,
        { belief: inline(m.belief), correction: inline(m.correction) },
      ])
    ),
    simplified: {},
    exercises: {},
  }
}

const markup = (md: string, ctx: Partial<ContentContext> = {}) => {
  const r = rendered(md)
  return renderToStaticMarkup(
    renderContent(r.brief, {
      courseId: "c",
      surface: "course",
      lesson: r,
      ...ctx,
    })
  )
}

describe("directive snapshots", () => {
  it.each([
    [":cite on the course page", "A claim. :cite[src-b,src-a]", {}],
    [
      ":cite in the player",
      "A claim. :cite[src-a]",
      { surface: "player" as const },
    ],
    [":uncertain", "Protection :uncertain[seems to last years].", {}],
    [":general", ":general[Cells copy DNA before dividing.]", {}],
    [
      ":contested",
      ":contested[How fast approval should have been is debated.]",
      {},
    ],
    ["::anchor", "::anchor{#a-top}", {}],
    ["::guess without a pick", "::guess{#g1}", {}],
    [
      "::guess with a wrong pick",
      "::guess{#g1}",
      { guessPicks: { g1: "g1-b" } },
    ],
    [
      "::guess with the right pick",
      "::guess{#g1}",
      { guessPicks: { g1: "g1-a" } },
    ],
    ["::misconception", "::misconception{#m1}", {}],
    [
      ":::analogy",
      ":::analogy{#padlock}\nThink of a *padlocked* box.\n\nAnyone sees only the lock.\n:::",
      {},
    ],
    [
      "::figure",
      '::figure{src="box.svg" alt="A filled square." caption="One square."}',
      {},
    ],
    ["fenced code", "```python\nprint(1 < 2)\n```", {}],
    ["a table", "| Key | Keys |\n|---|---|\n| 10 bits | $2^{10}$ |", {}],
    ["an external link", "See [the paper](https://example.org/p).", {}],
  ])("%s", (_name, md, ctx) => {
    expect(markup(md, ctx)).toMatchSnapshot()
  })

  it("math", () => {
    const out = markup(
      "Inline $m \\oplus k$.\n\n$$\n(m \\oplus k) \\oplus k = m\n$$"
    )
    expect(out).toContain('<span class="katex">')
    expect(out).toContain('<span class="katex-display">')
    expect(out).toMatchSnapshot()
  })

  it("a fill-in blank", () => {
    const prompt = renderInline("The key is ___.", renderCtx(), { blank: true })
    expect(
      renderToStaticMarkup(
        renderContent(prompt, { courseId: "c", surface: "player" })
      )
    ).toMatchSnapshot()
  })

  it("key question chips after Why this matters", () => {
    const tree = renderInline("It matters.", renderCtx())
    tree.children.push({
      type: "element",
      tagName: "plato-question",
      properties: { dataId: "q2" },
      children: [],
    })
    expect(
      renderToStaticMarkup(
        renderContent(tree, { courseId: "c", surface: "course" })
      )
    ).toBe('It matters.<span class="text-muted-foreground">(Q2)</span>')
  })

  it("components can be replaced per call, e.g. the blank in the player", () => {
    const prompt = renderInline("The key is ___.", renderCtx(), { blank: true })
    expect(
      renderToStaticMarkup(
        renderContent(prompt, {
          courseId: "c",
          surface: "player",
          components: { "plato-blank": () => <input aria-label="Answer" /> },
        })
      )
    ).toBe('The key is <input aria-label="Answer"/>.')
  })
})

describe("rendering details", () => {
  it("gives figure ids a suffix per render, so a brief shown twice keeps them unique", () => {
    const r = rendered('::figure{src="grad.svg" alt="G."}')
    const ctx = { courseId: "c", surface: "course" as const, lesson: r }
    const out = renderToStaticMarkup(
      <>
        <Brief ctx={ctx} />
        <Brief ctx={ctx} />
      </>
    )
    const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(out).toContain(`fill="url(#${id})"`)
  })

  it("prefixes anchor and analogy ids and in-page links with idPrefix", () => {
    const md =
      "::anchor{#a-top}\n\n:::analogy{#box}\nX.\n:::\n\nSee [up](#a-top)."
    const plain = markup(md)
    expect(plain).toContain('id="a-top"')
    expect(plain).toContain('href="#a-top"')
    const sheet = markup(md, { idPrefix: "sheet" })
    expect(sheet).toContain('id="sheet-a-top"')
    expect(sheet).toContain('id="sheet-box"')
    expect(sheet).toContain('href="#sheet-a-top"')
    expect(contentId({ idPrefix: "sheet" }, "a-top")).toBe("sheet-a-top")
    expect(contentId({}, "a-top")).toBe("a-top")
  })

  it("a replaced figure component still receives the SVG as children", () => {
    const out = markup('::figure{src="box.svg" alt="A box."}', {
      components: {
        "plato-figure": (p) => <div className="zoom">{p.children}</div>,
      },
    })
    expect(out).toMatch(/^<div class="zoom"><svg [^>]*aria-label="A box."/)
  })

  it("opens only external links in a new tab, in the player too", () => {
    const out = markup("[up](#a-top) and [out](https://example.org)", {
      surface: "player",
    })
    expect(out).toMatch(/<a href="#a-top" class="[^"]*">up<\/a>/)
    expect(out).toMatch(/<a href="https:\/\/example.org"[^>]*target="_blank"/)
  })

  it("renders a source cited twice without duplicate keys", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(markup("x :cite[src-a,src-a]").match(/Source 1/g)).toHaveLength(2)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe("fixture courses", () => {
  const root = join(process.cwd(), "e2e/fixtures/content")

  it("every fixture brief renders on the course page and in the player", () => {
    for (const course of listCourses({ root, includeDrafts: true }))
      for (const { lesson: l } of course.lessons) {
        const r = renderLesson(course, l.id)
        for (const surface of ["course", "player"] as const) {
          const out = renderToStaticMarkup(
            <Brief ctx={{ courseId: course.id, surface, lesson: r }} />
          )
          expect(out, `${course.id}/${l.id}`).toMatch(/^<div[^>]*><h1 /)
          expect(out).not.toContain("<plato-")
          expect(out).not.toContain("katex-error")
          expect(out).toContain(`href="/courses/${course.id}/sources#s`)
          for (const id of l.guesses.map((g) => g.id))
            if (
              r.brief.children.some(
                (n) => n.type === "element" && n.properties.dataId === id
              )
            )
              expect(out).toContain('aria-label="Your guess"')
        }
      }
  })

  it("the figure is inlined with its alt text as the accessible name", () => {
    const course = listCourses({ root, includeDrafts: true }).find(
      (c) => c.id === "how-encryption-works"
    )!
    const r = renderLesson(course, "key-exchange")
    const out = renderToStaticMarkup(
      <Brief ctx={{ courseId: course.id, surface: "course", lesson: r }} />
    )
    expect(out).toMatch(
      /<figure[^>]*><div[^>]*><svg [^>]*role="img" aria-label="Alice and Bob each mix/
    )
    expect(out).toContain("<figcaption")
  })
})
