# Plato — Product Design

> Status: draft · Date: 2026-11-22
> Scope: product shape, major features, and the core system design. Not an implementation spec.
> Features marked **(Later)** are designed here but are not part of the MVP (§9).

---

## 1. Vision

You name a topic you want to learn and the questions you want answered. Plato talks it through with you, researches the topic online and builds a complete course. When the course is ready, you learn in short sessions. Each lesson has five steps:

1. **Warm up**: recall the last lesson.
2. **Guess first**: answer a few questions before reading.
3. **Read**: a short, honest brief.
4. **Recall**: write down what you remember.
5. **Add to your answers**: build up your answers to your own questions.

A tutor is there whenever you need it, and a short daily review keeps what you learned from fading. The course ends when you can answer your own questions.

### Design principles

1. **Your questions are the contract.** The key questions agreed at intake are the course's acceptance criteria. The plan, lessons, practice and completion all trace back to them.
2. **Patient setup, instant learning.** Plato researches, writes and verifies the whole course before you start, and that can take a while. Once a course is ready, nothing in it makes you wait.
3. **Short core, honest edges.** Synthesized text gives the essential ideas briefly. Each lesson says what it simplified or left out, and where to find it.
4. **Retrieval over re-reading; delayed over immediate.** Practice exists to make memories stick. Delayed recall (§2.3) counts most toward mastery.
5. **High thinking, low typing.** Effortful recall matters; long typing does not. Answers can be fragments, taps or short phrases.
6. **Phone-first.** Every step works one-handed on a phone, in sessions of 10–30 minutes. Tap targets are large, and progress is saved at every step.
7. **Grounded and labeled.** Every claim traces to a source. Claims that are uncertain or contested are labeled, not hidden.
8. **You set the destination; Plato drives.**
   - Plato makes routine decisions without asking: which sources, how to explain, which question types, when to review.
   - It asks you to **decide** at only three moments: confirming your key questions, approving the course plan, and accepting or declining a change Plato proposes.
   - Anything else Plato offers is optional and never blocks you.
   - You can steer at any time in chat, for example "explain this more simply", "skip this lesson" or "add a lesson on X". Plato carries it out and shows what changed.
9. **Clean, standard inputs.** What you type is stored in a clear, grammatical, standard form, and your original wording is always kept. Your answers are graded on what you actually wrote.

### Scope

| Dimension | Decision |
|---|---|
| User | The owner, a self-directed adult learner. A single user, protected by one owner sign-in (§8). |
| Content | Text-based knowledge topics. Skill practice (languages, drawing, instruments) is out of scope. |
| Social | Solo. |
| Media | Text, including Markdown, LaTeX, code blocks and simple diagrams. |
| Devices | A responsive web app, installable on a phone as a PWA. |
| Business | None. |
| Stack | Next.js 16 (App Router), React 19, Tailwind 4, shadcn/ui. |

---

## 2. Core Concepts

### 2.1 Domain model

```
LearnerProfile
     │
LearningRequest (Draft → Planning → Approved)
     │   └── KeyQuestion[] ──> LivingAnswer (fragments + claim links)
     ▼
CoursePlan ── approved ──> Course (Building → Ready → In progress → Completing → Complete)
                             │
                             └── CourseVersion (one active)
                                   ├── CourseBlueprint (glossary, notation, concept ownership,
                                   │                    misconception assignment, analogies)
                                   ├── Module[] ──> Lesson[] (versioned)
                                   │                  ├── Prequestion[], Brief, ScopeNote,
                                   │                  │   CuratedLink[], ExercisePool, CuriosityHook,
                                   │                  │   WarmUp (lesson 1 only)
                                   │                  └── TutorThread[]
                                   └── CheckpointSet[] (one per module)

Concept ── taught by Lessons; linked to KeyQuestions; one ReviewCard per Concept
Source (snapshot) ──> Claim[] ──> cited by Briefs, Exercises
Misconception (from research) · PersonalMisconception (from your confident errors)
Attempt ──> ReviewCard schedule (FSRS) ──> ConceptMastery
CourseChange · ParkingLotItem · BuildStep · Notification
```

### 2.2 Entities

| Entity | Description |
|---|---|
| **LearnerProfile** | Your background, prior knowledge, default session length and daily time slot. Persists across courses. Explanations are tailored to your background. A preferred explanation style learned from your tutor questions and ratings is **(Later)**. |
| **LearningRequest** | The intake conversation and its structured result: topic, motivation, depth, time budget, pacing and constraints. Status is *Draft* (intake under way or saved for later), *Planning* or *Approved*. |
| **KeyQuestion** | A question you want answered. Stored in standardized form plus your original wording, with your optional *first take* (F1). Status (*open*, *partial*, *answered*) comes from its living answer's rubric (F7). |
| **LivingAnswer** | Your answer to one KeyQuestion. It is stored as your fragments and the lesson claims you linked, and Plato composes it into prose on demand. It has a rubric of 3–5 criteria. |
| **CoursePlan** | The recommended syllabus and alternative approaches, with projected key-question coverage, projected daily review load and pacing (target lessons per day). |
| **Course** | The built course and its lifecycle: *Building* → *Ready* → *In progress* (first lesson started) → *Completing* (final answers under way) → *Complete* (final answers graded). |
| **CourseVersion** | An immutable snapshot of the course's content. A course has exactly one active version, and a change builds a new version (F4). |
| **CourseBlueprint** | The course-wide plan the build writes before any lesson: glossary, notation, which lesson introduces each concept and which reuse it, which lesson addresses each misconception, and an analogy register. It keeps every lesson consistent. |
| **Module** | A group of related lessons, ending with a checkpoint. |
| **Lesson** | Versioned content: prequestions, brief, scope note, curated links, an exercise pool and a curiosity hook. Lesson 1 also has a built warm-up (F4). Status: *not started*, *in progress*, *completed*, *skipped* or *rebuilding*. |
| **Concept** | One atomic idea, e.g. "mRNA is degraded within days and never enters the nucleus". A lesson's *key points* are the concepts it teaches. Prerequisite links between concepts are **(Later)**. |
| **KeyQuestion–Concept link** | Which concepts a key question depends on. Built at the end of the course build. |
| **Source** | A stored snapshot of a source: extracted text, hash, as-of date and quality rating. Can be web or uploaded by you. |
| **Claim** | A factual statement with its origin: either *source* (a source and its exact cited passage) or *model knowledge* (no source, always labeled). Verification status is *verified* or *uncertain*. |
| **Misconception** | A commonly held wrong belief found in research and assigned to the lesson that addresses it. |
| **PersonalMisconception** | A wrong belief you held with confidence, recorded from your attempts. It adds a variant to the concept's ReviewCard that tests the corrected belief. |
| **ExercisePool** | Normally six or more validated exercises per lesson, tagged by concept. Plato picks from it at Recall and at checkpoints. |
| **CheckpointSet** | A pre-built cumulative recall set for the end of each module. |
| **Attempt** | One response. Kinds: *guess* (prequestion), *recall*, *exercise*, *review*, *checkpoint*, *final*. Stores the original answer, a standardized display copy, confidence, timing, grade, and whether it was delayed. |
| **ReviewCard** | The spaced-review item for one concept. It has a core recall prompt with its answer, and alternative phrasings and formats that rotate so you remember the idea rather than the wording. Its schedule sets the next due date from how well you recalled it before. Due cards appear on Today. |
| **ConceptMastery** | How well you currently remember a concept: the ReviewCard's predicted recall probability. It is shown only after at least one delayed attempt. |
| **CourseChange** | A change to a course, e.g. skip a lesson, add a review lesson, add a lesson for a parking-lot question, or refresh sources. It records who started it, the affected lessons, a diff, and the from/to versions. |
| **ParkingLotItem** | A question you raised during the course, saved for later. Status: *open* → *answered* (when a lesson covers it). |
| **TutorThread** | A saved tutor conversation, attached to a lesson. |
| **BuildStep** | One unit of build work: stage, lesson, input hash, status, attempts, cost and error. |
| **Notification** | An in-app notice: course Ready, proposed course change, checkpoint due. Also sent by email where noted. |

**Course-scoped vs. version-scoped.**
- **Course-scoped**, with stable IDs that survive new versions: Concept (a text revision keeps the same ID), ReviewCard, Source, Claim (append-only), KeyQuestion, LivingAnswer, Attempt.
- **Version-scoped**: Lesson, Exercise, CheckpointSet, CourseBlueprint.

A CourseVersion points at lesson revisions by reference, so unchanged and completed lessons carry over without being copied.

Every generated row records the **model** and **prompt version** that produced it. Every standardized text field is stored as `{original, standardized, standardizerVersion, confirmedAt}`.

### 2.3 Glossary

| Term | Meaning |
|---|---|
| **Sitting** | A continuous period of use, ending after 30 minutes idle. |
| **Session** | What Today assembles for one sitting, sized to your chosen length (F8). |
| **Delayed attempt** | An attempt on a concept at least about 20 hours after you last saw it. This rule alone decides whether an attempt is delayed. |
| **Mini-course** | A course of one or two lessons, for narrow topics. It uses the same pipeline. |
| **Course series** | **(Later)** Several linked courses that together cover a broad topic. |
| **Answers page** | Where your key questions and living answers live (F7). |

---

## 3. End-to-End Journey

```
1. INTAKE     Conversation (or the quick path): agree on key questions
                 · scout research runs in the background
                 · "save for later" keeps a Draft request
                 ▼
2. PLAN       One recommended plan; other approaches on request → Approve and build
                 ▼
3. BUILD      Whole course researched, written and verified in the background.
              Progress on the course page; email + notification when Ready.
                 ▼
4. LEARN      Today assembles sessions to your chosen length:
              due reviews + lesson steps (Warm up → Guess first → Read → Recall → Add to your answers)
              Tutor available throughout
                 ▼
5. CHECKPOINT End of each module: cumulative recall, then-and-now view of your answers,
              proposed course changes
                 ▼
6. COMPLETE   Final answers to your key questions: closed-book, then open-book, graded
                 ▼
7. RETAIN     Daily reviews continue on Today
```

---

## 4. Major Features

### F1. Intake

Intake turns a topic into agreed key questions. There are two paths.

**Conversation (default)**: a multi-turn brainstorm.
- Plato asks why you want to learn this and what you already know.
- It brainstorms angles, subtopics and candidate key questions, informed by **scout research** running in the background.
- It **refines key questions** into specific, self-contained, grammatical questions (F11). It also splits vague questions, merges duplicates and flags open research problems. For example, "does it change ur dna??" becomes **"Can mRNA vaccines alter human DNA?"** You confirm or edit each question.
- It pushes back when the scope doesn't fit your time budget.

**Quick path**: "I'm curious, just start".
- Two turns: the topic and the reason.
- Plato proposes three key questions; tap to accept or edit.

**Both paths:**
- **First take (optional)**: after confirming your key questions, jot a one-line first answer to each, or tap *No idea*. This is the "then" in the checkpoint's then-and-now view (F9).
- **Inferred settings as chips**, e.g. `~5 hrs total · 15 min sessions · 1 lesson/day · working knowledge`. Change any chip with a tap or in chat.
- **Topic shape**:
  - A *broad* topic shows a map of subfields: pick a slice. Starting a course series is **(Later)**.
  - A *narrow* topic becomes a mini-course.
  - *Fast-moving*, *contested* and *health or safety* topics are flagged for the policies in §6.
- **Your sources**: attach PDFs or URLs at any time. They rank above web sources.
- **Save for later**: keeps the request as a *Draft* on Today.
- **Profile reuse**: later intakes skip what your profile already knows.

### F2. Plan

You review the plan on one screen. The default view shows:
- **The recommended syllabus**: modules and lessons, time estimates and pacing. Each lesson shows the key questions it advances.
- **Why this plan**: 2–3 sentences tied to your time, background and questions.
- **[Approve and build]**.

**Expandable details**:
- **Coverage**: key questions × plan (full / partial / none), labeled *projected*.
- **Review load**: projected daily review minutes.
- **Other approaches**: two alternatives that keep your time budget but change the approach, e.g. *history-first*, *intuition-first*, *case-based*, *mechanism-deep*. Each is shown as a diff against the recommended plan and applied with one tap.

**Edit by chat**: e.g. "drop the history", "add a module on criticisms", "spread it over 2 weeks". The plan updates in place.

### F3. Course Build

When you approve the plan, Plato builds the whole course in the background.

**Pipeline**

| # | Stage | Work | Parallelism |
|---|---|---|---|
| 1 | **Research** | For each lesson: query planning (explainers, primary sources, critiques, worked examples), search and fetch, source rating (1–5 plus a domain allowlist boost), snapshots | Lessons in parallel |
| 2 | **Merge** | Deduplicate sources across lessons, mine misconceptions | Course-wide |
| 3 | **Blueprint** | Write the CourseBlueprint: glossary, notation, concept ownership, misconception assignment, analogy register | Course-wide |
| 4 | **Claims** | Extract claims with exact cited passages, then structure them | Lessons in parallel |
| 5 | **Write** | For each lesson: prequestions, brief, scope note, curated links, exercise pool with rubrics, curiosity hook, and review cards for the concepts it introduces. Plus: lesson 1's warm-up (from intake), course overview, checkpoint sets, critique drafts for living answers (F7) | Lessons in parallel, sharing the blueprint |
| 6 | **Verify** | Check each claim against its passage. Run the blind solver on each exercise (F6). Rewrite failures once. Exercises that still fail are dropped; claims are handled as in §5. | Fully parallel |
| 7 | **Lint** | A course-wide check for repetition, terminology drift and gaps. Produces targeted patches. | Course-wide |
| 8 | **Assemble** | Actual coverage, key-question–concept links, living-answer rubrics, review load. Publish as CourseVersion 1. | Course-wide |

**Behavior**
- **Progress** appears on the course page, e.g. "Writing lessons: 7 of 12". You can leave at any time.
- **Ready** triggers an email and an in-app notification. If actual coverage of any key question falls short of the projection, the Ready message says so and proposes a fix as a CourseChange.
- **Build time**: usually under an hour for 10–15 lessons. Larger courses may take a few hours.
- **Resumable**: each (lesson, stage) is an idempotent BuildStep keyed by its input hash, so a crash, or the machine going to sleep, resumes where it stopped.
- **Degraded lessons**: if a lesson keeps failing, it ships with a smaller exercise pool and an "uncertain" banner rather than holding up the course.
- **Cost cap per build**, with a warning before it's exceeded.
- **Thin research**: the lesson uses the model's own knowledge, clearly labeled, and Plato suggests attaching sources.

### F4. Lessons

#### Lesson flow

A full lesson takes about 12–20 minutes. It can be split at any step boundary and resumes where you left off.

| Step | What happens | Why |
|---|---|---|
| **1. Warm up** (~2 min) | 2–3 quick recall prompts, drawn at runtime from the review cards of the last lesson you *completed*. Lesson 1 uses its built warm-up, based on what you said at intake. If the session opens with reviews, the warm-up prompts come at the end of the review block, just before the lesson. They don't count toward the review cap, and a concept that is already due is asked only once. | Delayed recall builds durable memory |
| **2. Guess first** (~1 min) | 2–3 questions about this lesson, answered before reading. "It's fine to be wrong." | Guessing first primes attention and improves learning, even when the guess is wrong |
| **3. Read** (~5–10 min) | The brief (below). The tutor is available. | The core ideas, fast |
| **4. Recall** (~3–5 min) | The brief is hidden. Write down what you remember, in keywords or fragments. A meter shows how many of the lesson's key points you've recalled ("3 of 6"). Then Plato asks 2–3 exercises from the pool on the key points you missed, or on any key points if you missed none. | Pulling ideas from memory strengthens them far more than re-reading |
| **5. Add to your answers** (~1–2 min) | Add to the living answers this lesson advances (F7). | Connects learning to your questions |

The lesson ends with a **curiosity hook**: one line tied to a key question that the next lesson answers. The hook is shown again on Today's session button until the next lesson starts. The last lesson's hook points to your final answers (F7).

**Recall on the go**: if you'd rather not type, *tap mode* shows the lesson's key points mixed with decoys.
- **Decoys are always true statements**, taken from other lessons or from this lesson's *Not covered* list, never false claims.
- Tap the points you remember from this lesson, then explain one in a phrase. After you submit, each item is marked as from this lesson or not.
- Recognizing is easier than recalling, so tap-mode recall counts for less (F8).

**Splitting a lesson**:
- Read is a natural stopping point. If Recall happens in a later sitting, the delay helps.
- A session never ends straight after Read without at least a 1-minute tap-mode recall.

#### The brief

- **Why this matters**: 1–2 lines linking the lesson to your key questions.
- **Body**: the essential ideas, with inline citations, worked examples and analogies suited to your background.
- **Misconceptions addressed head-on**, e.g. "You might think X; actually Y, because…". Each misconception is the one assigned to this lesson in the blueprint.
- **Your guesses, revealed**: where the text answers a guess-first question, a callout shows your guess next to the answer. A wrong guess gets one or two sentences on why it was wrong.
- **Uncertain claims** carry a label. Every other claim was verified during the build.
- **Per-paragraph "?" button** opens the tutor on that paragraph. You can also select text.

#### Honest edges

A collapsed footer on the brief:
- ⚠️ **Simplified**: where the brief glosses over nuance, and where each analogy breaks down.
- ⏭️ **Not covered**: related subtopics left out on purpose, and why.

#### Go deeper (optional)

- 2–3 curated external links, each tagged with the edge it fills, effort (~15 min) and level.
- When a key question depends on an omitted nuance, one link is marked **recommended**.

#### How courses adapt

Course content is fixed within a CourseVersion. Adaptation happens in two layers.

| Layer | What adapts | When |
|---|---|---|
| **Per attempt** (instant) | Guess callouts, recall feedback, which pool exercises you get, hints, grading, tutor context, personal misconceptions, review scheduling | Every interaction |
| **Course changes** (rebuilt) | Skip a lesson, add a review lesson for weak concepts, add a lesson for a parking-lot question, rework lessons after a key question is edited, refresh sources | Proposed by Plato at checkpoints, on Ready, on a refresh suggestion, on return after a break, after you edit a key question, or when you attach new sources. Or requested by you in chat. |

**Applying a course change**
- **Changes you request** apply straight away. Plato shows what changed and offers Undo.
- **Changes Plato proposes** wait for you to accept or decline.
- **Undo** switches the course back to the previous CourseVersion. It is available only until you make an attempt in a changed lesson.
- **Skipped lessons**: their concepts still go into review.

**Versioning rules**
1. A change builds a new CourseVersion in the background and swaps it in when complete. Only affected lessons are rebuilt. Coverage and the lint are recomputed automatically.
2. Lessons you have completed, or are in the middle of, are never rewritten under you. Changes apply to lessons not yet started, unless you ask otherwise.
3. Attempts point to the exact exercise version they answered, and remain valid history.
4. ReviewCards belong to concepts, not lessons:
   - a concept that survives keeps its schedule and gets fresh prompt variants;
   - a removed concept's card is retired;
   - a concept whose meaning changed substantially has its schedule reset.
5. Living-answer links to claims that no longer exist are kept, marked "from an earlier version".
6. Editing a key question regenerates its rubric and proposes a course change.

### F5. Tutor

Every lesson has a **grounded tutor chat**.
- Ask *Why? Example? Simpler? Go deeper?* from the "?" button, a text selection, or free chat.
- Answers come from the lesson's sources and cite them. Plato says clearly when it goes beyond them.
- The tutor knows your place in the lesson, your guesses, your personal misconceptions and your key questions.
- During Recall and exercises it gives hints, not answers.
- **Save to parking lot** keeps a question for later. When a later lesson answers it, Plato tells you ("You asked this in lesson 2; lesson 5 answers it"). Open items are offered at the next checkpoint as possible course changes.
- Threads are saved per lesson and searchable in the library.

### F6. Practice

#### Question types

| Type | Mechanism | Where it appears |
|---|---|---|
| **Free recall** | Retrieval | Recall step; checkpoints; final answers (closed-book) |
| **Short answer / explain-why** | Retrieval + self-explanation | Exercise pool; reviews. Expected length shown (≤ ~25 words). Graded on ideas, not prose. |
| **Multiple choice** | Retrieval + discrimination | Exercise pool; reviews; warm-ups. Distractors come from misconceptions, and contrast items are included ("which best distinguishes X from Y?"). |
| **Cloze (fill in the blank)** | Retrieval | Exercise pool; reviews. Key terms only. Accepted variants are listed and near misses fuzzy-matched. |
| **Spot the error** | Error detection | Exercise pool; checkpoints. Tap the faulty sentence, then pick or type the fix. |
| **Scenario / what-if** | Transfer | Exercise pool; checkpoints. Usually a choice, with an optional short "why". |

**(Later)**: compare-and-contrast pairs, worked-example fading, concept maps built from memory, teach-back.

#### Answering

- **Confidence is the submit button.** You submit with **Sure**, **Not sure** or **Guess**: one tap answers and rates.
  - A correct *Guess* counts as not yet learned.
  - A *Sure* wrong answer is retested later in the same session and recorded as a personal misconception.
- **Hint and second try** before the answer is revealed.
- **Explanation**: shown expanded after a wrong answer, a *Guess* or a *Not sure*. Collapsed, one tap away, only after a *Sure* correct answer. It always links to the passage to re-read.

#### Quality

- Exercises are grounded in the lesson's claims, and answer keys cite them.
- **Blind solver**: during the build, each exercise is answered twice from the brief alone, using different settings. Both answers must match the key. For multiple choice, the solver must also explain why each distractor is wrong. Items that fail are rewritten once, then dropped.
- **Open responses** are graded against **3–5 yes/no rubric criteria** written with the item. Each criterion is graded separately, and you see which were met. Grading always uses your original answer.

### F7. Living Answers

Each key question has a **living answer** that grows as you learn. Living answers are the course's writing work and its final assessment. They are designed for thinking, not typing.

#### Input modes

| Mode | What you do | Typing |
|---|---|---|
| **Add a point** | "What does this lesson add to your answer to Q2?" One phrase or bullet. | ~5–15 words |
| **Pick and link** | Tap the 1–2 lesson claims most relevant to the question, then finish "This matters for Q2 because ___". | ~5–10 words |
| **Critique the draft** | A practice item, separate from your answer. Plato shows a sample answer with planted gaps or errors. Tap what's wrong or missing, then pick or type a short fix. After you submit, every planted error and gap is shown with its correction and cited passage. Your fixes are added to your living answer, with picked fixes marked as picked. Only fixes you type count toward rubric status. | ~0–10 words |
| **Fragments** | Bullets, keywords or arrows ("A → B because C"). | Any |

- **Plato composes, you own the ideas.** Plato composes your fragments and linked claims into clean prose, marked "composed from your notes". It adds no ideas of its own; instead it **highlights gaps**, e.g. "Your answer doesn't yet address X, covered in lesson 4."
- **Modes rotate.** Each module includes at least one mode where you produce ideas yourself (Add a point or Fragments), because generating ideas is what makes them stick.
- **Status**: after each edit, Plato grades the living answer against its rubric.
  - No criteria met: *open*.
  - Some met: *partial*.
  - All met: *answered*.
- **Answers page**: every key question, with its status, its living answer and the lessons that contributed.

#### Completion

After the last lesson and its module checkpoint, the course moves to *Completing*. The closed-book step unlocks the next day, so it measures what you keep rather than what you just read.
1. **Closed-book**: for each key question, jot what you'd say now, without seeing your living answer.
2. **Open-book**: compare with your living answer and the sources, then fill the gaps Plato highlights. The result becomes your final living answer.
3. **Graded**: your **closed-book** answers are graded against the rubrics, and they decide *Complete*. Your final living answers are shown next to the grades. You can overrule a grade.
4. **Durability checks (Later)**: a brief closed-book recall of each key question at day 7 and day 30, via Today.

### F8. Today

**Today** is the home page. It leads with one button, **"Your 15-min session"**, sized to your chosen length (10, 15, 20 or 30 minutes).

**How a session is assembled**
1. Due reviews, capped at about half the session. They are ordered by lowest predicted recall; ties go to concepts linked to a key question not yet *answered*.
2. The next lesson steps that fit the remaining time, from the most recently active course.
3. A checkpoint, when a module has just ended.

**Options**: "Reviews only" (about 3 minutes), or "Full lesson".

**Below the button:**
- **Continue**: one row per course in progress, most recent first.
- **Answers**: key questions not yet answered, with progress.
- **Courses being built**: with their progress.
- **Draft requests**: waiting to resume.

**Review engine**
- **Scheduling**: each concept's ReviewCard is scheduled with **FSRS** (e.g. the `ts-fsrs` library). The core prompt anchors the schedule. Variant phrasings and formats rotate, and per-variant statistics are kept for display.
- **Which attempts count**:
  - Scheduled reviews always update the schedule.
  - Other attempts (warm-ups, checkpoints, recall) update it only if they are delayed (§2.3).
  - Guesses and same-session attempts are kept as signals but don't update it.
- **Rating map** (attempt → FSRS rating):

  | Attempt | FSRS rating |
  |---|---|
  | *Sure* + correct | Good |
  | *Not sure* + correct | Hard |
  | Correct after a hint | Hard |
  | *Guess* + correct, or any wrong answer | Again |
  | Tap-mode recall | Capped at Hard |
- **First review** of a lesson's concepts comes 1–2 days after the lesson.
- **Personal misconceptions** add a variant to the concept's card that tests the corrected belief. It is used at the card's next reviews.
- **Load safety**:
  - a daily cap;
  - catch-up mode after a break of 2+ weeks (§6), with a welcome-back warm-up and an offer to adjust the course;
  - vacation mode **(Later)**;
  - retiring concepts, offered only when the cap is hit repeatedly **(Later)**.
- **Mixing**: reviews from all your courses are interleaved in each session. Deliberately interleaving confusable concepts within a course is **(Later)**.
- **Pacing**: the plan sets target lessons per day. More lessons stay open, with a gentle note when you're far ahead of your reviews.

**Nudge**: a daily email at your chosen time, sent on wake if the machine was asleep. PWA push is **(Later)**. Consistency is shown quietly, as a count of days active this month. There are no streak counters, and missing a day is never punished.

### F9. Checkpoints and Progress

At the end of each module, the checkpoint shows:
- **A cumulative recall set** from the module's CheckpointSet, including recall of your key questions.
- **Then and now**: for each key question, your first take from intake (F1) next to your living answer today.
- **Mastery summary** for the module's concepts.
- **Proposed course changes**, e.g. a review lesson for weak concepts or a lesson for a parking-lot question. Accept or decline each with one tap.
- **Retention view (Later)**: how well you remember each module's concepts over time.

### F10. Course Page and Library

**Course page**
- Syllabus with each lesson's status (not started, in progress, completed, skipped, rebuilding).
- Build progress while *Building*.
- Key-question coverage and status.
- History of course changes, with Undo for the most recent.

**Library**
- All courses, with status, mastery and answers.
- Lessons, tutor threads, parking lot and your uploaded sources, all searchable.
- **Refresh**: for fast-moving topics Plato suggests updating lessons whose sources are over 12 months old. Accepting is a course change. Attaching new sources to a course also proposes one.
- **Follow-up course (Later)**: e.g. "go deeper on module 3" starts an intake with context.

### F11. Input Standardization

Everything you type that Plato stores is kept in two forms: your **original** and a **standardized** version with correct grammar, spelling and capitalization and a clear, self-contained meaning.

| Input | When it runs | What you see |
|---|---|---|
| **Key questions** | Immediately | The standardized question, to confirm or edit |
| **Plan-edit requests** | Immediately | The updated plan |
| **Parking-lot items** | Immediately | The standardized question; editable |
| **Exercise, recall and final answers** | In the background, after grading | Standardized copy for display only. **Grading always uses the original.** Content and errors are never "fixed". |
| **Living-answer fragments** | On demand | Composed prose (F7) |
| **Tutor messages** | In the background | Unchanged in chat; the standardized copy is used for search |

**Safeguards**
- **Meaning check**: if a rewrite would add or drop a claim, entity, negation or hedge, the original is kept.
- **Ambiguity**: if the meaning is unclear, Plato asks a clarifying question rather than guessing. This applies to key questions and parking-lot items.
- **Short inputs**: clean or very short inputs skip the rewrite.

---

## 5. Quality and Trust

- **Native citations**: every claim links to its exact passage in a stored source snapshot.
- **Build-time claim verification**: a fast model checks each claim against its passage ("supports / partly / no").
  - Anything short of *supports* is rechecked by a stronger model.
  - Failing claims are rewritten once.
  - After that, a claim the brief depends on is kept with an *uncertain* label, and any other claim is removed.
- **Validated exercises** (blind solver) and **rubric grading** (F6).
- **"This seems wrong"** on any claim, exercise or grade.
  - It re-checks against the sources and fixes the item.
  - It shows you what changed and logs the case to the eval set.
  - A single-item fix creates a patch CourseVersion that differs from the active one only in that item. It skips the rebuild pipeline and needs no acceptance.
- **Eval harness**: an eval set of fixed topics with reference key questions, re-run after any prompt or model change. It tracks brief accuracy, the uncertain-claim rate, exercise validity and grading agreement.
- **Starting eval set**: each topic exercises a different path through the design. Swap in topics you want to learn at any time.

  | Topic | What it exercises |
  |---|---|
  | How mRNA vaccines work | Health and safety policy, mechanism explanations |
  | Causes of the 2008 financial crisis | Contested interpretations, cause-and-effect |
  | How large language models work | Fast-moving topic, technical depth |
  | The fall of the Western Roman Empire | History, competing scholarly views |
  | Bayesian reasoning basics | Math and LaTeX, worked examples |
  | What is a Bloom filter? | Narrow topic, mini-course |
  | Stoic philosophy | Broad topic, picking a slice |
  | Climate tipping points | Fast-moving science with public debate |
- **Source hygiene**: prefer open-access sources and sites whose terms allow reuse, quote briefly, link out for full text.

---

## 6. Content Policies and Edge Cases

| Situation | Behavior |
|---|---|
| **Broad topic** | Map of subfields → pick a slice. **(Later)** start a course series. |
| **Narrow topic** | Mini-course |
| **Fast-moving topic** | "As of" dates on lessons and sources; recent sources weighted up; refresh suggested; stale review cards updated, or retired if the concept is removed |
| **Contested or political topic** | Sources balanced across positions; the strongest form of each major position, attributed; disagreement labeled. **Grading assesses reasoning and evidence, never which conclusion you reach.** |
| **Health or safety topic** | Authoritative sources weighted up (health agencies, peer-reviewed reviews); general education only, no personal medical, legal or financial advice; a note pointing to professionals where relevant |
| **Unanswerable key question** | "The current state of knowledge plus the open problems" counts as a complete answer |
| **Thin or paywalled research** | Model knowledge used with a clear label; Plato suggests attaching sources |
| **Key question edited mid-course** | Rubric regenerated; course change proposed |
| **Returning after 2+ weeks** | Welcome-back warm-up, catch-up mode, offer to adjust the course |
| **Already know a lesson** | Say "skip this lesson" in chat: its concepts go into review. **(Later)** test-out at Guess first: a quick quiz; passing skips the lesson. |
| **Skill-practice topic** | Out of scope. Plato says so and offers the theory side only. |

---

## 7. AI Design

### Workflows

All workflows are fixed pipelines of Claude API calls with structured outputs. Research uses the server-side web search and fetch tools.

| Workflow | Trigger | Steps |
|---|---|---|
| `intake` | Each intake turn | Conversation, scout research, key-question standardization |
| `plan` | Key questions confirmed; plan edits | Syllabus, alternatives, projections |
| `buildCourse` | Plan approved | The 8 stages of F3 |
| `rebuildLessons` | Course change accepted or requested | Stages 1, 4, 5 and 6 for the affected lessons. Merge, Blueprint, Lint and Assemble rerun course-wide. |
| `grade` | Recall, exercises, reviews, checkpoints, living answers, final answers | Rubric grading |
| `tutor` | Tutor message | Grounded chat |
| `standardize` | Stored input (F11) | Rewrite plus meaning check |
| `dailyDigest` | Daily cron | Due counts, then email |

### Model tiers

| Model | Used for |
|---|---|
| **Haiku** | Claim structuring, first-pass claim verification, standardization, cloze fuzzy matching, guess explanations |
| **Sonnet** | Research loops, writing lessons, exercises, recheck of uncertain claims, blind solver, grading, tutor |
| **Opus** | Intake brainstorming, planning, blueprint, course lint, grading final answers |

### Grounding

- Claim extraction runs in two steps:
  1. a citations-enabled call over the source documents returns cited spans;
  2. a second call structures those spans into Claim records.

  This keeps exact passages even if citations and structured output can't be combined in one call. **To verify** against current API docs.
- Every lesson's writing prompt includes the **CourseBlueprint** and the lesson's **source bundle**, both cached.

### Cost

**Levers**
- Prompt caching of the blueprint and source bundles across writing, verification, exercises and tutor. Use the longer cache TTL and log cache hits.
- The Batch API for eval-harness runs and other work nothing waits on. It is kept off the course-build path, because batch completion times vary.
- Standardization skipped on short or clean inputs.
- A cost cap per build.

**Estimate**: roughly $5–15 per 15-lesson course at list prices. **To verify** against current pricing.

---

## 8. System Architecture

```
┌────────────────────── Next.js app (one process, PWA) ──────────────────────┐
│ UI: Today · Intake · Plan · Course page · Lesson (+ tutor) · Answers ·     │
│     Library                                                                │
│ Route handlers / server actions · SSE (chat streaming, build progress)     │
│ Owner sign-in (passphrase; passkey later)                                  │
├────────────────────────────────────────────────────────────────────────────┤
│ Jobs: `build_steps` + `jobs` tables, in-process workers with concurrency   │
│ limits; idempotent, resumable; cron for dailyDigest                        │
├─────────────────────────┬─────────────────────────┬────────────────────────┤
│ Claude API              │ Web                     │ Storage                │
│ structured outputs,     │ server-side web search  │ SQLite + Drizzle       │
│ citations, caching,     │ and fetch; uploaded     │ source snapshots,      │
│ Batch API (evals)       │ PDFs/URLs               │ versioned content      │
├─────────────────────────┴─────────────────────────┴────────────────────────┤
│ Email: transactional email service (Ready notices, daily digest)           │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Hosting**: Plato runs on the owner's own machine.
  - **Phone access** goes through a private network tunnel with HTTPS (e.g. Tailscale), which also lets the PWA install. Passphrase sign-in is still required; passkey is **(Later)**.
  - **While the machine sleeps**, builds and the daily email pause. Builds resume from the last completed BuildStep on wake, and a missed daily email is sent then.
  - A small always-on cloud host is **(Later)**.
- **Content**: lessons, exercises and blueprints are structured JSON validated with Zod. Question types are a discriminated union, rendered and graded per type.
- **Rendering**: Markdown with LaTeX and code highlighting.

### Latency targets

| Moment | Target |
|---|---|
| Intake or tutor reply | Streaming; first token in < 2 s |
| Plan after key questions confirmed | < 1 min |
| Course build | Usually < 1 hour for 10–15 lessons; large courses a few hours |
| Opening any step of a Ready course | Instant |
| Recall feedback and exercise grading | < 5 s |
| Final-answer grading | < 30 s |
| User-requested course change | Minutes, in the background; untouched lessons stay usable |

---

## 9. MVP Scope

### MVP features

1. **Owner sign-in** (passphrase), PWA shell and Today with session sizing.
2. **Intake**:
   - conversation and quick path;
   - standardized key questions and first takes;
   - chips;
   - topic-shape detection (broad topics pick a slice);
   - scout research, draft requests, uploaded sources.
3. **Plan**: recommended plan, expandable coverage, review load and alternatives, edit by chat, approve and build.
4. **Course build**: the full 8-stage pipeline, progress, Ready email and notification, resumable steps, degraded lessons, cost cap.
5. **Lessons**: all five steps, tap mode, curiosity hooks, honest edges, Go deeper, per-paragraph "?".
6. **Tutor** with parking lot.
7. **Practice**: six question types, confidence-as-submit, hints, blind-solver validation, rubric grading.
8. **Living answers**: four modes, rubric status, Answers page, closed-book then open-book completion.
9. **Review**: FSRS ReviewCards with the rating map, daily cap, catch-up mode, daily email.
10. **Checkpoints**: recall set, then-and-now, mastery summary, proposed course changes.
11. **Course changes**: versioning rules, user-requested changes with Undo, patch versions, refresh.
12. **Course page and library**: lesson statuses, build progress, change history, search.
13. **Input standardization**.
14. **Trust**: "This seems wrong" and the eval harness.

**Cut line.** If time runs short, these MVP items move to Later first:
- plan alternatives;
- Critique the draft;
- scout research during intake;
- refresh;
- tap mode.

### Build order

| # | Milestone | Covers |
|---|---|---|
| 1 | **Foundation** | Sign-in, schema (with the course- and version-scoped split, §2.2), job and BuildStep runner, a Claude client that logs model, prompt version and cost, and the eval harness on 2–3 topics from the starting eval set (§5) |
| 2 | **Intake → Plan → Approve** | Conversation and quick path, key-question standardization, first takes, chips, plan edits |
| 3 | **Build pipeline** | Research, Claims, Write, Verify and Assemble first; then Blueprint, Lint and the blind solver. Each stage is scored with evals. |
| 4 | **Lesson player** | Five steps, six question types, confidence-as-submit, grading, tutor and parking lot, Add a point and Fragments |
| 5 | **Retention loop** | FSRS cards, Today session assembly, cap and catch-up, daily email, checkpoints, completion |
| 6 | **Change and trust** | Course changes and versioning, Undo, patch versions, "This seems wrong", refresh, cut-line features |

### Later
- Learned explanation style
- Always-on cloud hosting and passkey sign-in
- Durability checks (day 7 / day 30)
- Test-out
- Retention view
- Vacation mode
- Retiring concepts
- Interleaving confusable concepts
- PWA push notifications
- Follow-up courses
- Prerequisite links between concepts
- Compare-and-contrast, worked-example fading, concept maps from memory, teach-back
- Built-in voice input and an audio listen mode
- Social features
