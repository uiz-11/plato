import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parse, stringify } from "yaml"
import { afterEach, describe, expect, it } from "vitest"

import { writeValidAudit } from "@/test/audit"

import { loadCourseDir } from "./load"
import {
  checkUrls,
  courseUrls,
  validateCourse,
  type Finding,
  type Rule,
  type UrlFetch,
} from "./validate"

// The fixture courses pass the structure checks, and every rule is shown to
// fire by one mutation of a fixture (§10: "Each validator rule is tested by
// one in-memory mutation of the fixture, listed in a table, that must fail
// with the right message").

const FIXTURES = join(process.cwd(), "e2e/fixtures/content")
const MAIN = "how-encryption-works"
const MINI = "leap-years"

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

/** A writable copy of the fixture content root. */
function copyFixtures(): string {
  const root = mkdtempSync(join(tmpdir(), "plato-validate-"))
  cpSync(FIXTURES, root, { recursive: true })
  roots.push(root)
  return root
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any

type Edit = {
  /** Edits a YAML file of the course in place. */
  yaml: (file: string, fn: (d: Data) => void) => void
  text: (file: string, fn: (s: string) => string) => void
  write: (file: string, s: string) => void
  remove: (file: string) => void
}

function editor(root: string, courseId: string): Edit {
  const path = (f: string) => join(root, "courses", courseId, f)
  return {
    yaml(file, fn) {
      const d = parse(readFileSync(path(file), "utf8"))
      fn(d)
      writeFileSync(path(file), stringify(d))
    },
    text(file, fn) {
      const before = readFileSync(path(file), "utf8")
      const after = fn(before)
      if (after === before) throw new Error(`edit of ${file} changed nothing`)
      writeFileSync(path(file), after)
    },
    write: (file, s) => writeFileSync(path(file), s),
    remove: (file) => rmSync(path(file)),
  }
}

const sym = "lessons/symmetric-ciphers.yaml"
const symMd = "lessons/symmetric-ciphers.md"
const hash = "lessons/hash-functions.yaml"
const course = "course.yaml"

const ex = (d: Data, id: string) => {
  const e = d.exercises.find((x: Data) => x.id === id)
  if (!e) throw new Error(`no exercise ${id}`)
  return e
}

function errors(findings: Finding[]) {
  return findings.filter((f) => f.level === "error")
}

describe("the fixture courses", () => {
  it.each([MAIN, MINI])("%s passes structure validation", (id) => {
    const result = validateCourse(id, { root: FIXTURES })
    expect(errors(result.findings)).toEqual([])
    expect(result.ok).toBe(true)
  })
})

describe("the pipeline doc's worked example (T08)", () => {
  it("passes structure validation with no warnings", () => {
    const result = validateCourse("why-the-sky-is-blue", {
      root: join(process.cwd(), "docs/v1/course-pipeline-example"),
    })
    expect(result.findings).toEqual([])
  })
})

type Mutation = [
  name: string,
  rule: Rule,
  edit: (e: Edit) => void,
  message: string,
]

const MUTATIONS: Mutation[] = [
  // Schema
  [
    "a lesson key is misspelled",
    "schema",
    (e) =>
      e.yaml(sym, (d) => {
        d.whyThisMatter = d.whyThisMatters
      }),
    "Unrecognized key",
  ],
  [
    "the course id differs from its folder",
    "schema",
    (e) =>
      e.yaml(course, (d) => {
        d.id = "other"
      }),
    'does not match the folder "how-encryption-works"',
  ],
  [
    "a lesson has no brief",
    "schema",
    (e) => e.remove(symMd),
    "every lesson needs a brief",
  ],

  // Files
  [
    "a stray file sits in the course folder",
    "files",
    (e) => e.write("notes.txt", "hi"),
    "stray file",
  ],
  [
    "a lesson file is in no module",
    "files",
    (e) => e.write("lessons/extra.yaml", "id: extra\n"),
    'lesson "extra" is not in any module',
  ],
  [
    "a lesson is in two modules",
    "files",
    (e) =>
      e.yaml(course, (d) => {
        d.modules[1].lessons.push("symmetric-ciphers")
      }),
    "is listed more than once",
  ],
  [
    "an asset is never used",
    "files",
    (e) => e.write("assets/unused.svg", '<svg viewBox="0 0 1 1"/>'),
    "no ::figure uses this asset",
  ],
  [
    "a figure has a script",
    "files",
    (e) =>
      e.text("assets/paint-mixing.svg", (s) =>
        s.replace("<g ", "<script>alert(1)</script><g ")
      ),
    "<script> is not allowed",
  ],
  [
    "a figure loads an external image",
    "files",
    (e) =>
      e.text("assets/paint-mixing.svg", (s) =>
        s.replace("<g ", '<use href="https://x.test/a.svg#b"/><g ')
      ),
    "links outside the file",
  ],

  // Markdown (§5.3)
  [
    "a brief uses an unknown directive",
    "markdown",
    (e) => e.text(symMd, (s) => `${s}\n::video{#v}\n`),
    "unknown directive ::video",
  ],
  [
    "a brief has raw HTML",
    "markdown",
    (e) => e.text(symMd, (s) => `${s}\n<div>hi</div>\n`),
    "raw HTML is not allowed",
  ],
  [
    "a brief has a Markdown image",
    "markdown",
    (e) => e.text(symMd, (s) => `${s}\n![x](x.png) :general[x]\n`),
    "Markdown images are not allowed",
  ],
  [
    "a brief has no # Title",
    "markdown",
    (e) =>
      e.text(symMd, (s) =>
        s.replace("# Locks with one key", "## Locks with one key")
      ),
    "starts with its one # Title heading",
  ],
  [
    "a brief has two # Titles",
    "markdown",
    (e) => e.text(symMd, (s) => `${s}\n# Again\n`),
    "starts with its one # Title heading (found 2)",
  ],
  [
    "an inline field holds a list",
    "markdown",
    (e) =>
      e.yaml(sym, (d) => {
        d.whyThisMatters = "- a list item"
      }),
    "must be inline Markdown",
  ],
  [
    "a formula does not render",
    "markdown",
    (e) => e.text(symMd, (s) => `${s}\nBad $\\frac{1}{$ maths. :general[x]\n`),
    "math does not render",
  ],

  // References
  [
    "a brief cites an unknown source",
    "markdown",
    (e) =>
      e.text(symMd, (s) => s.replace(":cite[src-shannon]", ":cite[src-nope]")),
    'unknown source "src-nope"',
  ],
  [
    "an inline field cites an unknown source",
    "markdown",
    (e) =>
      e.yaml(sym, (d) => {
        d.whyThisMatters += " :cite[src-nope]"
      }),
    'unknown source "src-nope"',
  ],
  [
    "a brief places an unknown guess",
    "markdown",
    (e) => e.text(symMd, (s) => `${s}\n::guess{#g-nope}\n`),
    'the lesson has no guess "g-nope"',
  ],
  [
    "a figure file is missing",
    "markdown",
    (e) =>
      e.text("lessons/key-exchange.md", (s) =>
        s.replace('src="paint-mixing.svg"', 'src="missing.svg"')
      ),
    "assets/missing.svg not found",
  ],
  [
    "a lesson advances an unknown key question",
    "references",
    (e) =>
      e.yaml(sym, (d) => {
        d.keyQuestions = ["q2", "q5"]
      }),
    'unknown key question "q5"',
  ],
  [
    "a hook points to an unknown key question",
    "references",
    (e) =>
      e.yaml(sym, (d) => {
        d.hook.keyQuestion = "q5"
      }),
    'unknown key question "q5"',
  ],
  [
    "a guess key is not an option",
    "references",
    (e) =>
      e.yaml(sym, (d) => {
        d.guesses[0].correct = "g-caesar-nope"
      }),
    "is not one of the guess's options",
  ],
  [
    "an exercise key is not an option",
    "references",
    (e) =>
      e.yaml(sym, (d) => {
        ex(d, "e-shared-key-recall").correct = "nope"
      }),
    "is not one of the exercise's options",
  ],
  [
    "a spot-the-error key is not a sentence",
    "references",
    (e) =>
      e.yaml(hash, (d) => {
        ex(d, "e-fingerprint-review").faulty = "nope"
      }),
    "is not one of the exercise's sentences",
  ],
  [
    "an exercise tags an unknown concept",
    "references",
    (e) =>
      e.yaml(sym, (d) => {
        ex(d, "e-shared-key-recall").concepts = ["c-nope"]
      }),
    'unknown concept "c-nope"',
  ],
  [
    "a checkpoint lists an unknown exercise",
    "references",
    (e) =>
      e.yaml(course, (d) => {
        d.modules[0].checkpoint[0] = "x-nope"
      }),
    'unknown exercise "x-nope"',
  ],
  [
    "a simplified entry names an unknown analogy",
    "references",
    (e) =>
      e.yaml(sym, (d) => {
        d.beyond.simplified[1].analogy = "nope"
      }),
    'the brief has no analogy block "nope"',
  ],
  [
    "an option names an unknown misconception",
    "references",
    (e) =>
      e.yaml(sym, (d) => {
        d.guesses[1].options[1].misconception = "m-nope"
      }),
    'unknown misconception "m-nope"',
  ],
  [
    "an exercise anchor is in no brief",
    "references",
    (e) =>
      e.yaml(sym, (d) => {
        ex(d, "e-shared-key-recall").anchor = "a-nope"
      }),
    'no brief has the anchor "a-nope"',
  ],

  // Placement
  [
    "a guess is placed twice",
    "placement",
    (e) => e.text(symMd, (s) => `${s}\n::guess{#g-caesar}\n`),
    'guess "g-caesar" is placed in the brief 2 times',
  ],
  [
    "a misconception is never placed",
    "placement",
    (e) =>
      e.text(symMd, (s) =>
        s.replace("::misconception{#m-secret-algorithm}\n", "")
      ),
    'misconception "m-secret-algorithm" is placed in the brief 0 times',
  ],

  // Ids and consistency
  [
    "a concept is taught in two lessons",
    "ids",
    (e) =>
      e.yaml(hash, (d) => {
        d.concepts[0].id = "c-shared-key"
      }),
    'id "c-shared-key" is used more than once',
  ],
  [
    "an anchor reuses an exercise id",
    "ids",
    (e) => e.text(symMd, (s) => `${s}\n::anchor{#e-shared-key-recall}\n`),
    'id "e-shared-key-recall" is used more than once',
  ],
  [
    "a key question is listed twice",
    "ids",
    (e) =>
      e.yaml(course, (d) => {
        d.keyQuestions[1].id = "q1"
      }),
    "key question q1 is listed twice",
  ],
  [
    "two options share an id",
    "ids",
    (e) =>
      e.yaml(sym, (d) => {
        const o = ex(d, "e-shared-key-recall").options
        o[1].id = o[0].id
      }),
    "is used twice in this list",
  ],

  // Citations
  [
    "a paragraph has no citation",
    "citations",
    (e) => e.text(symMd, (s) => `${s}\nAn uncited claim.\n`),
    "paragraph has no :cite or content label",
  ],
  [
    "a list item has no citation",
    "citations",
    (e) =>
      e.text(symMd, (s) =>
        s.replace("surface early. :cite[src-fips-197]", "surface early.")
      ),
    "list item has no :cite or content label",
  ],
  [
    "a source is never cited",
    "citations",
    (e) =>
      e.yaml(course, (d) => {
        d.sources.push({ ...d.sources[0], id: "src-extra" })
      }),
    'source "src-extra" is never cited',
  ],

  // Analogies
  [
    "an analogy is not referenced",
    "analogies",
    (e) =>
      e.yaml(sym, (d) => {
        delete d.beyond.simplified[1].analogy
      }),
    'analogy "padlock" is not referenced',
  ],

  // Exercises
  [
    "two options have the same text",
    "exercises",
    (e) =>
      e.yaml(sym, (d) => {
        const o = ex(d, "e-shared-key-recall").options
        o[1].text = o[0].text
      }),
    "option texts are distinct",
  ],
  [
    "a fill-in prompt has two blanks",
    "exercises",
    (e) =>
      e.yaml(sym, (d) => {
        ex(d, "e-shared-key-review").prompt = "The ___ key and the ___ key."
      }),
    "exactly one blank (3+ underscores); found 2",
  ],
  [
    "a fill-in prompt has no blank",
    "exercises",
    (e) =>
      e.yaml(sym, (d) => {
        ex(d, "e-shared-key-review").prompt = "Which key decrypts?"
      }),
    "exactly one blank (3+ underscores); found 0",
  ],
  [
    "two accepted answers normalize alike",
    "exercises",
    (e) =>
      e.yaml(sym, (d) => {
        ex(d, "e-key-length-recall").accepted = ["doubles", "Doubles!"]
      }),
    'is the same answer as "doubles"',
  ],
  [
    "a short answer is in the review pool",
    "exercises",
    (e) =>
      e.yaml(sym, (d) => {
        Object.assign(ex(d, "e-kerckhoffs-recall"), { pool: "review" })
      }),
    "short answers are allowed in the recall and checkpoint pools only",
  ],
  [
    "a recall exercise tags two concepts",
    "exercises",
    (e) =>
      e.yaml(sym, (d) => {
        ex(d, "e-shared-key-recall").concepts = ["c-shared-key", "c-kerckhoffs"]
      }),
    "tags exactly one concept (found 2)",
  ],
  [
    "a recall exercise tags another lesson's concept",
    "exercises",
    (e) =>
      e.yaml(sym, (d) => {
        ex(d, "e-shared-key-recall").concepts = ["c-hash-fingerprint"]
      }),
    "is taught in hash-functions",
  ],
  [
    "a checkpoint exercise tags a concept outside its module",
    "exercises",
    (e) =>
      e.yaml(hash, (d) => {
        ex(d, "x-secrets-spot").concepts = ["c-shared-key", "c-modular"]
      }),
    'is taught outside module "shared-secrets"',
  ],
  [
    "an anchor is in a lesson that does not teach the concept",
    "exercises",
    (e) =>
      e.yaml(sym, (d) => {
        ex(d, "e-shared-key-recall").anchor = "a-fingerprint"
      }),
    "teaches none of the exercise's concepts",
  ],

  // Enough practice
  [
    "a concept has no review exercise",
    "practice",
    (e) =>
      e.yaml(sym, (d) => {
        ex(d, "e-shared-key-review").pool = "recall"
      }),
    'concept "c-shared-key" has no review exercise',
  ],
  [
    "a concept has no recall exercise",
    "practice",
    (e) =>
      e.yaml(sym, (d) => {
        ex(d, "e-shared-key-recall").pool = "review"
      }),
    'concept "c-shared-key" has no recall exercise',
  ],

  // Checkpoints
  [
    "a checkpoint is too short",
    "checkpoints",
    (e) =>
      e.yaml(course, (d) => {
        d.modules[0].checkpoint.pop()
      }),
    "checkpoint has 6–12 exercises (found 5)",
  ],
  [
    "a checkpoint exercise is in no checkpoint",
    "checkpoints",
    (e) =>
      e.yaml(course, (d) => {
        d.modules[0].checkpoint.pop()
      }),
    'checkpoint exercise "x-secrets-short" is in no module\'s checkpoint',
  ],
  [
    "a checkpoint exercise is in two checkpoints",
    "checkpoints",
    (e) =>
      e.yaml(course, (d) => {
        d.modules[1].checkpoint.push("x-secrets-key")
      }),
    'checkpoint exercise "x-secrets-key" is used 2 times',
  ],
  [
    "a checkpoint uses a recall exercise",
    "checkpoints",
    (e) =>
      e.yaml(course, (d) => {
        d.modules[0].checkpoint[0] = "e-shared-key-recall"
      }),
    "checkpoints use checkpoint exercises only",
  ],
  [
    "a checkpoint misses a lesson",
    "checkpoints",
    (e) =>
      e.yaml(hash, (d) => {
        for (const id of [
          "x-secrets-download",
          "x-secrets-spot",
          "x-secrets-short",
        ])
          ex(d, id).concepts = ["c-shared-key"]
      }),
    'has no exercise on lesson "hash-functions"',
  ],

  // Coverage
  [
    "a key question is advanced by no lesson",
    "coverage",
    (e) =>
      e.yaml(course, (d) => {
        d.keyQuestions.push({ id: "q5", text: "Unasked?" })
      }),
    "key question q5 is advanced by no lesson",
  ],
  [
    "the last lesson has a hook",
    "coverage",
    (e) =>
      e.yaml("lessons/signatures.yaml", (d) => {
        d.hook = { text: "Next?", keyQuestion: "q1" }
      }),
    "the course's last lesson has no hook",
  ],
  [
    "a lesson before the last has no hook",
    "coverage",
    (e) =>
      e.yaml(sym, (d) => {
        delete d.hook
      }),
    "every lesson except the course's last has a hook",
  ],

  // Course shape
  [
    "a mini-course has two modules",
    "shape",
    (e) =>
      e.yaml(course, (d) => {
        d.kind = "mini"
      }),
    "a mini-course has exactly 1 module (found 2)",
  ],
  [
    "a mini-course has four lessons",
    "shape",
    (e) =>
      e.yaml(course, (d) => {
        d.kind = "mini"
      }),
    "a mini-course has 1–2 lessons (found 4)",
  ],
  [
    "a lesson recommends two links",
    "shape",
    (e) =>
      e.yaml(sym, (d) => {
        d.beyond.notCovered[0].links[0].recommended = "q1"
      }),
    "at most one Go deeper link per lesson is recommended (found 2)",
  ],

  // Policies
  [
    "a narrow topic is a standard course",
    "policies",
    (e) =>
      e.yaml(course, (d) => {
        d.policies.push("narrow")
      }),
    "a narrow topic is a mini-course",
  ],
  [
    "a contested course has no :contested label",
    "policies",
    (e) => {
      e.yaml(course, (d) => {
        d.policies.push("contested")
      })
      e.text("lessons/signatures.md", (s) =>
        s.replaceAll(":contested[", ":general[")
      )
    },
    "labels disagreement with at least one :contested",
  ],
  [
    "a contested course's source has no position",
    "policies",
    (e) =>
      e.yaml(course, (d) => {
        d.policies.push("contested")
      }),
    "every source of a contested course states its position",
  ],
  [
    "a contested course has one position",
    "policies",
    (e) =>
      e.yaml(course, (d) => {
        d.policies.push("contested")
        for (const s of d.sources) s.position = "For"
      }),
    "at least 2 distinct positions (found 1)",
  ],
  [
    "a skill course has no policy note",
    "policies",
    (e) =>
      e.yaml(course, (d) => {
        d.policies.push("skill")
      }),
    "the skill policy needs a policyNote",
  ],
  [
    "a health course has no policy note",
    "policies",
    (e) =>
      e.yaml(course, (d) => {
        d.policies.push("health-legal-financial-safety")
      }),
    "the health-legal-financial-safety policy needs a policyNote",
  ],

  // Plain-text fields (found in the schema trial, T08)
  [
    "a concept statement has math",
    "markdown",
    (e) =>
      e.yaml(sym, (d) => {
        d.concepts[0].statement = "Scattering goes as $1/\\lambda^4$."
      }),
    'plain text, not Markdown: the math "$1/\\\\lambda^4$"',
  ],
  [
    "a short-answer checklist item has a citation",
    "markdown",
    (e) =>
      e.yaml(sym, (d) => {
        const short = d.exercises.find((x: Data) => x.type === "short")
        short.checklist[0] += " :cite[src-x]"
      }),
    'plain text, not Markdown: the directive ":cite[…]"',
  ],
  [
    "a key question has a code span",
    "markdown",
    (e) =>
      e.yaml(course, (d) => {
        d.keyQuestions[0].text = "What does `AES` do?"
      }),
    'plain text, not Markdown: the code span "`AES`"',
  ],

  // Copyright
  [
    "a blockquote is too long",
    "copyright",
    (e) =>
      e.text(symMd, (s) =>
        s.replace(
          '> "The enemy knows the system."',
          `> "${Array.from({ length: 41 }, () => "word").join(" ")}"`
        )
      ),
    "a blockquote is at most 40 words (found 41)",
  ],
]

describe("structure checks: each mutation of the fixture fails", () => {
  it.each(MUTATIONS)("%s [%s]", (_name, rule, edit, message) => {
    const root = copyFixtures()
    edit(editor(root, MAIN))
    const result = validateCourse(MAIN, { root })
    expect(result.ok).toBe(false)
    expect(errors(result.findings)).toContainEqual(
      expect.objectContaining({
        rule,
        message: expect.stringContaining(message),
      })
    )
  })

  it("covers every structure rule", () => {
    const covered = new Set(MUTATIONS.map(([, rule]) => rule))
    const structureRules: Rule[] = [
      "schema",
      "files",
      "markdown",
      "references",
      "placement",
      "ids",
      "citations",
      "analogies",
      "exercises",
      "practice",
      "checkpoints",
      "coverage",
      "shape",
      "policies",
      "copyright",
    ]
    expect([...covered].sort()).toEqual([...structureRules].sort())
  })

  it("reports where a problem is", () => {
    const root = copyFixtures()
    editor(root, MAIN).yaml(sym, (d) => {
      ex(d, "e-shared-key-recall").anchor = "a-nope"
    })
    const [f] = errors(validateCourse(MAIN, { root }).findings)
    expect(f).toEqual({
      level: "error",
      rule: "references",
      file: `courses/${MAIN}/lessons/symmetric-ciphers.yaml`,
      path: ["exercises", 0, "anchor"],
      message: 'no brief has the anchor "a-nope"',
    })
  })

  it("names the line of a brief problem", () => {
    const root = copyFixtures()
    editor(root, MAIN).text(symMd, (s) => `${s}\nAn uncited claim.\n`)
    const lines = readFileSync(
      join(root, "courses", MAIN, symMd),
      "utf8"
    ).split("\n")
    const line = lines.indexOf("An uncited claim.") + 1
    expect(errors(validateCourse(MAIN, { root }).findings)).toEqual([
      expect.objectContaining({
        file: `courses/${MAIN}/${symMd}`,
        message: `line ${line}: paragraph has no :cite or content label (:general, :uncertain, :contested)`,
      }),
    ])
  })

  it("reports every file that fails the schema in one run", () => {
    const root = copyFixtures()
    const e = editor(root, MAIN)
    e.yaml(sym, (d) => {
      d.title = ""
    })
    e.yaml(hash, (d) => {
      d.title = ""
    })
    const files = errors(validateCourse(MAIN, { root }).findings).map(
      (f) => f.file
    )
    expect(files).toEqual([`courses/${MAIN}/${sym}`, `courses/${MAIN}/${hash}`])
  })

  it("allows prices in plain text, and backticks in source titles", () => {
    const root = copyFixtures()
    const e = editor(root, MAIN)
    e.yaml(sym, (d) => {
      d.concepts[0].statement =
        "A key costs $5 to $10 to break, or $5-$10, not $1 000."
    })
    e.yaml(course, (d) => {
      d.sources[0].title = "The `fetch()` method"
    })
    expect(errors(validateCourse(MAIN, { root }).findings)).toEqual([])
  })

  it.each([
    ["simple math", "the $n$th term", 'the math "$n$"'],
    ["spaced math", "it is $n + 1$ here", 'the math "$n + 1$"'],
    ["an escaped dollar", "it costs \\$5", 'the escaped dollar "\\$"'],
  ])("rejects %s in plain text", (_name, value, message) => {
    const root = copyFixtures()
    editor(root, MAIN).yaml(sym, (d) => {
      d.concepts[0].statement = value
    })
    expect(errors(validateCourse(MAIN, { root }).findings)).toContainEqual(
      expect.objectContaining({
        rule: "markdown",
        path: ["concepts", 0, "statement"],
        message: expect.stringContaining(message),
      })
    )
  })

  it("checks every source field and the cover label", () => {
    const root = copyFixtures()
    editor(root, MAIN).yaml(course, (d) => {
      d.coverLabel = "`AES`"
      d.sources[0].group = "Group :cite[x]"
      d.sources[0].publisher = "Pub $x$"
    })
    const paths = errors(validateCourse(MAIN, { root }).findings)
      .filter((f) => f.rule === "markdown")
      .map((f) => f.path.join("."))
    expect(paths).toEqual(
      expect.arrayContaining([
        "coverLabel",
        "sources.0.group",
        "sources.0.publisher",
      ])
    )
  })

  it("exempts analogy blocks from citations", () => {
    const root = copyFixtures()
    editor(root, MAIN).text(symMd, (s) =>
      s.replace(
        ":::analogy{#padlock}\n",
        ":::analogy{#padlock}\nAn uncited aside.\n\n"
      )
    )
    expect(validateCourse(MAIN, { root }).ok).toBe(true)
  })

  it("warns, without failing, about link counts and brief length", () => {
    const root = copyFixtures()
    const e = editor(root, MAIN)
    e.yaml(sym, (d) => {
      d.beyond.notCovered = []
    })
    e.text(symMd, (s) => s.split("\n\n").slice(0, 3).join("\n\n") + "\n")
    const result = validateCourse(MAIN, { root })
    const warnings = result.findings.filter((f) => f.level === "warning")
    expect(warnings.map((w) => w.message)).toEqual([
      "a lesson usually has 2–3 Go deeper links (found 1)",
      expect.stringMatching(
        /^a brief is usually 700–1,800 words \(found \d+\)$/
      ),
    ])
  })

  it("rejects an unknown course", () => {
    expect(validateCourse("nope", { root: FIXTURES }).findings).toEqual([
      expect.objectContaining({
        rule: "files",
        message: "course folder not found",
      }),
    ])
    expect(validateCourse("../x", { root: FIXTURES }).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Publish checks

const claimsFile = "_audit/claims.yaml"
const solveFile = "_audit/blind-solve.yaml"
const reviewFile = "_audit/review.yaml"
const entry = (d: Data, id: string) => {
  const x = d.exercises.find((e: Data) => e.exercise === id)
  if (!x) throw new Error(`no entry ${id}`)
  return x
}

const AUDIT_MUTATIONS: [string, (e: Edit) => void, string][] = [
  [
    "claims.yaml is missing",
    (e) => e.remove(claimsFile),
    "file not found: the check stage writes it",
  ],
  [
    "a cited source has no claim",
    (e) =>
      e.yaml(claimsFile, (d) => {
        d.claims = d.claims.filter(
          (c: Data) => c.source !== "src-britannica-gregorian"
        )
      }),
    'no claim checks "src-britannica-gregorian", which leap-rule cites',
  ],
  [
    "a claim names an unknown source",
    (e) =>
      e.yaml(claimsFile, (d) => {
        d.claims[0].source = "src-nope"
      }),
    'unknown source "src-nope"',
  ],
  [
    "a claim has an unknown verdict",
    (e) =>
      e.yaml(claimsFile, (d) => {
        d.claims[0].verdict = "probably"
      }),
    'expected one of "confirmed"|"labelled-uncertain"|"removed"',
  ],
  [
    "an exercise has no blind-solve entry",
    (e) =>
      e.yaml(solveFile, (d) => {
        d.exercises = d.exercises.filter(
          (x: Data) => x.exercise !== "x-leap-drift"
        )
      }),
    'no entry for exercise "x-leap-drift"',
  ],
  [
    "two options are defensible",
    (e) =>
      e.yaml(solveFile, (d) => {
        for (const o of entry(d, "x-leap-drift").options)
          o.verdict = "defensible"
      }),
    "defensible options; exactly one must be",
  ],
  [
    "the solver defends a wrong option",
    (e) =>
      e.yaml(solveFile, (d) => {
        const opts = entry(d, "x-leap-drift").options
        const key = opts.findIndex((o: Data) => o.verdict === "defensible")
        opts[key].verdict = "indefensible"
        opts[(key + 1) % opts.length].verdict = "defensible"
      }),
    "but the key of",
  ],
  [
    "an option has no verdict",
    (e) =>
      e.yaml(solveFile, (d) => {
        entry(d, "x-leap-drift").options.pop()
      }),
    "no verdict on option",
  ],
  [
    "a spot-the-error fix has no verdict",
    (e) =>
      e.yaml(solveFile, (d) => {
        entry(d, "e-julian-review").options.pop()
      }),
    "no verdict on fix",
  ],
  [
    "the solver's fill-in answer is not accepted",
    (e) =>
      e.yaml(solveFile, (d) => {
        entry(d, "x-leap-2100").answer = "maybe"
      }),
    "is not accepted by",
  ],
  [
    "a short answer has a blind-solve entry",
    (e) =>
      e.yaml(solveFile, (d) => {
        d.exercises.push({ exercise: "x-leap-why", answer: "x" })
      }),
    "is a short answer, which is not automatically marked",
  ],
  [
    "a finding has no resolution",
    (e) =>
      e.yaml(reviewFile, (d) => {
        delete d.findings[0].resolution
      }),
    "every finding needs a resolution",
  ],
  [
    "the review skips an area",
    (e) =>
      e.yaml(reviewFile, (d) => {
        d.findings = d.findings.filter((f: Data) => f.area !== "copyright")
      }),
    "no finding covers copyright",
  ],
]

describe("publish checks (--publish)", () => {
  it("a course with complete audit evidence passes", () => {
    const root = copyFixtures()
    writeValidAudit(root, MINI)
    expect(
      errors(validateCourse(MINI, { root, publish: true }).findings)
    ).toEqual([])
  })

  it("structure validation does not need audit files", () => {
    expect(validateCourse(MINI, { root: FIXTURES }).ok).toBe(true)
    expect(validateCourse(MINI, { root: FIXTURES, publish: true }).ok).toBe(
      false
    )
  })

  it.each(AUDIT_MUTATIONS)("%s", (_name, edit, message) => {
    const root = copyFixtures()
    writeValidAudit(root, MINI)
    edit(editor(root, MINI))
    const result = validateCourse(MINI, { root, publish: true })
    expect(result.ok).toBe(false)
    expect(errors(result.findings)).toContainEqual(
      expect.objectContaining({
        rule: "audit",
        message: expect.stringContaining(message),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// --online

describe("checkUrls", () => {
  it("reports URLs that do not answer 2xx, trying GET when HEAD is refused", async () => {
    const c = loadCourseDir(join(FIXTURES, "courses", MINI), null, FIXTURES)
    const [bad, headless] = [c.course.sources[0].url, c.course.sources[1].url]
    const calls: string[] = []
    const fetchUrl: UrlFetch = async (url, init) => {
      calls.push(`${init.method} ${url}`)
      if (url === bad) return { status: 404 }
      if (url === headless)
        return { status: init.method === "HEAD" ? 405 : 200 }
      return { status: 200 }
    }
    const findings = await checkUrls(c, fetchUrl)
    expect(findings).toEqual([
      expect.objectContaining({
        rule: "online",
        path: ["sources", 0, "url"],
        message: `${bad} answered 404`,
      }),
    ])
    expect(calls).toContain(`GET ${headless}`)
  })
})

describe("courseUrls and checkUrls: Markdown links", () => {
  it("checks links in briefs and inline fields, and falls back to GET when HEAD fails", async () => {
    const root = copyFixtures()
    const e = editor(root, MINI)
    e.text(
      "lessons/leap-rule.md",
      (s) => `${s}\nSee [the table](https://brief.test/t). :general[x]\n`
    )
    e.yaml("lessons/leap-rule.yaml", (d) => {
      d.whyThisMatters += " See <https://inline.test/a>."
    })
    const c = loadCourseDir(join(root, "courses", MINI), null, root)
    expect(courseUrls(c)).toEqual(
      expect.arrayContaining([
        {
          url: "https://brief.test/t",
          file: `courses/${MINI}/lessons/leap-rule.md`,
          path: [],
        },
        {
          url: "https://inline.test/a",
          file: `courses/${MINI}/lessons/leap-rule.yaml`,
          path: ["whyThisMatters"],
        },
      ])
    )

    let cancelled = 0
    const body = { cancel: async () => void (cancelled += 1) }
    const fetchUrl: UrlFetch = async (url, init) => {
      if (url === "https://brief.test/t") return { status: 404, body }
      if (url === "https://inline.test/a" && init.method === "HEAD")
        throw new Error("socket hang up")
      return { status: 200, body }
    }
    const findings = await checkUrls(c, fetchUrl)
    expect(findings.map((f) => f.message)).toEqual([
      "https://brief.test/t answered 404",
    ])
    expect(cancelled).toBeGreaterThan(0)
  })
})

describe("checkUrls concurrency", () => {
  it("keeps at most `concurrency` requests in flight and checks each URL once", async () => {
    const c = loadCourseDir(join(FIXTURES, "courses", MAIN), null, FIXTURES)
    let inFlight = 0
    let peak = 0
    const seen = new Map<string, number>()
    const fetchUrl: UrlFetch = async (url) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      seen.set(url, (seen.get(url) ?? 0) + 1)
      await new Promise((r) => setTimeout(r, 1))
      inFlight -= 1
      return { status: 200 }
    }
    expect(await checkUrls(c, fetchUrl, { concurrency: 3 })).toEqual([])
    expect(peak).toBe(3)
    expect(Math.max(...seen.values())).toBe(1)
    expect(seen.size).toBe(new Set(courseUrls(c).map((u) => u.url)).size)
  })
})
