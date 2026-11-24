import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Root } from "hast"
import { toHtml } from "hast-util-to-html"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { createTestContent, makeCourse, makeLesson } from "@/test/content"

import {
  clearContentCache,
  ContentError,
  listCourses,
  loadCourseDir,
} from "./load"
import {
  checkBrief,
  checkInline,
  getRenderedCourse,
  getRenderedLesson,
  renderBrief,
  renderInline,
  renderLesson,
  type RenderContext,
} from "./render"
import { sanitizeSvg } from "./svg"

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="100" height="100" aria-labelledby="t"><title id="t">Box</title><rect width="10" height="10" fill="currentColor"/></svg>`

let assetsDir: string
beforeAll(() => {
  assetsDir = mkdtempSync(join(tmpdir(), "plato-assets-"))
  writeFileSync(join(assetsDir, "box.svg"), SVG)
})
afterAll(() => rmSync(assetsDir, { recursive: true, force: true }))
afterEach(() => {
  clearContentCache()
  vi.unstubAllEnvs()
})

const lesson = makeLesson("one", {
  misconceptions: [{ id: "m-one", belief: "It is.", correction: "It is not." }],
})
const ctx = (): RenderContext => ({
  sourceNumbers: new Map([
    ["src-a", 1],
    ["src-b", 2],
  ]),
  lesson,
  assetsDir,
})

const html = (tree: Root) => toHtml(tree)
const brief = (md: string) => html(renderBrief(md, ctx()))
const inline = (md: string, opts?: { blank?: boolean }) =>
  html(renderInline(md, ctx(), opts))
const messages = (md: string) => checkBrief(md, ctx()).map((i) => i.message)

describe("renderBrief: directives", () => {
  it(":cite resolves source ids to citation numbers in written order", () => {
    expect(brief("A claim. :cite[src-b,src-a]")).toBe(
      '<p>A claim. <plato-cite data-sources="src-b src-a" data-numbers="2 1"></plato-cite></p>'
    )
  })

  it("content labels wrap their claim", () => {
    expect(brief(":uncertain[It *may* last.] :general[x] :contested[y]")).toBe(
      '<p><plato-label data-kind="uncertain">It <em>may</em> last.</plato-label> <plato-label data-kind="general">x</plato-label> <plato-label data-kind="contested">y</plato-label></p>'
    )
  })

  it("anchors, guesses and misconceptions become empty elements with their id", () => {
    expect(
      brief("::anchor{#a-top}\n\n::guess{#one-g1}\n\n::misconception{#m-one}")
    ).toBe(
      '<plato-anchor id="a-top"></plato-anchor>\n<plato-guess data-id="one-g1"></plato-guess>\n<plato-misconception data-id="m-one"></plato-misconception>'
    )
  })

  it("an analogy wraps its block content", () => {
    expect(brief(":::analogy{#padlock}\nLike a *box*.\n:::")).toBe(
      '<plato-analogy id="padlock"><p>Like a <em>box</em>.</p></plato-analogy>'
    )
  })

  it("a figure inlines the sanitized SVG", () => {
    expect(
      brief('::figure{src="box.svg" alt="A box." caption="One box."}')
    ).toBe(
      '<plato-figure data-src="box.svg" data-alt="A box." data-caption="One box."><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img" aria-label="A box." focusable="false"><title id="fig-box-1-t">Box</title><rect width="10" height="10" fill="currentColor"></rect></svg></plato-figure>'
    )
  })

  it("puts bare text directives such as times and ratios back as text", () => {
    expect(brief("At 12:30 the ratio was 3:1, a:b and Note:this.")).toBe(
      "<p>At 12:30 the ratio was 3:1, a:b and Note:this.</p>"
    )
  })
})

describe("renderBrief: Markdown", () => {
  it("renders math with KaTeX, as MathML and HTML", () => {
    const out = brief("Inline $x^2$.\n\n$$\na \\oplus b\n$$")
    expect(out).toContain('<span class="katex">')
    expect(out).toContain('<span class="katex-display">')
    expect(out).toContain("<math")
    expect(out).not.toContain("katex-error")
  })

  it("renders fenced code as a plain <pre><code>", () => {
    expect(brief("```python\nx = 1 < 2\n```")).toBe(
      '<pre><code class="language-python">x = 1 &#x3C; 2\n</code></pre>'
    )
  })

  it("renders GFM tables", () => {
    expect(brief("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("<table>")
  })

  it("keeps a literal \\$", () => {
    expect(brief("It costs \\$5 and \\$6.")).toBe("<p>It costs $5 and $6.</p>")
  })
})

describe("checkBrief: what a brief may not hold", () => {
  it.each([
    ["::shout{#x}", "line 1: unknown directive ::shout"],
    [":::aside\nx\n:::", "line 1: unknown directive :::aside"],
    ["A :foo[bar] b.", "line 1: unknown directive :foo"],
    ["x :cite[src-z]", 'line 1: :cite: unknown source "src-z"'],
    ["x :cite[]", "line 1: :cite needs source ids, as in :cite[src-a,src-b]"],
    ["x :cite[src-a]{.big}", 'line 1: :cite has an unknown attribute "."'],
    [
      "x :uncertain[]",
      "line 1: :uncertain needs the claim it labels, as in :uncertain[…]",
    ],
    ["::anchor", "line 1: ::anchor needs an id, as in ::anchor{#some-id}"],
    [
      "::anchor{#Not_Kebab}",
      "line 1: ::anchor{#Not_Kebab}: the id must be kebab-case",
    ],
    ["::anchor[x]{#a}", "line 1: ::anchor takes no [label]"],
    [
      "::guess{#nope}",
      'line 1: ::guess{#nope}: the lesson has no guess "nope"',
    ],
    [
      "::misconception{#nope}",
      'line 1: ::misconception{#nope}: the lesson has no misconception "nope"',
    ],
    [
      '::figure{src="../x.svg" alt="x"}',
      'line 1: ::figure src must be an .svg file name in assets/ (got "../x.svg")',
    ],
    [
      '::figure{src="gone.svg" alt="x"}',
      "line 1: ::figure: assets/gone.svg not found",
    ],
    ['::figure{src="box.svg"}', "line 1: ::figure needs alt text"],
    ["<b>bold</b>", "line 1: raw HTML is not allowed"],
    ["![x](y.png)", "line 1: Markdown images are not allowed; use ::figure"],
    ["x[^1]\n\n[^1]: note", "line 1: footnotes are not allowed"],
    ["#### Deep", "line 1: headings go down to ### (found ####)"],
    [
      "A claim. :cite",
      "line 1: :cite needs source ids, as in :cite[src-a,src-b]",
    ],
    [
      "It may :uncertain last.",
      "line 1: :uncertain needs the claim it labels, as in :uncertain[…]",
    ],
    ["~~old~~ new", "line 1: strikethrough is not allowed"],
    [
      "See :anchor{#a-x} here.",
      "line 1: :anchor must be on its own line, as in ::anchor{#id}",
    ],
    [
      'A :figure{src="x.svg"} here.',
      'line 1: :figure must be on its own line, as in ::figure{src="x.svg" alt="…"}',
    ],
    [
      "An :analogy[like a box]{#x}.",
      "line 1: :analogy is a block: wrap whole paragraphs in :::analogy{#id} … :::",
    ],
    ["- [x] done", "line 1: task list items are not allowed"],
    [
      "See https://example.org now.",
      "line 1: bare URLs are not allowed; write [text](https://example.org) or <https://example.org>",
    ],
    [
      "$\\frac{$",
      "math does not render: Unexpected end of input in a macro argument, expected '}' at end of input: \\frac{",
    ],
  ])("%s", (md, message) => {
    expect(messages(md)).toContain(message)
  })

  it("allows CommonMark links and autolinks", () => {
    expect(messages("[a](https://a.example) and <https://b.example>")).toEqual(
      []
    )
  })

  it("reports the line of each problem", () => {
    expect(messages("# T\n\nok\n\n::nope")).toEqual([
      "line 5: unknown directive ::nope",
    ])
  })

  it("a valid brief has no issues", () => {
    expect(
      messages(
        "# T\n\n## H\n\n::anchor{#a}\n\nText. :cite[src-a]\n\n::guess{#one-g1}\n\n:::analogy{#x}\nY.\n:::\n"
      )
    ).toEqual([])
  })

  it("renderBrief throws a ContentError naming the file", () => {
    expect(() =>
      renderBrief("::nope", ctx(), "courses/c/lessons/l.md")
    ).toThrow(
      new ContentError("courses/c/lessons/l.md", [
        { path: [], message: "line 1: unknown directive ::nope" },
      ])
    )
  })
})

describe("renderInline", () => {
  it("unwraps the paragraph to phrasing content", () => {
    expect(inline("*Why* $x$ :cite[src-a]")).toMatch(
      /^<em>Why<\/em> <span class="katex">.*<\/span> <plato-cite data-sources="src-a" data-numbers="1"><\/plato-cite>$/
    )
  })

  it("keeps soft line breaks of a multi-line value inside one paragraph", () => {
    expect(inline("one\ntwo")).toBe("one\ntwo")
  })

  it.each([
    ["one\n\ntwo", "must be a single paragraph"],
    [
      "- a\n- b",
      "must be inline Markdown, without block elements (found a list)",
    ],
    ["## H", "headings are not allowed here"],
    ["::anchor{#a}", "::anchor can only be used in a brief"],
  ])("rejects block content: %j", (md, message) => {
    expect(checkInline(md, ctx()).map((i) => i.message)).toContain(message)
  })

  it("names the YAML file and field path when it throws", () => {
    expect(() =>
      renderInline("::nope", ctx(), {
        file: "l.yaml",
        path: ["guesses", 0, "why"],
      })
    ).toThrow("l.yaml: guesses[0].why: ::nope can only be used in a brief")
  })

  it("turns fill-in blanks into plato-blank when asked", () => {
    expect(inline("AES has ___ rounds, not ____.", { blank: true })).toBe(
      "AES has <plato-blank></plato-blank> rounds, not <plato-blank></plato-blank>."
    )
    expect(inline("AES has ___ rounds.")).toBe("AES has ___ rounds.")
  })
})

describe("sanitizeSvg", () => {
  const sanitize = (svg: string) => {
    const out = sanitizeSvg(svg, { idPrefix: "p", alt: "Alt" })
    return {
      html: out.svg ? toHtml(out.svg) : null,
      issues: out.issues.map((i) => i.message),
    }
  }

  it("strips scripts, handlers, styles and external references, and reports each", () => {
    const { html, issues } = sanitize(
      `<svg viewBox="0 0 1 1" onload="x()"><script>alert(1)</script><foreignObject><div></div></foreignObject>` +
        `<a href="https://evil.example"><rect/></a><image href="https://x/y.png"/>` +
        `<use href="https://x/s.svg#a"/><rect style="fill:url(https://x)" fill="url(https://x/p)" onclick="y()"/></svg>`
    )
    expect(html).toBe(
      '<svg viewBox="0 0 1 1" role="img" aria-label="Alt" focusable="false"><use></use><rect></rect></svg>'
    )
    expect(issues).toEqual([
      '<svg> has an event handler "onLoad"',
      "<script> is not allowed",
      "<foreignObject> is not allowed",
      "<a> is not allowed",
      "<image> is not allowed",
      '<use> links outside the file ("https://x/s.svg#a")',
      "<rect> has a style attribute; use presentation attributes",
      '<rect> references a URL outside the file in "fill"',
      '<rect> has an event handler "onClick"',
    ])
  })

  it("prefixes ids and rewrites their references", () => {
    const { html, issues } = sanitize(
      `<svg viewBox="0 0 1 1"><defs><linearGradient id="g"/><marker id="m"/></defs>` +
        `<path fill="url(#g)" marker-end="url(#m)"/><use href="#m"/></svg>`
    )
    expect(issues).toEqual([])
    expect(html).toBe(
      '<svg viewBox="0 0 1 1" role="img" aria-label="Alt" focusable="false"><defs><linearGradient id="p-g"></linearGradient><marker id="p-m"></marker></defs><path fill="url(#p-g)" marker-end="url(#p-m)"></path><use href="#p-m"></use></svg>'
    )
  })

  it("reports a missing viewBox or a file that is not one <svg>", () => {
    expect(sanitize("<svg></svg>").issues).toEqual(["<svg> has no viewBox"])
    expect(sanitize("<p>hi</p>")).toEqual({
      html: null,
      issues: ["must contain exactly one top-level <svg> element"],
    })
  })

  it("SVG problems are sanitized in the brief, not thrown, but checkBrief reports them", () => {
    writeFileSync(
      join(assetsDir, "bad.svg"),
      `<svg viewBox="0 0 1 1"><script>x</script></svg>`
    )
    const md = '::figure{src="bad.svg" alt="Bad."}'
    expect(brief(md)).not.toContain("script")
    expect(checkBrief(md, ctx())).toEqual([
      {
        path: [],
        message: "line 1: assets/bad.svg: <script> is not allowed",
        sanitized: true,
      },
    ])
  })
})

describe("renderLesson and getRenderedLesson", () => {
  const setup = () => {
    const t = createTestContent()
    const course = makeCourse("c", {
      modules: [{ id: "m1", title: "M", lessons: ["one"], checkpoint: [] }],
      policyNote: "Not *advice*.",
    })
    const l = makeLesson("one", {
      keyQuestions: ["q1", "q3"],
      exercises: [
        ...makeLesson("one").exercises,
        {
          id: "one-e2",
          type: "fill",
          concepts: ["one-c1"],
          pool: "review",
          prompt: "The key is ___.",
          explanation: "See $k$.",
          anchor: "a",
          accepted: ["k"],
        },
      ],
    })
    t.writeCourse(
      course,
      [l],
      "# One\n\nText. :cite[src-b]\n\n::guess{#one-g1}\n"
    )
    t.writePublished(["c"])
    return t
  }

  it("renders the brief and every inline field, keyed by id", () => {
    const t = setup()
    try {
      const r = getRenderedLesson("c", "one", { root: t.root })!
      expect(html(r.brief)).toContain('data-numbers="2"')
      expect(html(r.whyThisMatters)).toBe(
        'It matters. <plato-question data-id="q1"></plato-question> <plato-question data-id="q3"></plato-question>'
      )
      expect(Object.keys(r.guesses)).toEqual(["one-g1", "one-g2"])
      expect(r.guesses["one-g1"].correct).toBe("one-g1-a")
      expect(html(r.guesses["one-g1"].options["one-g1-b"])).toBe("Option B")
      expect(html(r.concepts["one-c2"][0].prompt)).toBe("Prompt 2?")
      expect(Object.keys(r.exercises["one-e1"].options!)).toHaveLength(3)
      expect(html(r.exercises["one-e2"].prompt)).toBe(
        "The key is <plato-blank></plato-blank>."
      )
      expect(getRenderedLesson("c", "nope", { root: t.root })).toBeNull()
      expect(getRenderedLesson("nope", "one", { root: t.root })).toBeNull()

      const rc = getRenderedCourse("c", { root: t.root })!
      expect(html(rc.outOfScope)).toBe("Everything else.")
      expect(html(rc.policyNote!)).toBe("Not <em>advice</em>.")
    } finally {
      t.close()
    }
  })

  it("names the lesson file and field when an inline field does not render", () => {
    const t = createTestContent()
    try {
      const course = makeCourse("c", {
        modules: [{ id: "m1", title: "M", lessons: ["one"], checkpoint: [] }],
      })
      t.writeCourse(course, [
        makeLesson("one", { whyThisMatters: "See :cite[nope]." }),
      ])
      t.writePublished(["c"])
      expect(() => getRenderedLesson("c", "one", { root: t.root })).toThrow(
        'courses/c/lessons/one.yaml: whyThisMatters: :cite: unknown source "nope"'
      )
    } finally {
      t.close()
    }
  })

  it("returns frozen trees outside production, so callers cannot corrupt the cache", () => {
    const t = setup()
    try {
      const r = getRenderedLesson("c", "one", { root: t.root })!
      expect(() =>
        r.whyThisMatters.children.push({ type: "text", value: "x" })
      ).toThrow(TypeError)
    } finally {
      t.close()
    }
  })

  it("loads figures from the course's own folder, whatever the default root", () => {
    const t = createTestContent()
    try {
      const course = makeCourse("c", {
        modules: [{ id: "m1", title: "M", lessons: ["one"], checkpoint: [] }],
      })
      t.writeCourse(
        course,
        [makeLesson("one")],
        '# One\n\n::figure{src="box.svg" alt="A box."}\n'
      )
      t.writeFile("courses/c/assets/box.svg", SVG)
      vi.stubEnv("PLATO_CONTENT_DIR", join(t.root, "elsewhere"))
      const loaded = loadCourseDir(join(t.root, "courses", "c"))
      expect(html(renderLesson(loaded, "one").brief)).toContain("<svg")
    } finally {
      t.close()
    }
  })

  it("is memoized in production only", () => {
    const t = setup()
    try {
      const a = getRenderedLesson("c", "one", { root: t.root })
      expect(getRenderedLesson("c", "one", { root: t.root })).not.toBe(a)

      vi.stubEnv("NODE_ENV", "production")
      const b = getRenderedLesson("c", "one", { root: t.root })
      t.writeFile("courses/c/lessons/one.md", "# Changed\n")
      expect(getRenderedLesson("c", "one", { root: t.root })).toBe(b)
      clearContentCache()
      expect(html(getRenderedLesson("c", "one", { root: t.root })!.brief)).toBe(
        "<h1>Changed</h1>"
      )
    } finally {
      t.close()
    }
  })
})

describe("fixture courses", () => {
  const root = join(process.cwd(), "e2e/fixtures/content")

  it("every brief and inline field renders with no issues", () => {
    const courses = listCourses({ root, includeDrafts: true })
    expect(courses).toHaveLength(2)
    for (const course of courses)
      for (const { lesson, brief } of course.lessons) {
        const c: RenderContext = {
          sourceNumbers: course.sourceNumbers,
          lesson,
          assetsDir: join(root, "courses", course.id, "assets"),
        }
        expect(checkBrief(brief, c), `${course.id}/${lesson.id}`).toEqual([])
        expect(() => renderLesson(course, lesson.id)).not.toThrow()
      }
  })
})
