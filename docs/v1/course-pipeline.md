# Plato — Course Pipeline (v1)

*Date: 2026-11-24. Status: reviewed against [technical design §11](technical-design.md#11-offline-course-creation).*

This is the brief for the course-creation skill: what it reads, what it writes, and the gates it must pass. It restates [technical design §11](technical-design.md#11-offline-course-creation) for the skill, and adds the authoring rules learned in the schema trial (T08). Where the two disagree, the technical design wins and this document is fixed.

- **Schema of record:** [`lib/content/schema.ts`](../../lib/content/schema.ts) for course content, and [`lib/content/audit.ts`](../../lib/content/audit.ts) for audit evidence. This document summarizes them; the code decides.
- **Validator of record:** [`lib/content/validate.ts`](../../lib/content/validate.ts), run as `npm run course:validate`.
- **Worked example:** [`course-pipeline-example/courses/why-the-sky-is-blue/`](course-pipeline-example/courses/why-the-sky-is-blue/), a one-lesson mini-course written in the schema trial (§8). A test keeps it valid as the schema changes.

---

## 1. What the operator runs

1. `npm run requests:export` writes one file per open request to `.pipeline/requests/<id>.json`: `{ id, text, createdAt }`. It also removes the files of requests that have since been published or marked not built, so the folder holds only open requests. (T20.)
2. The course-creation skill, once per request. It ends either with stage 5's gate passing, or with a not-build decision.
3. `npm run course:publish <id>`, or `npm run course:not-built <requestId> "<reason>"`.
4. Commit, open a PR, merge when CI is green, and deploy.

The pipeline never writes to the app's database. `.pipeline/` is gitignored; `content/` is committed.

## 2. Stages

Working files go in `.pipeline/<requestId>/`. Each stage maps to a step of spec F2.

| Stage | Output | Gate before the next stage |
|---|---|---|
| 1. Key questions | `01-questions.yaml`: 3–5 key questions, the spec §8 policies that apply, and a build or not-build decision with a one-line reason | Each question is specific, self-contained and answerable |
| 2. Scope | `02-scope.yaml`: kind (standard or mini), target length (the learner's, or about 5 hours), the module and lesson outline, concepts per lesson, the key-question map, the out-of-scope line and the policy note | Every key question is covered, each concept is in one lesson, and the estimated length fits the target |
| 3. Research | `03-sources.yaml`, and `03-notes/<source>.md` with section locators and short quotes only | Learner-named sources are used where suitable, then authoritative, open-access and recent ones, balanced across positions when contested |
| 4. Write | A draft course folder in `content/courses/<id>/` | `course:validate <id> --json` reports no errors |
| 5. Check | `_audit/claims.yaml`, `_audit/blind-solve.yaml`, `_audit/review.yaml`, and a passing display check | `course:validate <id> --publish` reports no errors, and the display check passes |
| 6. Publish (operator) | `course:publish <id>` appends the manifest entry; the operator opens a PR | CI is green |

- **Course id.** The skill chooses it: a short kebab-case slug of the title, unique among published ids forever. It is also the URL.
- **`requestId`.** Set it to the request's id. `course:publish` copies it into the manifest entry, which is what makes the request *Published*.
- **Giving up.** If stage 4 or 5 still fails after three attempts, or stage 1 decides not to build, the operator runs `course:not-built`. The learner sees the reason, so it is one plain sentence, such as "A support request, not a topic to learn".
- **Length.** Lesson reading time is the brief's words ÷ 220, rounded up. Course length is the sum of the lesson and checkpoint estimates in technical design §7.7. Nothing about length is authored.

## 3. The course folder

```
content/courses/<course-id>/
  course.yaml               course, key questions, modules (with checkpoints), sources
  lessons/<lesson-id>.yaml  structured lesson data
  lessons/<lesson-id>.md    the brief
  assets/*.svg              diagrams, referenced by ::figure
  _audit/                   stage 5 evidence; committed, never loaded by the app
```

Anything else in the folder is a validation error. A folder that is not in `content/published.json` is a draft, which the app does not list.

### 3.1 Ids

- Every id is kebab-case: `^[a-z0-9]+(-[a-z0-9]+)*$`. Key questions are `q1`–`q5`.
- Ids inside a course (lessons, concepts, exercises, guesses, options, misconceptions, sources, anchors, analogies) are unique **across all kinds** within the course.
- Prefixes keep them apart and make findings readable. The example uses `c-` concepts, `g-` guesses, `m-` misconceptions, `e-` lesson exercises, `x-` checkpoint exercises, `a-` anchors, `an-` analogies, `s-` and `n-` Beyond entries, `src-` sources, and options named after their parent (`e-sunset-recall-path`).

### 3.2 What a lesson must hold

The schema and validator enforce all of this; the list is here so the skill can plan before it writes.

- 3–6 concepts, each with a one-sentence `statement` and at least one recall prompt.
- Per concept: at least one `recall` exercise and at least one `review` exercise, each tagging only that concept.
- 2–3 guesses with 3–4 options, each placed once in the brief with `::guess{#id}`.
- Misconceptions, each placed once with `::misconception{#id}`, and each id unique across the course.
- `whyThisMatters`; `keyQuestions` (at least one); a `hook` on every lesson except the course's last.
- `beyond`: *Simplified* entries (one per analogy block, at least) and *Not covered* entries, with 2–3 Go deeper links in total and at most one `recommended`.
- A brief of 700–1,800 words (a warning, not an error).

Exercise pools:

| Pool | Where it appears | Concepts it may tag | Types |
|---|---|---|---|
| `recall` | step 4 of its lesson | exactly one, from its own lesson | all five |
| `review` | spaced review | exactly one, from its own lesson | all but `short` |
| `checkpoint` | its module's checkpoint only | any from its module's lessons | all five |

A checkpoint lists 6–12 exercise ids (4–12 in a mini-course), all from the `checkpoint` pool, each used by one checkpoint only, covering every lesson of the module. Put checkpoint exercises in the YAML of a lesson of their module, usually the last.

Every exercise's `anchor` must be an `::anchor{#id}` in the brief of a lesson that teaches one of its concepts. That is where "In the brief" jumps to.

### 3.3 Course rules

- 3–5 key questions; every one advanced by at least one lesson.
- A mini-course has one module and 1–2 lessons.
- Every source is cited at least once.
- Policies (spec §8): `narrow` requires `kind: mini`. `contested` requires at least one `:contested` label and at least two distinct source `position`s. `health-legal-financial-safety`, `skill` and `little-research` require a `policyNote`.

## 4. Markdown and plain-text fields

Fields are one of three kinds. Using Markdown in a plain-text field is a validation error, because the app would show it literally (§8).

| Kind | Fields | Allows |
|---|---|---|
| **Brief** (`.md` file) | the whole brief | everything in §5 |
| **Inline Markdown** (`Md`) | `whyThisMatters`; recall `prompt`, `answer`; guess `prompt`, `why`; every option `text`; misconception `belief`, `correction`; simplified `text`; exercise `prompt`, `scenario`, `explanation`; course `outOfScope`, `policyNote` | `$…$` math, `*emphasis*`, `` `code` ``, `:cite[…]` and content labels; no block elements |
| **Plain text** | titles; key question `text`; concept `statement`; `hook.text`; link `title`, `adds`; not-covered `topic`, `why`; short-answer `sample`, `checklist`; source fields | words only. Write math out ("16 times stronger", "one over the wavelength to the fourth power") |

A literal dollar sign in Markdown is `\$`, because `$` starts inline math. In plain text a dollar sign is just a dollar sign, and `\$` is an error. The validator reads `$…$` the way Pandoc does: no space just inside the dollars, and no digit right after the closing one. So `$n$` is math, while "$5 to $10" and "$5-$10" are prices.

Source titles may keep backticks, because they reproduce the source's own title.

## 5. Brief format

A brief is CommonMark plus GFM tables, `$…$` and `$$…$$` math, fenced code, `##` and `###` headings, and the directives below. Anything else, including raw HTML, Markdown images and footnotes, is an error.

| Directive | What it does |
|---|---|
| `# Title` | The brief heading. Exactly once, as the first line. |
| `:cite[src-a,src-b]` | Citation chips for those sources. |
| `:uncertain[…]`, `:general[…]`, `:contested[…]` | The wrapped text, followed by a content label. Use `:general[…]` for a sentence that needs no source (a summary, a calculation), and `:uncertain[…]` for a claim the sources do not settle. |
| `::anchor{#id}` | A jump target for exercises' "In the brief". On its own line. |
| `::guess{#id}` | The "Your guess" box. Place it after the setup and before the answer. |
| `::misconception{#id}` | The "You might think …" box. |
| `:::analogy{#id}` … `:::` | An analogy block. A `simplified` entry must reference it with `analogy: <id>` and say where it breaks down. |
| `::figure{src="x.svg" alt="…" caption="…"}` | An SVG from `assets/`, inlined so it takes the text colour. |

**Citations.** Every paragraph and list item outside an analogy block needs a `:cite` or a content label, including short lead-in sentences ("The rule has three parts.") and the sentence before a display equation. Headings, tables, display math and code blocks do not. One `:cite` at the end of the paragraph covers it.

**Blockquotes** are at most 40 words.

**Figures.** An SVG needs a `viewBox` and must not have `<script>`, `on*` attributes or external references. Use `currentColor` for strokes and text, so the figure works in light and dark mode.

## 6. YAML authoring rules

The trial tripped on each of these (§8). The validator now names the likely cause, but it is cheaper not to trip.

1. **Write prose as a block scalar.** Any `Md` value longer than a few words, and anything containing `: `, ` #`, or starting with a quote, `[`, `{`, `*`, `&` or `!`, goes in `|-`:

   ```yaml
   why: |-
     The ratio of wavelengths is about 1.56, and scattering goes as the
     fourth power, so $1.56^4 \approx 5.9$.
   ```

   Use `|-` (keep line breaks, drop the final newline). Markdown joins the lines, so wrap where you like.
2. **Keep flow mappings for short, comma-free values.** In `{ id: x, text: Red, or blue }` the comma ends the text and `or blue` becomes a key. If an option has a comma or a colon, write it one key per line:

   ```yaml
   - id: x-sky-violet-both
     text: Sunlight has less violet than blue, and our eyes respond less to violet
   ```
3. **Quote values that look like numbers, dates or booleans** when they are text: `text: "2400"`, `asOf: "2026-11"`, `date: "2024"`. The loader keeps unquoted numbers as their source text, but quoting says what you mean.
4. **Backslashes are literal in block scalars and plain scalars**, so TeX needs no escaping there: `$\lambda$`. Inside double quotes it must be `"$\\lambda$"`; avoid double-quoted TeX.
5. **Unknown keys are errors.** Every object is strict, so a misspelled key fails instead of being dropped.

## 7. The validator

```
npm run course:validate <id> [--publish] [--json] [--online]
```

- Default: the structure checks (stage 4's gate).
- `--publish`: also the audit checks (stage 5's gate).
- `--online`: also checks every URL answers 2xx, once there are no errors. Never run in CI.
- Errors exit 1. Warnings are printed and do not fail the run.

Run it from the repository root. It reads `content/` unless `PLATO_CONTENT_DIR` points elsewhere.

### 7.1 `--json` output

```json
{
  "courseId": "why-the-sky-is-blue",
  "ok": false,
  "errors": 1,
  "warnings": 0,
  "findings": [
    {
      "level": "error",
      "rule": "markdown",
      "file": "courses/why-the-sky-is-blue/lessons/scattering-light.yaml",
      "path": ["concepts", 1, "statement"],
      "message": "plain text, not Markdown: the math \"$1/\\\\lambda^4$\" would show literally; write it in words, or move it to a Markdown field"
    }
  ]
}
```

- `file` is relative to the content root.
- `path` is the YAML path inside `file`, as keys and array indexes. For a brief it is empty, and `message` starts with `line N: `.
- `rule` is the check area: `schema`, `files`, `markdown`, `references`, `placement`, `ids`, `citations`, `analogies`, `exercises`, `practice`, `checkpoints`, `coverage`, `shape`, `policies`, `copyright`, `audit` or `online`.
- A `schema` or `files` error stops the checks that need the whole course, so fix those first and run again.

### 7.2 The fix loop

1. Run `course:validate <id> --json`.
2. Fix every error, schema errors first. Read each `message` fully: YAML errors that unquoted prose causes, and keys split off by a comma in a `{ … }` mapping, end with a hint at the usual cause.
3. Run again until `ok` is `true`. Then read the warnings and fix those that are real.

The structure checks catch structure, not meaning. Before stage 5, re-read each exercise against the brief: does its concept tag fit, does its anchor point to where the answer is taught, and is exactly one option defensible? The trial found an off-topic concept tag this way that no rule could catch.

## 8. Audit evidence

The skill writes these in stage 5; `--publish` checks that they parse and cover the content. Their schemas are in [`lib/content/audit.ts`](../../lib/content/audit.ts).

- **`claims.yaml`:** `claims: [{ lesson, claim, source, locator, verdict }]`, with entries covering every source each lesson cites. `verdict` is `confirmed`, `labelled-uncertain` or `removed`. Verification re-reads the source at the locator in a separate pass, not the stage 3 notes.
- **`blind-solve.yaml`:** `exercises: [...]`, one entry per auto-marked exercise (every type but `short`), from a solver that saw only the rendered brief text, never the YAML.
  - `mc`, `scenario`: `{ exercise, options: [{ option, verdict, note? }] }`, a verdict (`defensible` or `indefensible`) on every option. Exactly one may be defensible, and it must be the key.
  - `spot`: the same shape, with a verdict on every sentence ("this is the faulty one") and every fix ("this fixes it").
  - `fill`: `{ exercise, answer }`, the solver's own answer, which must normalize to one of `accepted`.
- **`review.yaml`:** `findings: [{ area, issue, resolution }]`, with at least one finding per area: `consistency` (terms and notation), `policy` (spec §8) and `copyright` (quotes are brief, full texts are linked). An area with nothing to fix still gets a finding that says so. A finding without a resolution fails.

## 9. Display check

`npm run course:display-check <id>` (T21) renders every brief, exercise and recall prompt with the real screen components at 1280×800 and 390×844. It fails on horizontal page scroll, overflowing math, tables or figures, `.katex-error`, missing figures or console errors, and writes a screenshot of each failing element to `.pipeline/screens/<course-id>/`.

## 10. Worked example

[`why-the-sky-is-blue`](course-pipeline-example/courses/why-the-sky-is-blue/) is a real one-lesson mini-course, written against this document and the validator in the schema trial. It passes the structure checks with no warnings, and [`lib/content/validate.test.ts`](../../lib/content/validate.test.ts) keeps it that way. It has no `_audit/` folder: its claims have not been independently verified, so it is an example of form, not a publishable course.

It uses every exercise type, both pools a lesson can have plus checkpoint exercises, an analogy, two guesses, two misconceptions, display math, a table and a figure.

To validate it:

```bash
PLATO_CONTENT_DIR=docs/v1/course-pipeline-example npm run course:validate why-the-sky-is-blue
```

### 10.1 Excerpts

A concept and its two exercises. The `recall` exercise is a scenario; the `review` one is spot the error. Both tag only this concept and anchor where it is taught.

```yaml
concepts:
  - id: c-rayleigh
    statement: |-
      Air molecules are far smaller than a wavelength of light, so they scatter
      short wavelengths much more strongly: halving the wavelength makes the
      scattering 16 times stronger.
    recallPrompts:
      - prompt: How does Rayleigh scattering depend on wavelength?
        answer: Its strength goes as $1/\lambda^4$, so shorter wavelengths scatter far more.

exercises:
  - id: e-rayleigh-recall
    type: scenario
    concepts: [c-rayleigh]
    pool: recall
    scenario: |-
      You stand in a field on a clear day and look at a patch of sky well
      away from the Sun.
    prompt: Where does the blue light you see come from?
    options:
      - { id: e-rayleigh-recall-scattered, text: Sunlight scattered towards you by air molecules }
      - id: e-rayleigh-recall-sea
        text: Light reflected from the oceans
        misconception: m-ocean
      - { id: e-rayleigh-recall-glow, text: Air molecules glowing blue on their own }
    correct: e-rayleigh-recall-scattered
    explanation: Air molecules scatter short wavelengths out of the sunbeam in every direction, including towards you.
    anchor: a-rayleigh
```

The `statement` is plain text, so its math is in words; the recall `answer` is Markdown, so it can use `$1/\lambda^4$`. The wrong option that matches a misconception links to it, so the feedback can show the correction.

The matching part of the brief: an anchor, cited paragraphs, display math, an analogy, then a guess placed before the paragraph that answers it.

```markdown
## Small molecules prefer short waves

::anchor{#a-rayleigh}

Air is mostly nitrogen and oxygen molecules, … This is called *Rayleigh scattering*, after the physicist who worked out its rules in the 1870s. :cite[src-wiki-rayleigh]

The key rule is that the strength of the scattering depends steeply on wavelength. :cite[src-wiki-rayleigh]

$$
\text{scattering} \propto \frac{1}{\lambda^4}
$$

:::analogy{#an-ripples}
Think of ripples on a pond meeting a thin reed. …
:::

::guess{#g-ratio}

Blue light at about 450 nanometres is scattered roughly six times more strongly than red light at about 700, because $(700/450)^4 \approx 5.9$. :general[This follows from applying the fourth-power law to the two wavelengths.]
```

The analogy's `simplified` entry says where it breaks down:

```yaml
beyond:
  simplified:
    - id: s-ripples
      text: |-
        The ripple analogy treats light as a simple wave meeting a small
        obstacle. It breaks down for the real mechanism: …
      analogy: an-ripples
      links: [ … ]
```

### 10.2 What the trial found

Written against the technical design alone, the example tripped on five things before it passed. What they were, and what changed:

| Trip | Change |
|---|---|
| `{ id: …, text: Sunlight has less violet than blue, and … }`: the comma split the text, and the error said only "Unrecognized key" | The loader now adds a hint when a key with spaces follows a comma in a `{ … }` mapping (§6, rule 2) |
| A lead-in sentence before display math had no citation | None: the rule is right. §5 now says lead-ins count |
| `$1/\lambda^4$` in a concept `statement` and a link's `adds`, which the app shows as plain text. The validator passed it | New `markdown` check: math, escaped dollars, code spans and citation directives are errors in plain-text fields (§4) |
| `statement: … strongly: halving …` failed YAML parsing with a message about compact mappings | YAML errors of the kinds prose causes now end with a hint about block scalars (§6, rule 1) |
| An exercise about the Moon's black sky tagged the sunset concept | None possible in the validator; §7.2 now asks for a meaning pass before stage 5 |
