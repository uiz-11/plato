# Plato — Technical Design (v1)

*Date: 2026-11-23. Status: ready for implementation.*

This document describes how Plato v1 is built. It implements [the product specification](product-specification.md) and [the wireframes](wireframes/index.html).

- **Citations.** "Spec F5" or "spec §7" points to the specification. "WF-A2" points to a wireframe screen, and "WF-C1.3" to note 3 on that screen. The prefix keeps wireframe screens F1–F3 apart from spec features F1–F9. "Spec F2.3" is step 3 of F2. "R5" is a resolution in §13.
- **Formatting.** **Bold** marks buttons, *italics* mark statuses and menu items, quotes mark other on-screen text, and `code` marks identifiers.
- **Precedence.** Where this document and the spec disagree, the spec wins and this document is fixed. §13 lists every place where the spec left a decision open, and what we chose.

---

## 1. Summary

Plato v1 is one Next.js 16 app, run as a single Node process on one host, with one SQLite file for the learner's progress. Published courses are files in the repository (`content/`), validated in CI and never changed after publishing. The app calls no AI model. Course creation is an offline process, the *pipeline*, run by an operator. The app's only contract with it is a list of course requests going out and course folders coming back in.

Three design rules keep v1 small:

1. **Content is code.** A course is a reviewed, versioned folder of YAML and Markdown. There is no content database, CMS or import step.
2. **Derive, don't store.** Course, lesson, checkpoint and request statuses, mastery, session summaries, and everything Today shows are computed from a few progress rows by pure functions. Only facts are stored.
3. **One engine, no framework.** All learning rules (marking, scheduling, session assembly, statuses) live in `lib/engine/`: framework-free TypeScript with no I/O and no clock. Callers pass in `today` and `now`. The server runs the engine to decide and record. The player runs the same marking and queue functions to give instant feedback.

### 1.1 Goals

- Every feature F1–F9 of the spec, every wireframe screen WF-A1 to WF-I3, and the accessibility notes in WF-J.
- Progress saved at every step, including typed text (spec principle 6, WF-E8.1).
- No waiting. Answering, ticking and moving between items inside a unit happen without a server round trip (§8.4).
- A fully defined contract for the offline pipeline: inputs, outputs, quality gates and tooling (§11).

### 1.2 Non-goals for v1

- More than one learner, accounts, OAuth.
- Writing the course-creation skill. §11 defines only what it must do.
- Offline/PWA mode, notifications, email, i18n, analytics.
- Editing or versioning a published course.

§14 lists what code review should reject.

---

## 2. Key decisions

| # | Decision | Chosen | Main alternative and why not |
|---|---|---|---|
| D1 | Progress store | SQLite (`better-sqlite3`, WAL) with Drizzle ORM | Postgres: a network hop, operations and cost for one learner. `node:sqlite`: still experimental in Node 24. |
| D2 | Hosting | One container (`output: 'standalone'`) on a host with a persistent volume and daily volume snapshots (a small VPS, or one Fly/Railway machine) | Vercel: no persistent filesystem, so SQLite would need Turso/libSQL and a network hop per query. |
| D3 | Course content | Files in git: YAML for structure, Markdown with a closed set of directives for briefs | JSON: prose is painful to escape. MDX: runs authored content as code and fails at compile time, not at validation. Content in the DB: loses PR review and CI validation. |
| D4 | Auth | One long passcode (env var), exchanged for a signed, HttpOnly cookie, or sent as a bearer token by scripts | Accounts: one learner. No auth: the app is on the public internet. |
| D5 | Scheduling | SM-2-lite with three grades (§7.4) | FSRS: needs four grades, parameter fitting and a library. The spec asks for nothing it adds. |
| D6 | Rendering | `unified` (remark/rehype) on the server, with KaTeX for math, plain `<pre>` code blocks and pre-made SVG diagrams | Client-side Markdown or Mermaid: heavy client JS and unpredictable output. |
| D7 | Caching | `cacheComponents` **off**. Every page renders per request (the auth cookie makes it dynamic). Rendered content is memoized in process in production. | Cache Components: prerendering gains nothing when every page is personal, and it requires `connection()` before each SQLite read and Suspense around each progress read. |
| D8 | Mutations | Server Actions (`'use server'`), one transaction each. One production Route Handler: the pipeline export. | A REST or tRPC layer: a second API surface with no second client. |
| D9 | Player | The server owns the position. The page renders the current **unit** (the review block, a lesson step or part of one, or the checkpoint) with all its **items** (the prompts, questions or exercises it shows one at a time). The client steps through the unit locally and records each event in the background, in order. | A server round trip per screen: slow on a phone over mobile data. A client state store mirroring the server: two sources of truth. |
| D10 | Request status | Derived from content files (`published.json`, `not-built.json`) | The pipeline writing to the production DB: a second writer and a credential to protect. |

---

## 3. Architecture

```
                 ┌──────────────── Host (single Node process) ─────────────────┐
 Browser ──────► │ proxy.ts (cookie check) ─► Next.js App Router               │
  (desktop/      │   Server Components ──► lib/dal ──► lib/db (SQLite, WAL) ───┼──► daily volume snapshot
   phone)        │   Server Actions ─────► lib/engine (pure rules)             │
                 │                    └──► lib/content (read-only, memoized) ◄─┼── content/ (in the image)
                 │ GET /api/pipeline/requests (bearer passcode)                │
                 └───────────────────────────────▲─────────────────────────────┘
                                                 │ requests:export
 Operator machine:  offline course pipeline ─────┘ ──► content/courses/<id>/ ──► PR ──► CI ──► deploy
```

### 3.1 Code layout

```
app/                      routes (§8.1)
instrumentation.ts        runs DB migrations once at server start
proxy.ts                  optimistic cookie check
components/ui/            shadcn components (added with the shadcn CLI)
components/plato/         Plato components (§9)
lib/
  engine/                 pure learning rules: day, marking, schedule, mastery, lesson, session, today, status, labels
  content/                schema.ts (zod), load.ts, render.ts, normalize.ts
  db/                     schema.ts (Drizzle), client.ts (lazy getDb()), migrate.ts, migrations/
  dal/                    server-only reads and writes; every function calls requireLearner()
  auth/                   passcode, cookie signing
  clock.ts                now(), with a test-only offset (§10.1)
content/                  published.json, not-built.json, courses/<id>/
scripts/                  run as npm scripts: course:validate, course:publish, course:not-built, course:display-check, content:check, requests:export, db:backup
e2e/                      Playwright tests and fixture content
```

ESLint `no-restricted-imports` enforces the boundaries. `lib/engine` imports nothing from `lib/db`, `lib/dal`, `next` or React. `lib/dal` and `lib/db` start with `import 'server-only'`.

### 3.2 Stack additions

| Package | Use |
|---|---|
| `drizzle-orm`, `better-sqlite3`; `drizzle-kit` (dev) | DB access and migration generation. `better-sqlite3` is on Next's default `serverExternalPackages` list. |
| `zod` v4 | Content schema and Server Action input validation |
| `server-only` | Marks `lib/db` and `lib/dal`. Next handles it internally; Vitest aliases it to an empty module so DAL tests can import those files. |
| `yaml` | Parsing course files (YAML 1.2 core schema). Every value then passes through zod. |
| `unified`, `remark-parse`, `remark-gfm`, `remark-math`, `remark-directive`, `remark-rehype`, `rehype-katex`, `katex`, `hast-util-to-jsx-runtime` | Brief and inline Markdown rendering |
| `canvas-confetti` | The confetti bursts (WF-E7, WF-E8, WF-G3) |
| `vitest`, `@playwright/test`, `@axe-core/playwright`, `tsx` (dev) | Tests and scripts |
| shadcn components: `sidebar`, `card`, `badge`, `button`, `checkbox`, `radio-group`, `dropdown-menu`, `sheet`, `sonner`, `textarea`, `input`, `popover`, `separator`, `tooltip`, `skeleton` | All UI, per the wireframes' build note ("where a wireframe and shadcn differ, shadcn wins"). base-nova components compose with `render`, not `asChild`. |

`@types/node` moves to 24 to match the runtime.

---

## 4. Next.js 16 conventions we rely on

This Next.js version differs from older ones. Each item below was checked in `node_modules/next/dist/docs/01-app/`.

| Convention | Where documented | How we use it |
|---|---|---|
| Without `cacheComponents`, a Request-time API such as `cookies()` renders the route per request | `02-guides/caching-without-cache-components.md` | `requireLearner()` reads the cookie, so every page is dynamic. No `generateStaticParams`, `'use cache'` or `connection()`. |
| `proxy.ts` (formerly middleware) runs on Node. Without a `matcher` it runs on every request, static files included. | `01-getting-started/16-proxy.md`, `03-api-reference/03-file-conventions/proxy.md` | Optimistic redirect to `/unlock`. The matcher excludes `/unlock`, `/_next/static`, `/_next/image`, `/favicon.ico` and `/api/*` (Route Handlers authenticate themselves). |
| Server Functions are reachable by direct POST | `01-getting-started/07-mutating-data.md`, `02-guides/data-security.md` | Every action calls `requireLearner()` and zod-parses its input. |
| `refresh()` from `next/cache` works only inside Server Actions and returns the re-rendered route in the same round trip | `03-api-reference/04-functions/refresh.md` | Called by actions that change what the current page shows. |
| Actions are dispatched one at a time per client (not across tabs) | `02-guides/server-actions.md` | Player events arrive in order. Cross-tab conflicts are handled by the position check (§8.4). Nothing in the player calls an action on a timer, so a click never waits behind background saves. |
| `params` is a Promise; `PageProps<'/route'>` is a global helper | `03-api-reference/03-file-conventions/page.md` | All dynamic pages `await props.params`. |
| One root layout; route groups for different chrome | `03-api-reference/03-file-conventions/route-groups.md` (separate root layouts force a full reload) | `(shell)` and `(player)` groups under one root layout. |
| `instrumentation.ts` `register()` runs once and completes before the server handles requests | `03-api-reference/03-file-conventions/instrumentation.md` | `if (process.env.NEXT_RUNTIME === 'nodejs') await (await import('./lib/db/migrate')).migrate()`. Migrations are skipped when `NEXT_PHASE` is `phase-production-build`, which `next build` sets. |
| `useSelectedLayoutSegment` is a Client Component hook | `03-api-reference/04-functions/use-selected-layout-segment.md` | Used by the client `CourseTabs` component. |

`next.config.ts` adds:

```ts
output: 'standalone',
outputFileTracingIncludes: { '/*': ['./content/**', './lib/db/migrations/**'] },
outputFileTracingExcludes: { '/*': ['./content/**/_audit/**'] },
```

---

## 5. Course content

### 5.1 Package layout

```
content/
  published.json             { "courses": [{ "id", "requestId"?, "publishedAt" }] }   append-only
  not-built.json             [{ "requestId", "reason", "decidedAt" }]                 append-only
  courses/<course-id>/
    course.yaml              course, key questions, modules (with checkpoints), sources
    lessons/<lesson-id>.yaml structured lesson data
    lessons/<lesson-id>.md   the brief
    assets/*.svg             diagrams
    _audit/                  pipeline evidence (§11.3); committed, never loaded by the app
```

- **Drafts.** The app lists only courses in `published.json`. A folder that is not in the manifest is a draft. Drafts are loaded only with test hooks on (§10.1).
- **IDs** are kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`).
  - A course id is also its URL slug and is unique forever.
  - Ids inside a course (lessons, concepts, exercises, guesses, misconceptions, sources, anchors) are unique within that course across all kinds. Key questions are `q1`–`q5`.
  - The DB stores `(course_id, <local id>)` pairs as plain text, with no foreign keys into content.
- **Requests.** `requestId` is optional, so hand-written courses (the fixtures, §10.2) need no request.
- **Content root.** `PLATO_CONTENT_DIR` is resolved to an absolute path at start-up, defaulting to `<app root>/content`. The standalone server changes its working directory, so tests pass an absolute path. Content is read at request time, so tests can point the same build at fixtures.

### 5.2 Schema

`lib/content/schema.ts` is the contract with the offline pipeline. `Md` is inline Markdown: math, emphasis, code, `:cite` and content labels, with no block elements. Multi-line `Md` values are YAML block scalars (`|-`).

```ts
Course = {
  schemaVersion: 1, id: Id, requestId?: Uuid,
  title: string, coverLabel: string,   // ≤ 12 chars, shown on the cover tile (WF-C1, WF-H1), e.g. "mRNA"
  kind: 'standard' | 'mini',
  asOf: 'YYYY-MM',                     // header "as of Nov 2026"
  outOfScope: Md, policyNote?: Md,     // the one Syllabus line (spec F9)
  policies: Array<'broad'|'narrow'|'fast-moving'|'contested'|'health-legal-financial-safety'
                  |'unsettled'|'little-research'|'skill'>,   // spec §8; drives validation
  keyQuestions: Array<{ id: 'q1'..'q5', text: string }>,    // 3–5
  modules: Array<{ id: Id, title: string,
                   lessons: Id[],                            // ≥ 1, syllabus order
                   checkpoint: Id[] }>,                      // ordered checkpoint-pool exercise ids (§5.5)
  sources: Array<{ id: Id, group: string /* e.g. "Health agencies" */, title: string,
                   publisher: string, date: 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD', url: Url,
                   position?: string /* required under 'contested' */ }>,
}

Lesson = {
  id: Id, title: string,
  keyQuestions: QId[],                 // ≥ 1: the questions this lesson advances (step 5, Answers tab)
  whyThisMatters: Md,                  // 1–2 lines; the renderer appends "(Q2)" chips from keyQuestions
  hook?: { text: string, keyQuestion: QId },   // every lesson except the course's last has one
  concepts: Array<{ id: Id, statement: string, // the key point, one sentence (Recall tick list)
                    recallPrompts: Array<{ prompt: Md, answer: Md }> }>,  // 3–6 concepts; ≥ 1 prompt each
  guesses: Array<{ id: Id, prompt: Md, options: Opt[] /* 3–4 */, correct: Id, why: Md }>,  // 2–3
  misconceptions: Array<{ id: Id, belief: Md, correction: Md }>,
  beyond: {
    simplified: Array<{ id: Id, text: Md, analogy?: Id, links: Link[] }>,
    notCovered: Array<{ id: Id, topic: string, why: string, links: Link[] }>,
  },
  exercises: Exercise[],
}
Link = { title: string, url: Url, adds: string, minutes: int,
         level: 'intro'|'intermediate'|'advanced', recommended?: QId }
Opt  = { id: Id, text: Md, misconception?: Id }

ExerciseBase = { id: Id, concepts: Id[], pool: 'recall'|'review'|'checkpoint',
                 prompt: Md, explanation: Md, anchor: Id /* "In the brief" target */ }
Exercise = ExerciseBase & (
  | { type: 'mc',       options: Opt[] /* 3–4 */, correct: Id }
  | { type: 'scenario', scenario: Md, options: Opt[] /* 3–4 */, correct: Id }
  | { type: 'fill',     accepted: string[] /* ≥ 1 */ }            // prompt contains one blank: 3+ underscores
  | { type: 'spot',     sentences: Opt[] /* 3–4 */, faulty: Id, fixes: Opt[] /* 2–3 */, correctFix: Id }
  | { type: 'short',    sample: string /* ≤ 25 words */, checklist: string[] /* 2–4 */ } )
```

How the content maps to the spec:

- **One correct answer by construction.** `correct`, `faulty` and `correctFix` are single keys.
- **Pools** keep wording from repeating across contexts (R11).
  - `recall` exercises appear in step 4. `review` exercises are review versions. `checkpoint` exercises appear only in their module's checkpoint.
  - `recall` and `review` exercises tag exactly one concept, taught in the exercise's own lesson.
  - `checkpoint` exercises may tag several concepts from any lessons of their module. This is what makes a checkpoint cumulative (spec F6).
  - Short answers are allowed in `recall` and `checkpoint` only, because spec F8 defines review versions as recall prompts and automatically marked exercises.
- **Review versions.** A concept's versions are its recall prompts (self-rated) plus the `review` exercises tagged with it. The validator requires at least one of each, so every concept has at least two versions (spec §7).
- **Checkpoints** are authored per module as an explicit, ordered list of exercises: 6–12 for a standard course, 4–12 for a mini-course (about 3–9 minutes).
- **Derived lengths.** None of these is authored.
  - A lesson's reading time is its brief's word count ÷ 220, rounded up ("~7 min read", WF-E3).
  - The course length is the sum of the lesson and checkpoint estimates in §7.7. It is shown in minutes under an hour ("~40 min"), otherwise in hours rounded to the half hour ("~1 hr", "~4.5 hrs").
  - The lesson count ("12 lessons") is counted from the modules.
- **Schema versions.** Every course is `schemaVersion: 1`. A published course keeps its version, and its files are never rewritten, so a later breaking change adds an upcaster from v1.

### 5.3 Brief format

A brief is CommonMark plus GFM tables, `$…$` and `$$…$$` math, fenced code, `##`/`###` headings, and this closed directive set. Anything else is a validation error.

| Directive | Renders as |
|---|---|
| `# Title` (exactly once) | The brief heading (WF-E3) |
| `:cite[src-a,src-b]` | Citation chips "2", "4"; accessible name "Source 2" (WF-J). On the course page they link to `/courses/<id>/sources#s2`. In the player they open that page in a new tab, so the session is not left. |
| `:uncertain[…]`, `:general[…]`, `:contested[…]` | The wrapped claim followed by a bracketed content label, styled differently from status badges (WF-E3.2) |
| `::anchor{#id}` | A jump target for "In the brief" |
| `::guess{#g1}` | The "Your guess" box: the learner's pick next to the correct option, and `why` (spec F4) |
| `::misconception{#m-id}` | The "You might think …" box |
| `:::analogy{#id}` … `:::` | An analogy block. A `simplified` entry must reference it. |
| `::figure{src="x.svg" alt="…" caption="…"}` | An inlined SVG from `assets/` |

"Why this matters" renders above the body. "Beyond this lesson" renders after it from `beyond`: ≈ *Simplified* and ○ *Not covered* entries, each with its Go deeper links. Each link is tagged with what it adds, its effort and its level, and with *recommended* when set (spec F4).

Fenced code renders as a plain, horizontally scrollable `<pre><code>`. A literal dollar sign is written `\$`, because a single `$` starts inline math. Raw HTML, Markdown images and footnotes are rejected.

### 5.4 Rendering

`lib/content/render.ts` runs `remark-parse → remark-gfm → remark-math → remark-directive → remarkPlato → remark-rehype (no raw HTML) → rehype-katex`. `remarkPlato` turns directives into `plato-*` elements and resolves their ids against the lesson.

- **Memoization.** The expensive output is the final HAST tree. `getRenderedLesson(courseId, lessonId)` returns the brief and every inline `Md` field of the lesson as HAST.
  - In production it is memoized in a module-level `Map` for the life of the process. Content changes only on deploy, which restarts the process.
  - Outside production it is not memoized, so the pipeline's edit-and-check loop (§11.4) always sees the current files.
- **Per request**, `hast-util-to-jsx-runtime` turns HAST into React elements using a component map. Learner data reaches the map as ordinary props; for example, `plato-guess` receives the learner's pick for that guess.
- **Client props.** Rendered inline fields (prompts, options, explanations) are passed into client components as `ReactNode` props, so no Markdown or KaTeX code ships to the browser.
- **KaTeX CSS** is imported in the layouts that show content (course page, player, development preview). Its selectors are `.katex`-scoped, so keeping it loaded after navigation is harmless.
- **SVG figures** are inlined so they inherit `currentColor`. The validator rejects SVGs with `<script>`, `on*` attributes, external references or no `viewBox`.

### 5.5 Validation

`npm run course:validate <id> [--publish] [--json] [--online]`. Errors fail the run; warnings are printed. `--json` prints machine-readable findings with file and path, so the pipeline can fix them in a loop. The validator imports `normalizeAnswer` and the directive parser from `lib/content`, so it and the app cannot disagree. Simple count and length limits live in the zod schema; the table lists the remaining checks.

**Structure checks** (the default; the pipeline's stage-4 gate):

| Area | Checks |
|---|---|
| Schema | zod parse of every file; every lesson file belongs to exactly one module; no stray files |
| References | every `:cite`, `::guess`, `::misconception`, anchor, analogy, figure, key question, concept, option and checkpoint exercise id resolves |
| Placement | every guess and misconception is placed in its brief exactly once |
| Consistency | concept and misconception ids are unique across the course (spec §7: each concept is taught in one lesson, and each misconception is addressed in one) |
| Citations | every body paragraph and list item outside an analogy block has a `:cite` or a content label; every source is cited at least once |
| Analogies | every analogy block is referenced by a `simplified` entry (spec F4: "where each analogy breaks down") |
| Exercises | option texts are distinct. A fill-in prompt has exactly one blank, and its accepted answers are distinct after `normalizeAnswer`. A short-answer sample has ≤ 25 words. `recall` and `review` exercises tag exactly one concept of their own lesson; `checkpoint` exercises tag concepts of their module. Every `anchor` exists in the brief of a lesson that teaches one of the exercise's concepts. |
| Enough practice | per concept: ≥ 1 recall prompt, ≥ 1 `recall` exercise and ≥ 1 `review` exercise |
| Checkpoints | 6–12 exercises (4–12 in a mini-course), all from the `checkpoint` pool, each used by exactly one checkpoint, covering every lesson of the module |
| Coverage | every key question is advanced by ≥ 1 lesson; every lesson except the last has a hook, and the last has none |
| Course shape | a mini-course has exactly 1 module and 1–2 lessons; at most one `recommended` link per lesson. Warnings: 2–3 Go deeper links per lesson, and a brief of 700–1,800 words. |
| Policies | `narrow` requires `kind: 'mini'`. `contested` requires ≥ 1 `:contested` label and ≥ 2 distinct source `position`s. `health-legal-financial-safety`, `skill` and `little-research` require a `policyNote`. |
| Copyright | blockquotes are ≤ 40 words. Other quotation is checked in the pipeline's review (§11.3). |

**Publish checks** (`--publish`): the audit files exist, parse, and cover the content (§11.3).

`--online` additionally checks that every URL returns 2xx. It is never run in CI.

### 5.6 Publishing and immutability

- **Publishing is a pull request.** `npm run course:publish <id>` runs `course:validate --publish` and appends the manifest entry. The operator commits the course and the manifest change and opens a PR.
- **CI runs `npm run content:check`**, which compares the branch with its merge base on `main`:
  - existing entries in `published.json` and `not-built.json` are unchanged (both files are append-only);
  - no file under a published course's folder is changed or deleted;
  - every course newly added to `published.json` passes `course:validate --publish` and the display check (§11.4).
- **Fixes.** A mistake in a published course is fixed by publishing a corrected course under a new id. Progress does not carry over.

---

## 6. Data model

SQLite, one file at `PLATO_DB_PATH`, WAL mode, `foreign_keys=ON`.

- `lib/db/client.ts` opens the file lazily on first use (`getDb()`), so `next build` never creates a database.
- Times are integer epoch milliseconds (`*_at`). Learning days are `YYYY-MM-DD` text (`*_day`, §7.1). Ids into content are text.
- Tables are defined in `lib/db/schema.ts`. Migrations are generated by `drizzle-kit generate`, committed, and applied at server start by `instrumentation.ts`.

| Table | Columns | Keys and notes |
|---|---|---|
| `settings` | `id` (=1), `session_minutes` (10/15/20/30, default 15), `hide_timer` (bool), `updated_at` | One row |
| `course_request` | `id` (UUID), `text`, `created_at` | Status is derived (§7.9). |
| `lesson_progress` | `course_id`, `lesson_id`, `skipped`, `position` (JSON `LessonPosition`, null if never entered), `recall_text`, `recall_ticked` (JSON), `recall_queue` (JSON), `last_session_id`, `completed_at`, `completed_day`, `updated_at` | PK (`course_id`, `lesson_id`). No row means *Not started*. Created when the lesson's first unit loads in a session, or when it is skipped. |
| `guess_answer` | `course_id`, `lesson_id`, `guess_id`, `option_id`, `answered_at` | PK (`course_id`, `lesson_id`, `guess_id`). Shown in the brief (spec F4). |
| `attempt` | `id` (client UUID), `session_id`, `context` (`recall`/`review`/`checkpoint`), `course_id`, `concept_id` (for recall and review; null for checkpoint, whose concepts come from content), `exercise_id` (null for a recall prompt), `response` (JSON), `correct` (bool; null when self-rated or self-marked), `confidence` (`sure`/`not_sure`/`guess`; null when self-rated or self-marked), `self_mark` (`full`/`partial`/`none`), `grade` (`forgot`/`partly`/`remembered`; for a recall prompt, the learner's rating), `is_retry`, `day`, `answered_at` | PK `id`, so a re-sent event is idempotent. Indexes: (`course_id`, `exercise_id`), (`context`, `day`), (`session_id`). Append-only. |
| `concept_schedule` | `course_id`, `concept_id`, `lesson_day`, `due_day`, `interval_days`, `ease`, `last_event_day`, `later_day_reviews`, `last_grade`, `version_cursor` | PK (`course_id`, `concept_id`); index `due_day`. Created when the concept's lesson is completed (§7.4). |
| `answer_note` | `id`, `course_id`, `key_question_id`, `lesson_id` (null when added on the Answers tab), `text`, `created_at`, `updated_at` | Index (`course_id`, `key_question_id`, `created_at`). Hard delete. |
| `draft` | `key`, `text`, `updated_at` | PK `key`: `recall:<course>:<lesson>`, `short:<course>:<exercise>` or `note:<course>:<lesson>:<kq>`. Deleted when its text is submitted. The recall draft becomes `lesson_progress.recall_text` when the learner moves on to tick. |
| `session` | `id`, `kind` (`standard`/`reviews_only`/`full_lesson`), `minutes`, `course_id` (null for a session without a target), `review_queue` (JSON), `checkpoint_queue` (JSON), `position` (JSON `SessionPosition`), `last_event_id`, `active_ms`, `started_at`, `ended_at` | At most one session has `ended_at` null. Starting a new one closes the old one. |
| `shown_up_day` | `day` | PK. `INSERT OR IGNORE` with every progress event (§7.1). The counter on Today is `COUNT(*)`. |

**Stored vs derived.**
- *Stored:* what the learner did (positions, answers, notes, ratings) and the schedule. The schedule depends on the order of past events, so recomputing it would need a replay engine.
- *Derived on read:* every status, mastery, when each course was last used (§7.6), the next target, checkpoint progress and score, session summaries (§7.7), Today's card and line, daily-cap usage, and the "back after a break" state.

---

## 7. Learning engine (`lib/engine`)

Pure functions with no I/O and no clock. The server calls them inside the transaction that records an event. The player calls the marking and queue functions for instant feedback. Constants live in `lib/engine/constants.ts`.

### 7.1 Days and showing up

- **Learning day.** The local date in `PLATO_TIME_ZONE` (an IANA name, default `UTC`), with the day starting at **04:00** (`DAY_START_HOUR = 4`), so a 01:00 session counts as the previous day.
- **Showing up** on a day means recording at least one progress event that day. Progress events are the player events in §8.4 (all except `continue` and `budget-end`) and a skip from the Syllabus. Opening the app and notes edited on the Answers tab do not count. The counter on Today (WF-A1.4) only grows.

### 7.2 Marking (spec F5)

```ts
normalizeAnswer(s) = s.normalize('NFKC').toLowerCase().replace(/[\p{P}\s]/gu, '')
```

| Type | Correct when |
|---|---|
| Multiple choice, scenario | the picked option is `correct` |
| Fill in the blank | `normalizeAnswer(input)` equals `normalizeAnswer(a)` for some accepted `a`. Submitting stays disabled while the input normalizes to an empty string. |
| Spot the error | the picked sentence is `faulty` **and** the picked fix is `correctFix` |
| Short answer | self-marked: every checklist point ticked → `full`, some → `partial`, none → `none` |

The client marks at once for feedback. The server marks again from content with the same function and stores its own result.

**Grade.** Every practice event maps to one of three grades:

| | Sure | Not sure | Guess |
|---|---|---|---|
| Correct | `remembered` | `partly` | `forgot` (spec F5: a correct Guess counts as not yet learned) |
| Wrong | `forgot` | `forgot` | `forgot` |

- Short answers: `full` → `remembered`, `partial` → `partly`, `none` → `forgot`.
- Recall prompts: the learner's rating is the grade.

**Explanation.** It opens automatically unless the answer is correct with *Sure*; then it is one click away behind "Why?" (spec F5, WF-F3.1). Short answers always open it.

**Wrong *Sure* re-queue.**
- The same exercise is inserted three items later in the current block (reviews, Recall exercises or checkpoint), or at the block's end if fewer items remain. This happens at most once per exercise per session.
- The block's total grows by one ("Review 5 of 10"). The grown queue is saved with the answer (`review_queue`, `recall_queue` or `checkpoint_queue`), so a reload keeps the retry.
- The retry is stored with `is_retry = true` and does not affect the schedule, mastery or the checkpoint score. A retry not reached before the session ends is dropped.

### 7.3 Lessons (spec F4)

**Position** is the finest resumable point. `answered` holds the attempt id once the current item is answered, so a reload shows its feedback instead of asking again.

```ts
type LessonPosition =
  | { step: 'warmup'; index: number }
  | { step: 'guess'; index: number }
  | { step: 'read' }
  | { step: 'recall'; phase: 'write' }
  | { step: 'recall'; phase: 'tick' }
  | { step: 'recall'; phase: 'exercises'; index: number; answered?: string }
  | { step: 'answers'; index: number }      // index into the lesson's key questions
  | { step: 'done' }
```

**Status** is derived: *Completed* if `completed_at` is set; else *Skipped* if `skipped`; else *In progress* if a row exists; else *Not started*.

**Skipping** (spec F4):
- **Skipping** (*Mark as skipped*) sets `skipped` on any lesson that is not *Completed*, keeping `position`. It is available from the Syllabus ⋯ menu and from the player's ⋯ menu during the lesson.
- **Undo** (the toast after skipping) and *Unskip* (the Syllabus ⋯ menu on a *Skipped* row) clear `skipped`. If the row was created by the skip (`position` is null), they delete it instead, so a course whose only change was that skip returns to *Ready*.
- **Resuming.** When a *Skipped* lesson is loaded as a session target, `skipped` is cleared and the lesson continues from `position` (spec F4: "picking up where you stopped").

**Steps in order:** Warm up → Guess first → Read → Recall (write, then tick, then exercises) → Add to your answers → done. Warm up is left out when no other lesson in this course is *Completed*.

- **Warm up.** The source is the other lesson in this course with the latest `completed_at` (ties go to the later lesson in syllabus order; spec F4: "the lesson you last *Completed*"). The warm-up shows the source lesson's first three concepts in authored order, each with its first recall prompt. It changes nothing in the schedule.
- **Recall exercises.** `n = clamp(missed, 2, 3)`, where `missed` is the number of unticked key points.
  - Candidates are the lesson's `recall` exercises in authored order. "Unused" means not already chosen for this queue.
  - Take, in authored concept order, the first candidate for each missed concept. Fill any remaining places with unused candidates on missed concepts, then with unused candidates on any concept. Stop at *n*.
  - If nothing was missed, take the first two candidates. A lesson has at least three candidates (one per concept), so the queue always fills.
  - The queue is fixed when the ticks are submitted (`recall_queue`).
- **Add to your answers.** One *board* per key question the lesson advances: the key question, its earlier answer notes and a blank sticky note (WF-E6). **Stick it** saves an answer note and moves to the next board. **Skip this step** skips every remaining board.
- **Completion.** A lesson becomes *Completed* when step 5 is finished or skipped (position `done`; R1).
  - That transaction creates the lesson's `concept_schedule` rows (§7.4), and the celebration (WF-E7) follows.
  - Recall and step 5 form one budget unit (§7.7), so they normally run together. If the learner leaves during step 5, the next session resumes there.
- **Celebration line** (spec F4, WF-E7.1). Let *M* be the next lesson in syllabus order.
  - If this completion makes every lesson in the module *Completed*: "Checkpoint *N* is open."
  - Otherwise, on any lesson but the course's last: the hook, prefixed with "Next, Lesson *M*:" when *M* is not *Completed*.
  - Otherwise no line.
- **`last_session_id`** is set each time one of the lesson's units loads, and on `skip-lesson`. "Picking up where you stopped" (WF-E4.1) shows above the first item when the value before that update was an earlier session. A lesson counts as *skipped during a session* when `skipped` is set and `last_session_id` is that session.

### 7.4 Scheduling (spec F8)

```ts
EASE_START = 2.5; EASE_MIN = 1.3; EASE_MAX = 2.8; MAX_INTERVAL_DAYS = 180; DAILY_CAP = 30
```

**On lesson completion** (day *D*), each concept gets a row with:
- `lesson_day = last_event_day = D`, `ease = EASE_START`, `later_day_reviews = 0`, `last_grade = null`, `version_cursor = 0`;
- `interval_days = recalled ? 2 : 1` and `due_day = D + interval_days`.

*Recalled* means the concept's key point was ticked and no Recall exercise on it was graded `forgot`. This sets spec F8's "1–2 days" (R2). Recall exercises affect only this first interval.

**On a review event** on a day after `last_event_day`, with `elapsed = today − last_event_day`:
- `remembered`: `interval = min(MAX_INTERVAL_DAYS, max(interval + 1, round(max(interval, elapsed) × ease)))`; `ease += 0.10`
- `partly`: `interval = max(1, round(interval × 1.2))`; `ease −= 0.15`
- `forgot`: `interval = 1`; `ease −= 0.20`
- Then clamp the ease, and set `due_day = today + interval`, `last_event_day = today`, `later_day_reviews += 1` and `last_grade = grade`.

**Same-day events.** Only the first event on a day updates the schedule. A later `forgot` on the same day sets `due_day = min(due_day, today + 1)`.

**What counts as a review event:**
- review items;
- checkpoint answers, once for each concept the exercise tags, when that concept's `lesson_day` is before today (a real later-day retrieval, spec principle 4).

Warm-ups, Guess first and retries never count.

**Version rotation.** Assembly shows `versions[version_cursor % n]`. The cursor increments when the review is answered, not at assembly, so an abandoned session skips no versions. The same version therefore never appears twice in a row. Versions are ordered recall prompts first, then `review` exercises, in authored order.

**Daily cap.** At most `DAILY_CAP` review items a day across all courses. They are counted as `attempt` rows with `context = 'review'`, the current day and `is_retry = false`. Checkpoint answers do not count toward the cap.

**After a break of 14 days or more**, the cap and most-overdue-first ordering spread the backlog over the following days (spec F8). Today shows "Welcome back" (WF-A2).

### 7.5 Mastery (spec F8, F6)

| Mastery | Rule (first match) | Meter (WF-C1, WF-G2) |
|---|---|---|
| *Not yet reviewed* | `later_day_reviews = 0` | 4 faint empty dots |
| *Shaky* | `last_grade = forgot` or `interval ≤ 2` | 1 of 4 filled |
| *Strong* | `last_grade = remembered` and `interval ≥ 14` | 4 of 4 filled |
| *Good* | otherwise | 3 of 4 filled |

Mastery is how well the learner *currently* remembers a concept (spec §4). If `today − due_day > interval`, the level drops one step (Strong → Good → Shaky). *Not yet reviewed* never drops.

### 7.6 Course status, numbering and the next target

- **Numbering.** "Lesson *N*" is the lesson's 1-based position across the whole course in syllabus order. "Checkpoint *N*" is its module's 1-based position.
- **Course status.** *Complete* when every lesson is *Completed* and every checkpoint *Done*. *In progress* when any lesson has a row. *Ready* otherwise.
- **Last used.** A course's last-used time is the later of its latest `lesson_progress.updated_at` and the `started_at` of its latest session (`session.course_id`). It orders *In progress* rows and picks the course Today continues.
- **Checkpoint status.**
  - *Locked* until every lesson in its module is *Completed*, then *Open*.
  - *Done* once every checkpoint exercise has a non-retry attempt (spec F6). Answers carry over between sessions.
  - When a checkpoint becomes a session's target, `checkpoint_queue` is set to its authored order minus the exercises already answered. The progress label counts answers from every session ("5 of 10"). In a checkpoint the total stays the number of exercises, and a retry shows as "Retry · 5 of 10".
- **Checkpoint score** (WF-G2: "7 of 10 right"): first attempts that were correct, counting a short answer as right when self-marked `full`, over the number of exercises.
- **Next target** of a course (spec F8):
  1. its first *Open* checkpoint in syllabus order;
  2. otherwise the first lesson in syllabus order that is *Not started* or *In progress*;
  3. otherwise the first *Skipped* lesson;
  4. otherwise none.

  Inside a session, lessons skipped during that session are not eligible, so skipping from the player never re-targets the same lesson.
- **Main button** (spec F3): "Open Checkpoint *N*" when a checkpoint is the target, "Start Lesson 1" when the course is *Ready*, and "Continue Lesson *N*" otherwise. A *Complete* course has no main button and shows a *Complete* badge (R6).

### 7.7 Sessions (spec F8)

**Estimates** in seconds. They are used only for sizing, the soft budget and course length.

```ts
EST = { review: 30, warmupPrompt: 40, guess: 30, read: readMinutes * 60,
        recallWrite: 90, recallTick: 30, recallExercise: 45, answersBoard: 45, checkpointExercise: 45 }
```

**Assembly** at session start:

1. **Due list.** Concepts with a `concept_schedule` row, `due_day ≤ today` and no review event today. Sorted by `due_day` ascending (most overdue first), then `last_event_day`, then id. `capLeft = DAILY_CAP − reviews answered today`.
2. **Number of reviews:**
   - `standard` with a target: `min(capLeft, due, floor(minutes × 60 / 2 / EST.review))`, so up to 15 in a 15-minute session;
   - `standard` with no target: `min(capLeft, due, floor(minutes × 60 / EST.review))`;
   - `reviews_only`: `min(capLeft, due, 6)`, about 3 minutes;
   - `full_lesson`: none.
3. **Course and target.**
   - If `startSession` is given a `courseId` (the course page's main button, or Today's "Start Lesson 1"), that course becomes `session.course_id`, whatever its status. This makes it the course Today continues (spec F3).
   - Otherwise `session.course_id` is the most recently used course that is *In progress*, or that is *Ready* and is the `course_id` of an earlier session. It is null if there is none.
   - The target is that course's next target. `full_lesson` takes the next lesson by the same rule but ignoring checkpoints (R9).

The review list, with each item's chosen version, is stored in `session.review_queue`, so a reload shows the same reviews.

**Session position:**

```ts
type SessionPosition =
  | { unit: 'reviews'; index: number; answered?: string }
  | { unit: 'lesson'; lessonId: string }                   // detail lives in lesson_progress.position
  | { unit: 'checkpoint'; moduleId: string; index: number; answered?: string }
  | { unit: 'end'; screen: 'course-complete' | 'summary' }
```

**Soft budget** (spec F8: "the current step finishes first"; WF-J: "time is a soft budget").
- `active_ms` counts time while the tab is visible.
- Budget units are: the review block, each lesson step (Warm up, Guess first, Read, and Recall together with step 5), and each checkpoint exercise.
- A budget unit starts only if `remaining ≥ EST(unit) / 2`, where `remaining = minutes × 60 − active_ms / 1000` seconds. Otherwise the session ends.
- The server applies the rule in `finishUnit`, at budget-unit boundaries only, so the step from Recall tick to Recall exercises is never cut. Between checkpoint exercises, which share one player unit, the client applies the same engine function before each exercise. When it fails, the client sends `budget-end` (§8.4), and the server checks again and ends the session.
- When a target finishes, the next target is recomputed within `session.course_id` and the session continues under the same rule. Completing a module's last lesson can therefore lead straight into its checkpoint. When the course has no target left, the session ends.
- A checkpoint's mastery summary always follows its last exercise, with no budget check.
- **`full_lesson`** ignores the budget, ends when its lesson completes, and never continues into a checkpoint. Its timer shows elapsed time.

**Skipping mid-session.** *Mark as skipped* in the player's ⋯ menu skips the current lesson, shows the Undo toast and moves on to the next target under the budget rule. Undo returns to the lesson at its saved position.

**Ending.** A session ends on its end screens (WF-E8), including when the learner leaves early with **×** (R8). Entering `{unit: 'end'}` sets `ended_at`. If the session made the course *Complete*, the course-complete screen (WF-G3) comes before the summary.

**Summary line** (`lib/engine/labels.ts`), derived from the session's rows:
- *Lessons:* completed in this session if `completed_at` falls within the session; *part of* a lesson if its `last_session_id` is this session and it was not completed.
- *Checkpoint:* "Checkpoint *N*" if this session's answers made it *Done*, otherwise "{k} exercises of Checkpoint *N*", from the session's checkpoint attempts.
- *Done part:* "{n} review(s)" when *n* > 0, followed by the work in syllabus order, joined by commas and a final "and". Consecutive completed lessons collapse to a range ("Lessons 1–3"). The first word is capitalized. With nothing recorded, it is "Nothing recorded".
- *Next part:* "Next time, {T}.", with *T* in Today's format (§7.8), or "Next time, just reviews."
- Examples: "9 reviews and Lesson 4. Next time, Lesson 5." "Part of Lesson 1. Next time, Lesson 1 from Read."

**Keep going** starts a new `standard` session and is shown only when that session would hold reviews or a target. **Back to Today** returns home.

**Ended sessions.** An ended session's URL shows its end screens while it is the most recent session, so the summary survives a reload. Once a newer session exists, the URL redirects to Today.

### 7.8 Today (spec F8, WF-A1, WF-A2)

**Session line** (WF-A1): "*{n} reviews, then {T}*", where *T* is one of:
- "Lesson 4 from Recall": a lesson with a position, named by its current step (Warm up, Guess first, Read, Recall or Add to your answers), whether *In progress* or *Skipped*;
- "Lesson 5": a lesson with no position;
- "Checkpoint 1".

The line is computed for the remembered session length. With *n* = 1 it reads "1 review".

**Card** (first match wins):

| # | Condition | Card (WF-A2) | Actions |
|---|---|---|---|
| 1 | At least one shown-up day exists, the latest is ≥ 14 days ago, and there are due reviews or a target | "Welcome back. Overdue reviews are spread over the next few days." | **Start session** and length menu |
| 2 | A target exists and the session would hold reviews | "Your session: *{line}*" | **Start session** and length menu; **Reviews only**; **Full lesson** (shown when the target course has a lesson left) |
| 3 | A target exists, and no reviews fit | "Reviews done for today. Next: *{T}*." if a review was answered today or the cap is reached; otherwise "Next: *{T}*." | **Start session** and length menu; **Full lesson** (as in 2) |
| 4 | No target; reviews due and the cap not reached | "*{n}* reviews due" | **Start reviews** |
| 5 | No target; a *Ready* course exists | "*{title}* is ready", with "{n} lessons · {length}" | **Start Lesson 1** of the most recently published *Ready* course |
| 6 | No published course at all | "What do you want to learn?" | **Request course** |
| 7 | Otherwise | "All caught up. Next reviews {tomorrow / in *N* days}." "Tomorrow" when the cap is reached with reviews still due; the sentence is left out when nothing is scheduled. | **Request course** |

**Reviews only** is shown only when a review fits (reviews are due and the cap is not reached).

**Below the card:**
- *In progress* rows, most recently used first: "*k* of *n* completed", plus "· Checkpoint *N* open" when one is open.
- *Ready* rows: "{n} lessons · {length}".
- *Requested* rows: requests that are *Requested* or *Not built*, newest first. A *Not built* row shows its reason.

### 7.9 Requests (spec F1)

A request is *Published* if a manifest entry has its `requestId`, *Not built* (with its reason) if `not-built.json` lists it, and *Requested* otherwise. Published requests leave Today and the Library, and their course appears instead.

---

## 8. Application

### 8.1 Routes

```
app/layout.tsx                                  html, fonts, ThemeProvider, Toaster
app/(shell)/layout.tsx                          sidebar (desktop) / bottom tabs and "+" in the header (phone)
app/(shell)/page.tsx                            /                          Today (WF-A1, WF-A2)
app/(shell)/new/page.tsx                        /new                       New request (WF-B1)
app/(shell)/library/page.tsx                    /library                   Library (WF-H1)
app/(shell)/courses/[courseId]/layout.tsx       course header and CourseTabs (WF-C1 to WF-C3)
app/(shell)/courses/[courseId]/page.tsx         redirect → ./syllabus
app/(shell)/courses/[courseId]/syllabus/page.tsx
app/(shell)/courses/[courseId]/answers/page.tsx
app/(shell)/courses/[courseId]/sources/page.tsx
app/(player)/layout.tsx                         full window, no sidebar
app/(player)/session/[sessionId]/page.tsx       the player (WF-D to WF-G)
app/unlock/page.tsx                             passcode form
app/api/pipeline/requests/route.ts              GET, bearer passcode (§11.1)
app/dev/preview/[courseId]/page.tsx             test hooks only (§11.4)
app/api/test/clock/route.ts                     test hooks only (§10.1)
```

- **Course tabs** are a client `CourseTabs` component: a `<nav>` of links styled as tabs, with `aria-current="page"` on the active one (from `useSelectedLayoutSegment`). Each tab is its own URL, as in the wireframes' address bars.
- Unknown course ids call `notFound()`. Test-hook routes call `notFound()` unless test hooks are on.
- Lessons cannot be opened directly. A lesson is reached only as a session target (spec F3, F8).

### 8.2 Rendering and data flow

- Pages and layouts are Server Components that read through the DAL and render per request. Each route has a `loading.tsx` skeleton.
- **Client components** are limited to: `CourseTabs`, the session-length menu, the Syllabus ⋯ menu, the mastery disclosure, the sticky-note editor, the request form, the sidebar and phone tabs, and the player.
- **DAL** (data access layer: `lib/dal`, `server-only`). Read functions return view models shaped for one screen (`getTodayView`, `getSyllabusView`, `getPlayerUnit`, …). Each calls `requireLearner()`, loads progress rows and runs engine functions.

### 8.3 Server Actions

All live in `app/actions/*.ts` with `'use server'`. Each one calls `requireLearner()`, parses its input with zod, runs one SQLite transaction, records `shown_up_day` when it records a progress event, and returns a small result or throws a typed error.

| Action | Effect | After |
|---|---|---|
| `createRequest(text)` | Insert a request (10–2,000 characters; the form shows an inline error otherwise) | Returns `{ ok }`. The form shows the toast and calls `router.push('/')` (WF-B2). |
| `setSessionMinutes(m)`, `setHideTimer(b)` | Update settings | `refresh()` on shell pages. In the player, the frame updates locally. |
| `skipLesson`, `unskipLesson` | §7.3, from the Syllabus | `refresh()` |
| `undoSkip(sessionId, lessonId)` | The player's Undo toast: clears `skipped` (§7.3) and sets the session position back to `{ unit: 'lesson', lessonId }` | `refresh()` |
| `addNote`, `editNote`, `deleteNote` | Answer-note CRUD on the Answers tab | `refresh()` |
| `startSession({ kind, courseId? })` | Close any open session, assemble (§7.7), insert | `redirect('/session/<id>')` |
| `saveDraft(key, text)` | Upsert a draft | none |
| `recordEvent(sessionId, event)` | A progress event inside a unit (§8.4): check the expected position, apply it, move the position | none |
| `finishUnit(sessionId, event)` | The unit's last event: check, apply, choose the next unit or end the session (§7.7) | `refresh()` |
| `exitSession(sessionId, activeMs, drafts)` | Save drafts and `active_ms`, then move to the end screens (§7.7) | `refresh()` |

### 8.4 The player

`getPlayerUnit(sessionId)` returns the session's current **unit** with every item it contains, already rendered, with answer keys, plus the position inside it. Units are what the player loads at once. They are not the same as the budget units in §7.7: Recall is split across two units, and a checkpoint unit holds one budget unit per exercise.

| Unit | Items |
|---|---|
| Review block | each review in `review_queue` (WF-D1, WF-D2) |
| Warm up | its prompts (WF-E1) |
| Guess first | its questions (WF-E2) |
| Read | the brief (WF-E3) |
| Recall: write and tick | write, then tick (WF-E4, WF-E5) |
| Recall exercises and step 5 | the exercises in `recall_queue` (WF-F1 to WF-F3), one board per key question (WF-E6), then the lesson-complete screen (WF-E7) |
| Checkpoint | each exercise in `checkpoint_queue` (WF-G1), then the mastery summary (WF-G2) |
| End | course complete (WF-G3), then session complete (WF-E8) |

A client `<PlayerFrame>` wraps a client unit component keyed by `unitKey`, so local state resets with every unit.

**Events.** Every learner action is one event kind, applied in one transaction. It is sent with `recordEvent`, or with `finishUnit` when it ends the unit:

| Event | Writes |
|---|---|
| `warmup-next` | lesson position |
| `guess-lock` | `guess_answer`, lesson position |
| `read-done` | lesson position |
| `recall-write` | `recall_text` (and deletes the recall draft), lesson position |
| `recall-tick` | `recall_ticked`, `recall_queue`, lesson position |
| `answer` | `attempt`, schedule (§7.4), the grown queue after a re-queue, position (`answered`) |
| `answer-next` | position (next item) |
| `note-stick` | `answer_note` (and deletes its draft), lesson position; on the lesson's last board, also position `done` and completion (§7.3) |
| `answers-skip` | lesson position `done` and completion (§7.3) |
| `skip-lesson` (via `finishUnit`) | `skipped`; the server chooses the next unit (§7.7) |
| `budget-end` (via `finishUnit`) | nothing; the server checks the budget rule and ends the session (§7.7) |
| `continue` (via `finishUnit`) | session position only: it leaves a closing screen and chooses the next unit or end screen |

**Moving through a session:**
- **Inside a unit**, the client moves from item to item on its own. Answering marks the answer locally with the engine's functions and shows feedback at once. A wrong *Sure* is re-queued locally with the same engine function the server uses.
- **At the end of a unit** (**Next** on the last warm-up prompt or review, **Lock in guess** on the last guess, **Done reading**, **Practice what you missed**, **Stick it** or **Skip this step** on the last board, or **Next** on the last checkpoint exercise), the client calls `finishUnit`. The action calls `refresh()`, so the next view arrives in the same round trip. The button shows a pending state through `useTransition`.
- **Closing screens.** After the last board, the unit stays open at lesson position `done` and renders the lesson-complete screen (WF-E7). After the last checkpoint exercise, it stays open at `index` equal to the queue length and renders the mastery summary (WF-G2) from the updated schedule. **Continue** on WF-E7, WF-G2 and WF-G3 sends `continue`, the only event that moves on from a closing screen.

**Delivery and consistency:**
- Events go through a small client **outbox**, sent one at a time in order. A failed send is retried with the same payload before any later event is sent. After three failures the frame shows "Saving…" and keeps retrying; `finishUnit` waits for the outbox to drain.
- Every event carries a client-generated UUID, the expected position (the session position, plus the lesson position inside a lesson unit) and the current `activeMs`.
- The server first checks the UUID against `session.last_event_id` (and, for answers, `attempt.id`). Events arrive strictly in order, so a re-sent event is always the last one applied, and it returns `ok`.
- It then applies a new event, and stores its UUID as `last_event_id`, only if the expected position matches the stored one. If not (for example a second tab, or a session closed elsewhere), it ignores the event and the client calls `router.refresh()` to load the true state.
- A reload always restores the stored position, including an answered item's feedback.

**Typed text** (recall, short answers, notes):
- Every change is mirrored to `localStorage`, so a reload or a closed tab on the same device restores it at once.
- It reaches the server on blur (`saveDraft`), inside the event that submits it, in `finishUnit`, and in `exitSession`. Nothing is saved on a timer.
- On load, a `localStorage` copy newer than the server's wins. Drafts are deleted when their text is submitted.

**Timer.** It counts down from `minutes × 60 − active_ms` (elapsed time for `full_lesson`) and pauses while the tab is hidden. Reaching zero does nothing by itself; it only feeds the budget rule (§7.7). It is not a live region, so nothing is announced as it changes (WF-J).

**BriefSheet content.** `getPlayerUnit` includes each distinct brief the unit can point to, rendered once: the lesson's own brief in a lesson unit, and the briefs of the items' lessons in a review or checkpoint unit.

### 8.5 Security

- **Passcode.** `PLATO_PASSCODE` (at least 20 characters) and `PLATO_COOKIE_SECRET` are required in production; the server refuses to start without them or with a shorter passcode.
- **Cookie.** `/unlock` compares the passcode with `timingSafeEqual`, then sets an HttpOnly, Secure, SameSite=Lax cookie holding an HMAC-signed expiry one year out.
- **`requireLearner()`** verifies the cookie in every DAL function and Server Action. `proxy.ts` only redirects early. In development with no passcode set, the gate is off.
- **Pipeline endpoint.** Requires `Authorization: Bearer <PLATO_PASSCODE>` and returns only unresolved requests (§11.1).
- **Content.** Trusted, but still constrained: no raw HTML in Markdown, sanitized SVG (§5.4), and external links open in a new tab with `rel="noopener noreferrer"`.

---

## 9. Screens

All screens use stock shadcn components and the default type scale (text-sm body, text-xs meta, text-2xl and text-3xl headings), per the wireframes' build note. Dark mode comes from the existing theme provider and shadcn tokens, with no extra design work. Plato's own components live in `components/plato/`.

### 9.1 Components

| Component | Used in | Notes |
|---|---|---|
| `StatusDot` with its label | WF-C1, WF-H1 | Full, half, empty, dashed (skipped) or square (locked), always next to the status text (WF-J) |
| `MasteryMeter` | WF-C1, WF-G2 | Four dots plus the word (§7.5) |
| `CourseRow`, `CourseCard`, `RequestTile` | WF-A1, WF-H1 | One shape each. Request tiles are dashed and not clickable. |
| `ContentLabel`, `CitationChip` | briefs | Content labels are bracketed text, distinct from status badges |
| `PlayerFrame` | WF-D to WF-G | §9.2 |
| `StepsRow` | WF-E, WF-F | Five segments; step 5 dashed (optional); done and current steps marked with a symbol as well as shade. On phone, the text "Step 3 of 5 · Read" (WF-I2.1). Without a warm-up, the first segment reads "Warm up · none". |
| `RecallPrompt` | WF-D1, WF-E1 | The prompt and a **Show answer** button. Revealing shows the answer, then either the rating buttons (WF-D1: "How well did you remember?" Forgot, Partly, Remembered; keys 1/2/3) or **Next** (WF-E1, nothing recorded but the position). The reveal is local state; a reload shows the prompt unrevealed. |
| `ConfidenceButtons` | WF-D2, WF-F, WF-G1, WF-I3 | "How sure are you?" Sure, Not sure, Guess: equal weight, disabled until answered, keys 1/2/3 (off while focus is in a text field) |
| `Feedback` | WF-F1 to WF-F3 | The result line (§9.3), the explanation, the "In the brief" link, and Next. The option list marks the picked and the correct option with a symbol and text, not shade alone. |
| `BriefSheet` | WF-D, WF-F, WF-G | A read-only `Sheet` with the brief, scrolled to the anchor. It opens only after an answer is submitted (R3). |
| `StickyNote` | WF-C2, WF-E6 | A note card labelled with its lesson. Click or tap to edit or delete (`Popover`). |
| `Celebration` | WF-E7, WF-E8, WF-G3 | A decorative lucide icon, a heading, one line and a `canvas-confetti` burst. No confetti under `prefers-reduced-motion`. |
| `EmptyIllustration` | WF-A2 (first run and all caught up) | A decorative lucide icon in a muted circle (`aria-hidden`) |

### 9.2 Player frame

`PlayerFrame` shows × · title (with an optional subtitle and tag) · timer · ⋯, then a progress row, the item near the top and its actions at the bottom (WF-D).

| Context | Title | Subtitle and tag | Timer | Progress row |
|---|---|---|---|---|
| Review block | "Reviews then Lesson *N*" or "Reviews then Checkpoint *N*" (the step is not named), or "Reviews" with no target | — | time left | one segment per review; item label "Review 4 of 9 · {course title}" |
| Lesson | "Lesson *N* · {lesson title}" | the course title | time left | `StepsRow`; item labels "Warm up 1 of 3 · from Lesson 2", "Guess 1 of 2 · It's fine to be wrong", "Exercise 1 of 3 · {type}" |
| Checkpoint | "Checkpoint *N*" | course title; *open* or *done* | time left | item label "4 of 10 · Lessons 1–3" |
| Course complete | the course title | *complete* | none | none |
| Session complete | "Session complete" | — | minutes used ("15 min") | none |

- Exercise type labels: multiple choice, fill in the blank, spot the error, scenario, short answer.
- On phone, the subtitle is dropped and the title is truncated with an ellipsis (WF-I2).
- **× ("Exit session, progress saved")** calls `exitSession` (§7.7).
- **⋯** is a `DropdownMenu` with *Hide timer* / *Show timer* on every screen, and *Mark as skipped* while a lesson is the current unit.

### 9.3 Item flows and strings

- **Guess first (WF-E2).** Options as a `RadioGroup`, and **Lock in guess**, disabled until an option is picked. No confidence and no feedback.
- **Auto-marked exercise (WF-D2, WF-F1, WF-F3, WF-G1).** Answer, then a confidence button submits. Result lines:
  - correct with *Sure*: "Right", with the explanation behind "Why?";
  - correct with *Not sure*: "Right, but you weren't sure";
  - correct with *Guess*: "Right, but you guessed · Counts as not learned yet";
  - wrong: "Not quite · you said {Sure / Not sure / Guess}", plus "You'll see this again later this session" after a wrong *Sure*.
- **Spot the error (WF-G1).** "Part 1 · Which sentence is wrong?" and "Part 2 · Pick the fix" appear together as two `RadioGroup`s. Confidence stays disabled until both are picked. Feedback shows both picks.
- **Short answer (WF-F2).**
  1. A `Textarea` with a soft counter that warns past 25 words, and **Submit**, disabled while empty.
  2. Submitting shows "You wrote", the sample answer, "Tick what you covered" and the explanation.
  3. As points are ticked, the line reads "{k} of {n} · Fully / Partly / Not recalled".
  4. **Next** sends the `answer` event with its `self_mark`.

  The text stays a draft until Next, so a reload returns to the checklist.
- **Recall write (WF-E4).** "What do you remember?" with "Keywords are fine." **Check** sends `recall-write` and is allowed with empty text.
- **Recall tick (WF-E5).** "Tick what you recalled" lists the key points as checkboxes beside "You wrote". On phone, "You wrote" collapses above the list. The button reads "Practice what you missed ({n})", or "Practice ({n})" when nothing was missed.
- **Add to your answers (WF-E6).** "Optional", the key question, its earlier answer notes, and a blank sticky note ("what did this lesson add?"). Buttons: **Skip this step** and **Stick it**.
- **Lesson complete (WF-E7).** "Lesson *N* complete", the celebration line (§7.3), and **Continue**.
- **Mastery summary (WF-G2).** "Module *N* mastery", the score ("7 of 10 right"), then one row per concept of the module with its `MasteryMeter`, then **Continue**.
- **Course complete (WF-G3).**
  - The line "{n} lessons · {m} checkpoints · reviews continue for all {c} concepts".
  - Then each key question with "{k} notes" ("1 note" when there is one).
  - **Continue** goes to the session summary.
- **Session complete (WF-E8).** The summary line (§7.7), **Keep going** (when shown) and **Back to Today** (`router.replace('/')`).

### 9.4 Shell screens

- **Today (WF-A1, WF-A2).**
  - The "{n} days you've shown up" counter.
  - The length menu: a `DropdownMenu` radio group on desktop, a bottom `Sheet` holding a `RadioGroup` on phone (WF-I1). The choice saves immediately.
- **New request (WF-B1, WF-B2).**
  - One `Textarea` with the helper line. **Cancel** returns to Today.
  - **Request course** returns to Today with the toast "Request sent. It'll appear under Ready once it's built."
  - The new row shows the start of the learner's text, cut with an ellipsis.
- **Course header (WF-C1).** Cover tile with `coverLabel`, title, a status badge (*In progress* or *Complete*, shown in lowercase as in WF-C1), "{n} lessons · {length} · as of {Mon YYYY}", and the main button (§7.6).
- **Syllabus (WF-C1).**
  - First "{k} of {n} completed", then the out-of-scope line and the policy note in one line.
  - Then the modules, each with its lessons and a checkpoint row.
  - *In progress* lessons name their step ("In progress · at Recall").
  - A locked checkpoint says "Locked · complete Lesson *N*" when exactly one lesson is unfinished, and "Locked" otherwise.
  - A *Completed* lesson has a "Mastery" disclosure (collapsed by default) that lists its concepts with `MasteryMeter`s.
  - The ⋯ menu offers *Mark as skipped* on lessons that are not *Completed* or *Skipped*, and *Unskip* on *Skipped* lessons.
- **Answers (WF-C2).**
  - Under "Your notes. Not graded.", each key question shows "Lessons 1, 2, 3, 7" (the lessons that advance it), its answer notes as sticky notes, and an "+ Add note" sticky note.
  - A question with no answer notes shows only the "+ Add note" sticky note.
- **Sources (WF-C3).** Grouped by `group` in first-appearance order. Each source is numbered by its position in the course's source list, with its date, and each row has `id="s<n>"`.
- **Library (WF-H1).**
  - Sections in order: *In progress* (most recently used first), *Ready* (newest published first), *Complete* ("n of n completed ✓") and *Requested* (newest first).
  - Course cards show `coverLabel` on a neutral tile.
- **Phone (WF-I).**
  - A single column, with bottom tabs for Today and Library, and a "+" in the header for New request.
  - Submit, confidence and **Next** buttons are pinned at the bottom, with tap targets of at least 44 px, 8 px apart.
- **Accessibility (WF-J).**
  - Options are a `RadioGroup` (arrow keys). Tab then moves to the confidence buttons.
  - After submitting, focus moves to the result, then "In the brief", then Next. Each new item focuses its heading.
  - A polite `aria-live` region announces results, tick counts ("3 of 6 recalled", "Partly recalled"), step changes and toasts.
  - Citation chips read as "Source *n*". ≈ and ○ read as "Simplified" and "Not covered". The length menu is a radio group.
  - No state is shown by shade alone. Illustrations are decorative.

---

## 10. Testing

| Layer | Tool | What |
|---|---|---|
| Engine | Vitest, table-driven | Every cell of the grade table; `normalizeAnswer` cases; scheduling sequences (initial rows, remembered after a long gap, forgot, same-day events, ease clamps); mastery rows and decay; lesson positions; skip, undo and unskip from every status (including the row deletion); warm-up source after out-of-order completion; Recall exercise selection; re-queue placement and totals; session sizing for each kind and length; course choice with and without `courseId`; skipped-in-session exclusion; the budget rule at exactly half an estimate; every Today card and line; summary and label strings; course and checkpoint statuses and the score |
| Engine simulation | Vitest | 365 simulated days of one 15-minute session a day across two courses, with a 3-week break: the due backlog stays bounded and drains within two weeks of returning |
| Content | Vitest | The fixture course passes structure validation. Each validator rule is tested by one in-memory mutation of the fixture, listed in a table, that must fail with the right message. A renderer snapshot for each directive. |
| DAL and actions | Vitest on a temporary SQLite file with migrations applied | Each action's and event's writes; idempotent event ids; stale-position events ignored; `requireLearner` refusals |
| End to end | Playwright against the **standalone server** (§10.1) | (1) request → *Requested* on Today; (2) start a *Ready* course from Today → lesson through Recall → reload mid-typing → text restored → next day resumes; (3) skip and undo, from the Syllabus and from the player; (4) finish a module → next day → checkpoint → mastery summary; (5) add, edit and delete a note; (6) finish the fixture course → course complete → session summary; (7) one review, one exercise, the ticks and a sticky note using only the keyboard |
| Accessibility | `@axe-core/playwright` | One parametrized spec, set up in T01, with a row per screen. Each screen task adds its rows. No serious or critical violations. |

### 10.1 Test setup

- **Standalone server.** e2e runs `node .next/standalone/server.js` after copying `public/` and `.next/static/` beside it, with a fresh DB, `PLATO_CONTENT_DIR=$PWD/e2e/fixtures/content` and a test passcode. A global setup unlocks once and stores the cookie. The fixture directory has its own `published.json` and `not-built.json`.
- **Test hooks.** `PLATO_TEST_HOOKS=1` turns on: loading draft courses, the development preview route, and `POST /api/test/clock { days }`, which sets an offset added to `now()` so a test can move to the next day. The Docker image never sets it.
- **Viewports.** All journeys run in desktop Chromium. Journeys 2, 4 and 7 also run in a 390×844 mobile project.

**CI** is one GitHub Actions job on every PR: `lint`, `typecheck`, `test`, `content:check` (which runs the display check for newly published courses), `build`, a Docker image build with a start-up smoke check, and `e2e`.

### 10.2 Fixture courses

Two hand-written courses in `e2e/fixtures/content/`, also loaded in development. The main fixture has two modules, four lessons, every exercise type, every directive, math, code and a figure. The second is a mini-course. They serve as test data and demo content.

---

## 11. Offline course creation

The course-creation skill is out of scope for this document. This section defines everything around it, so the skill can be written against a fixed contract. The deliverables are tasks T07, T08, T20 and T21 in §15.

### 11.1 Requests out

- `GET /api/pipeline/requests` (bearer passcode) returns `[{ id, text, createdAt }]` for requests that are neither published nor listed in `not-built.json`.
- `npm run requests:export` calls it (with `PLATO_URL` and `PLATO_PASSCODE`) and writes one file per request to `.pipeline/requests/<id>.json`. The whole `.pipeline/` directory is gitignored.
- The pipeline never writes to the app's database.

### 11.2 Stages of course creation

Stages 1–5 are the skill's; stage 6 is the operator's. Working files go in `.pipeline/<requestId>/`. Each stage maps to a step of spec F2. The skill ends either with stage 5's gate passing, or with a not-build decision and its reason in `01-questions.yaml`.

| Stage | Input | Output | Gate before the next stage |
|---|---|---|---|
| 1. Key questions (spec F2.1) | the request | `01-questions.yaml`: 3–5 key questions, the §8 policies that apply, and a build or not-build decision with a one-line reason | Each question is specific, self-contained and answerable |
| 2. Scope (spec F2.2) | 1 | `02-scope.yaml`: kind (standard or mini), target length (the learner's, or about 5 hours by default), the module and lesson outline, concepts per lesson, the key-question map, the out-of-scope line and the policy note | Every key question is covered, each concept is in one lesson, and the estimated length (§5.2) fits the target |
| 3. Research (spec F2.3) | 2, plus sources the learner named | `03-sources.yaml`, and `03-notes/<source>.md` with section locators and short quotes only | Learner-named sources are used where suitable, then authoritative, open-access and recent sources, balanced across positions when contested (spec §8) |
| 4. Write (spec F2.4) | 2, 3 | A draft course folder in `content/courses/<id>/`. The skill chooses the course id (a short slug of the title, unique among published ids) and `coverLabel`, and sets `requestId` to the request's id. `course:publish` copies it into the manifest entry, which is what makes the request *Published* (§7.9). | `course:validate <id> --json` reports no errors |
| 5. Check (spec F2.5) | 4 | `_audit/claims.yaml`, `_audit/blind-solve.yaml` and `_audit/review.yaml` (§11.3); a passing display check (§11.4) | `course:validate <id> --publish` reports no errors, and the display check passes |
| 6. Publish (spec F2.6) | 5 | The operator runs `course:publish <id>`, which appends the manifest entry, and opens a PR (§11.5) | CI is green |

If stage 4 or 5 still fails after three attempts, or stage 1 decides not to build, the operator runs `course:not-built <requestId> "<reason>"`, which appends to `not-built.json`. The learner sees the reason (spec F1), so it is one plain sentence, such as "A support request, not a topic to learn" (WF-A1).

### 11.3 Audit evidence and quality gates

The validator checks that each audit file parses and covers the content. The skill fills them in.

- **`claims.yaml`:** for each lesson, entries covering every source cited in it. Each entry gives the claim, the source, a locator (section or page) and a verdict: *confirmed*, *labelled uncertain* or *removed*. Verification re-reads the source at the locator in a separate pass, not the stage-3 notes, so the check is not circular.
- **`blind-solve.yaml`:** one entry per auto-marked exercise id. An independent solver sees only the rendered brief text, never the YAML.
  - For multiple choice, scenario and spot the error, it gives a verdict on every option. The check fails if more than one option is defensible, or if the defensible one is not the key.
  - For fill in the blank, its own free answer must normalize to one of `accepted`.
- **`review.yaml`:** `findings: [{ area, issue, resolution }]`, covering consistency of terms and notation, policy compliance (spec §8), and copyright (quotes are brief, full texts are linked). A finding without a resolution fails the publish check.

How each spec §7 requirement is enforced:

| Spec §7 requirement | Enforced by |
|---|---|
| Cited | validator (paragraph level) and `claims.yaml` (claim level) |
| Verified | `claims.yaml` |
| Sound exercises | validator (structure) and `blind-solve.yaml` (one correct answer, answerable from the briefs) |
| Enough practice | validator |
| Consistent | validator (unique concepts and misconceptions) and `review.yaml` (terms and notation) |
| Covers every key question | validator |
| Displays correctly | display check, locally and in CI |
| Copyright | validator (blockquote length) and `review.yaml` |
| Spec §8 policies | validator (policy checks) and `review.yaml` (source balance, advice boundaries) |

### 11.4 Display check

`npm run course:display-check <id>` starts the app with test hooks on and loads the preview route. The route renders the course with the **real** screen components and fixed, fake learner state:

- every brief, with each guess revealed with a fixed pick;
- every exercise, with its feedback and explanation open;
- every recall prompt, with its answer shown.

How it checks:
- **Viewports:** 1280×800 and 390×844, in light mode.
- **Assertions:** no horizontal page scroll; only `pre` and `.katex-display` may scroll sideways; inline math, tables and figures fit the column; no `.katex-error`; every figure renders; no console errors.
- **Output:** a pass or a list of failures, with a screenshot of each failing element in `.pipeline/screens/<course-id>/` for the skill to inspect.

### 11.5 What the operator runs

1. `npm run requests:export`
2. The course-creation skill, once per request.
3. `npm run course:publish <id>`, or `npm run course:not-built <requestId> "<reason>"`.
4. Commit, open a PR, merge when CI is green, and deploy.

### 11.6 Pipeline documentation

`docs/v1/course-pipeline.md` restates §11 as the skill's brief. It includes:
- a pointer to `lib/content/schema.ts` as the schema of record;
- the directive reference (§5.3);
- YAML authoring rules (block scalars for prose);
- the validator's `--json` output format;
- the lesson written in the schema trial (T08) as a worked example.

---

## 12. Deployment and operations

### 12.1 Environment

| Variable | Required | Purpose |
|---|---|---|
| `PLATO_DB_PATH` | yes | SQLite file on the persistent volume |
| `PLATO_PASSCODE` (≥ 20 characters), `PLATO_COOKIE_SECRET` | production | Passcode gate and pipeline bearer token (§8.5) |
| `PLATO_TIME_ZONE` | no (default `UTC`) | The learner's time zone (§7.1) |
| `PLATO_URL` | operator machine only | The app's base URL, for `requests:export` (§11.1) |
| `PLATO_CONTENT_DIR` | no (default `<app root>/content`) | Content root, made absolute at start-up |
| `PLATO_TEST_HOOKS` | tests only | §10.1. Never set in the image. |

### 12.2 Runtime

- **Image.** A Dockerfile builds the standalone output and copies `public/` and `.next/static/` beside it. The container runs `node server.js`. Migrations run in `instrumentation.ts` before the server accepts requests.
- **One instance only**, always running, because SQLite has one writer. On Fly this means one machine with auto-stop off.
- **Backups.**
  - The host's daily volume snapshots are the primary backup. Fly volumes are snapshotted daily by default; on other hosts, the provider's snapshot feature is turned on.
  - `npm run db:backup` writes a consistent copy with `VACUUM INTO`, for manual backups and restore drills.
  - The README documents restoring from a snapshot or a backup file, and T22 performs the restore once.
- **Errors.** Server errors go to stdout. `error.tsx` boundaries show a plain retry message. There is no telemetry service.

---

## 13. Spec resolutions

Decisions where the spec is silent or ambiguous. Each is implemented as stated, and changing one is a spec change.

| # | Question | Resolution | Basis |
|---|---|---|---|
| R1 | When is a lesson *Completed*? | When step 5 is finished or skipped. Recall and step 5 form one budget unit, so they normally happen together. A step 5 left unfinished resumes next session. | Spec F4: "A completed lesson ends on a short celebration" and "You can stop after any step and pick up at the next one". Spec F7: notes "do not affect completion", which holds because step 5 can always be skipped. |
| R2 | How are the "1–2 days" before the first review chosen? | 2 days if the concept was recalled in step 4 (ticked, and no Recall exercise on it graded `forgot`), otherwise 1 | Spec F8 |
| R3 | "In the brief" points into the brief, but Recall hides it | The link opens the brief in a read-only sheet, only after an answer is submitted | Spec F4, F5 |
| R4 | Does a correct *Not sure* count as learned? | It grades `partly` | Spec F5 is silent |
| R5 | Do Recall and checkpoint exercises affect reviews and mastery? | Recall exercises set only the first interval. A checkpoint answer is a review event for each concept it tags that was completed on an earlier day. A checkpoint taken the day its module was finished therefore leaves those concepts *Not yet reviewed*. Warm-ups never count. | Spec F4 (warm-ups "do not change your review schedule"), F6 ("Not yet reviewed" in the summary), principle 4 |
| R6 | The course page's main button for a *Complete* course | No button; a *Complete* badge | Spec F3 lists only three labels |
| R7 | What is a day, and what counts as showing up? | A local day starting at 04:00. Showing up means at least one progress event (§7.1). | Spec F8; WF-A1.4 |
| R8 | Does leaving with × show the summary? | Yes, always. With nothing done it reads "Nothing recorded. Next time, …". | Spec F8: "Every session ends with a short summary"; WF-E8.1 |
| R9 | **Full lesson** when a checkpoint is *Open* | It runs the next lesson and ends with it. It is hidden when the course has no lesson left. | Spec F8: "the next lesson from where you left off" |
| R10 | The daily cap's value and the two-week break rule | 30 reviews a day. The cap and most-overdue-first ordering spread the backlog. | Spec F8 |
| R11 | Do review, Recall and checkpoint exercises overlap? | No: separate authored pools | Spec §7 "Enough practice"; avoids repeating wording |
| R12 | A note added on the Answers tab outside a lesson | Saved with no lesson label | Spec F7 |
| R13 | More than three key points missed | Three exercises in authored concept order. The 1-day first review covers the rest. | Spec F4 |
| R14 | A mini-course's checkpoint | Its single module still ends in a checkpoint, of 4–12 exercises | Spec §4: a module ends "with a checkpoint" |
| R15 | Can a *Skipped* lesson be un-skipped without starting it? | Yes: *Unskip* in the Syllabus ⋯ menu, which behaves like Undo | Spec F4 ("Skipping shows an undo option"); WF-C1.4 shows ⋯ on the *Skipped* row |
| R16 | Which course does a session continue? | The one in `session.course_id`, set from the main button or the most recently used course. A session never moves to another course. | Spec F3 ("The course becomes the one Today continues"), F8 |

---

## 14. Not building in v1

Reviewers should reject any of these in a PR:

- Accounts, a users table, a `learner_id` column, OAuth or roles.
- Postgres, Redis, queues, Cache Components, custom cache handlers, or more than one instance.
- Content in the database, a CMS or admin UI, course versioning, or moving progress between courses.
- Stored derived state: statuses, mastery, last-used times, summaries, or counters other than `shown_up_day`.
- A REST or tRPC API beyond the pipeline Route Handler, a client state library, websockets, or saving on a timer.
- FSRS, interval fuzz, leech detection, tunable scheduling, or fuzzy answer matching.
- Event sourcing or replay. The attempt log is append-only and is read only for counts, first attempts and summaries.
- Offline/PWA support, notifications, analytics, i18n or Storybook.
- Client-side Markdown or Mermaid, MDX, or stored rendered HTML.
- Schema-version upcasters before a second schema version exists.
- In-app pipeline triggers, webhooks, cron, or link checking in CI.

---

## 15. Tasks

Each task is one PR with its tests, and passes CI. "Done when" includes the §10 tests for that area. Every screen task also adds its rows to the axe spec and meets the WF-J rules that apply to it.

### 15.1 Task list

| ID | Task | Depends on | Done when |
|---|---|---|---|
| T01 | **Project setup**: Vitest (with the `server-only` alias), Playwright with the standalone-server setup (§10.1), the axe spec, `tsx`, ESLint import boundaries, scripts, `next.config.ts` (§4), shadcn components (§3.2), a placeholder home page, Dockerfile, CI workflow | — | CI runs every job, and the Docker image starts and serves the placeholder |
| T02 | **Database and clock**: Drizzle schema (§6), lazy client, migrations in `instrumentation.ts`, `clock.ts` with the test clock route | T01 | Migrations apply on start in the standalone image, and the test clock moves `now()` |
| T03 | **Auth**: `/unlock`, cookie signing, `requireLearner()` (cookie or bearer), `proxy.ts` with its matcher, start-up checks | T01 | Unit tests for signing pass; e2e: locked → unlock → placeholder home |
| T04 | **Content schema and loader**: zod schema, `normalizeAnswer`, manifest and draft filtering, citation numbering, derived lengths | T01 | Schema tests pass, and the loader returns typed courses from a directory |
| T05 | **Fixture courses** (§10.2) | T04 | Both parse with the schema |
| T06 | **Renderer**: unified pipeline, `remarkPlato`, KaTeX, code blocks, SVG inlining and sanitizing, inline fields, production memoization | T04, T05 | A snapshot test passes for each directive, and every fixture brief renders |
| T07 | **Validator and publishing**: `course:validate` (structure, `--publish`, `--json`), `course:publish`, `course:not-built`, `content:check` | T05, T06 | The fixture passes structure validation; every rule's mutation fails; `content:check` rejects an edited published course |
| T08 | **Schema trial and pipeline doc**: an agent authors one real lesson against the schema and validator; fix what it trips on; write `docs/v1/course-pipeline.md` (§11.6) | T07 | The lesson validates, schema and validator fixes are merged, and the doc is reviewed against §11 |
| T09 | **Engine: days, marking, schedule and mastery**, with the simulation test | T01 | §10 tests for these areas pass |
| T10 | **Engine: lessons, sessions and Today**: positions, statuses, skip/undo/unskip/resume, warm-up, Recall selection, completion, celebration line, numbering, last used, next target, assembly, budget rule, units, Today card and line, summary and labels, request status | T09 | §10 tests for these areas pass |
| T11 | **DAL and shell actions** (§8.2, §8.3 except the player) | T02, T03, T04, T10 | DAL tests pass on SQLite. Settings, requests and notes can start before T10. |
| T12 | **App shell**: group layouts, sidebar, phone tabs, Toaster, shared components (§9.1, except the player's) | T01 | Renders at desktop and phone widths |
| T13 | **Today, New request, Library** (WF-A1, WF-A2, WF-B1, WF-B2, WF-H1, WF-I1) | T11, T12 | e2e journey 1 passes, and every WF-A2 card state is seeded and checked |
| T14 | **Course page**: header, `CourseTabs`, Syllabus (mastery disclosure, ⋯ menu), Answers (note CRUD), Sources (WF-C1 to WF-C3) | T06, T11, T12 | e2e journeys 3 (Syllabus part) and 5 pass |
| T15 | **Player core**: `getPlayerUnit`, `recordEvent`, `finishUnit`, the outbox, start and exit, `PlayerFrame` with ⋯ and the timer, drafts, `RecallPrompt`, the review block (WF-D1), a plain session-complete screen | T06, T11, T12, T13 | A reviews-only session runs end to end; a reload resumes at the same item; typed text survives a reload |
| T16 | **Exercises**: the five types, `ConfidenceButtons`, `Feedback`, `BriefSheet`, re-queue (WF-D2, WF-F1 to WF-F3) | T15 | Each type answers, marks and resumes after a reload |
| T17 | **Lesson steps** (WF-E1 to WF-E7, WF-I2, WF-I3), including skipping from the player | T16 | e2e journeys 2 and 3 (player part) pass |
| T18 | **Checkpoint, course complete, session summary** (WF-G1 to WF-G3, WF-E8) | T17 | e2e journeys 4 and 6 pass |
| T19 | **Accessibility and phone audit** across all screens (WF-I, WF-J) | T13, T14, T17, T18 | e2e journey 7 passes, and the axe spec passes on every screen at both viewports |
| T20 | **Pipeline export**: `/api/pipeline/requests`, `requests:export` | T07, T11, T13 | A request made in the app appears in the export, and a *Not built* reason shows on Today |
| T21 | **Display check**: preview route, `course:display-check`, and its run in `content:check` | T07, T17, T18 | Passes on the fixture, and fails on a fixture with an overflowing formula |
| T22 | **Deployment**: production env checks, `db:backup`, snapshot setup, restore procedure, README | T02, T03 | A deployed instance keeps its data across a restart, and a restore from a backup file is performed once |

### 15.2 Order

- **Critical path:** T01 → T09 → T10 → T11 → T13 → T15 → T16 → T17 → T18 → T19. T21 ends at the same depth.
- **Parallel tracks after T01:**
  - platform: T02, T03, T12, T22;
  - content: T04 → T05 → T06 → T07 → T08;
  - engine: T09 → T10.

  The tracks join at T11. The rest of the order follows the "Depends on" column.
- **Milestones:**
  1. *Foundations* (T01–T10, T22): the engine and content tooling are complete and tested, and an empty app is deployed with backups.
  2. *Learnable* (T11–T18): the fixture course can be learned end to end on desktop and phone.
  3. *Launch* (T19–T21): the accessibility and phone audit, the pipeline export and the display check.

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| Unit boundaries feel slow on a phone far from the host | Inside a unit nothing waits on the server (§8.4). At boundaries the button shows a pending state, and server time is a few milliseconds with local SQLite. |
| A flaky connection drops progress | The outbox retries in order, the server deduplicates by event id, and typed text is mirrored locally (§8.4). |
| The native `better-sqlite3` module, migrations or content are missing from the standalone build | T01 builds the Docker image in CI, and e2e runs against the standalone server. |
| Authored content passes the validator but displays badly on a phone | The display check (§11.4) is a publish gate, run locally and in CI. |
| The schema is awkward for an agent to author | T08 trials it with a real agent-written lesson before the pipeline doc is final. |
| SM-2-lite intervals feel wrong in practice | All constants are in one file and covered by tests, including the simulation. A change applies from each concept's next review, with no data migration. |
| Up to a day of progress is lost if the volume fails | Accepted for one learner. `db:backup` can be run before risky operations. |
