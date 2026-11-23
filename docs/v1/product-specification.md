# Plato — Product Specification (v1)

*Date: 2026-11-22.* This document describes what Plato v1 is and what it does for the learner. It does not cover how Plato is built.

---

## 1. Overview

You describe in your own words what you want to learn. Plato turns that description into a few **key questions** and builds a complete course that answers them, researched and checked before you start. You then learn in short daily sessions that mix reviews with lesson steps. Each lesson has five steps:

1. **Warm up**: recall the last lesson you completed in this course.
2. **Guess first**: answer a few questions before reading.
3. **Read**: a short brief.
4. **Recall**: write down what you remember.
5. **Add to your answers** (optional): note what the lesson adds to each key question.

Short daily reviews keep what you learned from fading. You complete a course by finishing every lesson and checkpoint (F7).

Plato calls no AI model while you use it. Every course is created offline, ahead of time, and the app only shows published courses and records your progress.

---

## 2. Principles

1. **Your questions guide the course.** The key questions decide what the course teaches. Every lesson, exercise and review traces back to them.
2. **Prepared ahead, instant to use.** Everything you see, including exercises, explanations and sample answers, is written before the course is published. Nothing is generated or marked by an AI model while you learn, so nothing makes you wait.
3. **Short core, honest edges.** Each brief covers the essential ideas and says what it simplified or left out.
4. **Recall beats re-reading; spacing beats cramming.** Practice exists to make memories last, and recalling an idea on a later day matters most.
5. **High thinking, low typing.** Recall takes effort, but answers can be fragments, phrases or clicks.
6. **Desktop-first, mobile-friendly.** Every step is designed for desktop and also works on a phone, in sessions of 10–30 minutes. Progress is saved at every step.
7. **Grounded and labeled.** Every claim cites its source or is labeled *general knowledge*. Claims that are uncertain or contested are labeled.
8. **You describe; Plato builds.** Your description is the only input a course needs. Plato makes every decision about the course's content, and a published course does not change.

---

## 3. Scope

| Dimension | v1 |
|---|---|
| Learner | One self-directed adult learner. |
| Content | Text-based knowledge topics. Skill topics (languages, drawing, instruments) are taught as theory only, with no skill practice (§8). |
| Media | Formatted text, including math notation, code blocks and simple diagrams. |
| Platform | A web app, designed for desktop and usable on a phone. |

---

## 4. Terms

| Term | Meaning |
|---|---|
| **Course request** | Your free-text description of what you want to learn. Status: *Requested*, then *Published* or *Not built*. |
| **Key question** | One of the 3–5 questions Plato derives from your request. The course is written to answer them. |
| **Course** | The modules and lessons built for one course request. Status: *Ready*, *In progress*, *Complete*. |
| **Course page** | A course's home: a header with its title, length, as-of date and main button, and three tabs: *Syllabus*, *Answers* and *Sources* (F9). |
| **Syllabus** | The course page tab a course opens on: what the course leaves out and why, in one line, then its modules and lessons in order, with each lesson's status. |
| **Module** | A group of related lessons, ending with a checkpoint. |
| **Lesson** | One unit of learning, taught in the five steps of F4. Status: *Not started*, *In progress*, *Completed*, *Skipped*. |
| **Brief** | The reading in a lesson. |
| **Concept** | One idea a lesson teaches, stated in one sentence. A lesson's concepts are its **key points**. |
| **Exercise** | A practice question with a prepared answer and explanation, in one of the types in F5. Exercises appear in Recall, reviews and checkpoints. |
| **Sample answer** | The prepared answer to a short-answer exercise, with a checklist of 2–4 points it makes. |
| **Review** | A spaced-repetition prompt on one concept, drawn from several prepared versions and scheduled by how well you recalled the concept before. |
| **Mastery** | How well you currently remember a concept: *Strong*, *Good* or *Shaky*, shown once you have reviewed it on a day after its lesson, and *Not yet reviewed* before that. |
| **Checkpoint** | A cumulative practice set at the end of each module. Status: *Locked*, *Open*, *Done*. |
| **Answer notes** | Your notes on one key question, added lesson by lesson. They are for your own use and are not marked. |
| **Answers tab** | The course page tab with the course's key questions and your answer notes (F7). |
| **Today** | The home page, where sessions start (F8). |
| **Session** | One sitting of due reviews plus lesson steps or a checkpoint, sized to the length you set on Today, ending with a session summary. |
| **Mini-course** | A course of one or two lessons in a single module, for narrow topics. |

---

## 5. Journey

1. **Request**: describe what you want to learn, in free text.
2. **Creation** (offline): Plato derives key questions, then researches, writes and checks the course before publishing it as *Ready*.
3. **Learn**: Today assembles sessions of due reviews and lesson steps.
4. **Checkpoint**: at the end of each module, cumulative practice and a mastery summary.
5. **Complete**: every lesson and checkpoint is finished (F7).
6. **Retain**: daily reviews continue on Today.

---

## 6. Features

### F1. Course request

- One free-text box: "What do you want to learn, and why?" You can mention what you already know, how deep you want to go, how much time you have, and any sources you want used.
- Plato asks no follow-up questions.
- The request shows on Today as *Requested* until its course is published. If no course will be built for it, it is marked *Not built*, with a one-line reason.

### F2. Course creation

Course creation happens offline, outside the app, and is not instant. For each request, Plato:

1. **Derives 3–5 key questions** from the description. Each is specific, self-contained and answerable.
2. **Scopes the course** to the time you mentioned, or a default length, following the policies in §8, and states what is out of scope and why.
3. **Researches** the topic, preferring sources you named, then authoritative and open-access sources.
4. **Writes** the course: modules, lessons, exercises, reviews and checkpoints.
5. **Checks** the course against the quality requirements in §7.
6. **Publishes** it. The request becomes *Published*, and the course appears on Today as *Ready*.

### F3. Starting a course

- The course opens on its course page, on the *Syllabus* tab. The header shows the course's title, number of lessons, length and as-of date. Its key questions are on the *Answers* tab.
- The header's main button follows the course's state: *Start Lesson 1*, *Continue Lesson N* or *Open Checkpoint N*. It starts a session with this course: due reviews first, then that lesson or checkpoint. The course becomes the one Today continues.
- A course becomes *In progress* when you start or skip any of its lessons.

### F4. Lessons

A full lesson takes about 12–20 minutes. You can stop after any step and pick up at the next one.

| Step | What happens |
|---|---|
| **1. Warm up** (~2 min) | 2–3 quick recall prompts on the concepts of the lesson you last *Completed* in this course. If you have not completed a lesson in this course yet, there is no warm-up. Warm-ups do not change your review schedule. |
| **2. Guess first** (~1 min) | 2–3 multiple-choice questions about this lesson, answered before reading. The screen notes: "It's fine to be wrong." Guesses are not marked here; the brief reveals each answer. |
| **3. Read** (~5–10 min) | The brief (below). |
| **4. Recall** (~3–5 min) | The brief is hidden. Write what you remember, in keywords or fragments. Then the lesson's key points are revealed next to what you wrote, and you tick the ones you recalled. Finally, 2–3 exercises cover the key points you missed, or any of them if you missed none. |
| **5. Add to your answers** (~1–2 min) | Optional. For each key question this lesson advances, you see your earlier notes for it and add a new one. |

A completed lesson ends on a short celebration: a brief burst of confetti, "Lesson *N* complete", and one line. On every lesson except the last, that line is the **curiosity hook**: a question, tied to a key question, that the next lesson answers. When the lesson completes its module, the line says the module's checkpoint is open instead.

**Skipping**: you can mark any lesson you have not completed as *Skipped* and come back to it later, picking up where you stopped. Its concepts enter your reviews only once you complete it. Skipping shows an undo option.

#### The brief

- **Why this matters**: 1–2 lines linking the lesson to the key questions.
- **Body**: the essential ideas, with citations, worked examples and analogies.
- **Misconceptions addressed head-on**, e.g. "You might think X; actually Y, because…".
- **Your guesses, revealed**: for each Guess first question, the brief shows your pick next to the correct answer, with a short explanation of why the other options are wrong.
- **Beyond this lesson**, a short section that ends the brief, listing its honest edges:
  - *Simplified*: where the brief glosses over nuance, and where each analogy breaks down.
  - *Not covered*: related subtopics left out on purpose, and why.
- **Go deeper** (optional): 2–3 external links, each shown under the simplification or omission it fills and tagged with what it adds, its effort (e.g. ~15 min) and its level. When a key question depends on a nuance the brief left out, one link is marked **recommended**.

### F5. Practice

#### Exercise types

| Type | How you answer | How it is marked |
|---|---|---|
| **Multiple choice** | Pick one option. Wrong options are drawn from common misconceptions. | Automatically |
| **Fill in the blank** | Type a key term. | Automatically, against a list of accepted answers, ignoring case, spacing and punctuation |
| **Spot the error** | Pick the faulty sentence, then pick the fix. | Automatically; correct only if both picks are right |
| **Scenario** | Read a short scenario and pick what happens or what to do. | Automatically |
| **Short answer** | Write a phrase or sentence, up to about 25 words. | By you: compare with the sample answer and tick the checklist points you made |

#### Answering

These rules apply to exercises in Recall, reviews and checkpoints, not to Guess first.

- **Confidence is the submit button.** For automatically marked exercises you submit with **Sure**, **Not sure** or **Guess**, so one click answers and rates.
  - A correct *Guess* counts as not yet learned.
  - A wrong *Sure* answer comes back later in the same session.
- **Self-marked answers**: a short answer counts as fully recalled if you tick every checklist point, partly recalled if you tick some, and not recalled if you tick none.
- **Explanation**: every exercise has a prepared explanation that points back to the relevant part of the brief. It opens automatically after a wrong answer, a *Guess*, a *Not sure* or a short answer, and is one click away after a correct *Sure* answer.

### F6. Checkpoints

At the end of each module, the checkpoint shows:

- **Cumulative practice**: exercises across the module's lessons.
- **Mastery summary** for the module's concepts. Concepts not yet reviewed on a day after their lesson show as *Not yet reviewed*.

A checkpoint is *Locked* until every lesson in its module is *Completed*, then *Open*. You can stop partway; your answers are saved and it continues in your next session. It is *Done* once you have answered all its exercises, right or wrong.

### F7. Answer notes and completion

Each key question has answer notes, made of the notes you jot at step 5 of each lesson. Each note is shown as a sticky note in your own words, labelled with the lesson you wrote it after. You can add, edit or delete notes at any time. Nothing marks or scores them, and they do not affect completion. The **Answers tab** shows every key question with the lessons that advance it and its answer notes.

The course is *Complete* once every lesson is *Completed* and every checkpoint is *Done*. Skipped lessons must be completed first.

### F8. Today and reviews

#### Today

Today leads with one button, **"Start session"**, with the session length beside it: 10, 15, 20 or 30 minutes, 15 by default. Your choice is remembered. One line above the button says what the session holds, e.g. "9 reviews, then Lesson 4 from Recall".

A session is assembled in this order:

1. Due reviews, filling up to about half the session. The most overdue come first.
2. Then, in the remaining time, from the *In progress* course you used most recently:
   - its *Open* checkpoint, if it has one;
   - otherwise its next lesson: the first in syllabus order that is *Not started* or *In progress*, or, if only *Skipped* lessons remain, the first *Skipped* one.

If no course is *In progress*, the session has only due reviews. If no course is *In progress* and nothing is due, Today offers to start Lesson 1 of a *Ready* course instead.

A lesson often spans two sessions. When the session's time runs out, the current step finishes first. Every session ends with a short summary of what you did and what comes next, with a brief burst of confetti.

Other options: **Reviews only** (about 3 minutes) and **Full lesson** (no reviews; the next lesson from where you left off, whatever its length).

Below the session button:

- **In progress**: one row per course *In progress*, most recent first.
- **Ready**: published courses you haven't started.
- **Requested**: course requests that are *Requested* or *Not built*.

#### Reviews

- Each concept's review has several prepared versions: a recall prompt you rate yourself as *Forgot*, *Partly* or *Remembered*, and automatically marked exercises. Versions rotate, so you remember the idea rather than the wording.
- A concept's first review comes 1–2 days after you complete its lesson. After that, each review is scheduled by how well you recalled the concept before.
- Reviews from all your courses are mixed into each session.
- **Daily cap**: there is a daily limit on reviews. After a break of two weeks or more, overdue reviews are spread over the following days rather than shown all at once.
- **Mastery** is shown per concept: on the syllabus, under each completed lesson, and in each checkpoint's summary.
- **No streaks**: Today shows the total number of days you have shown up. It only grows, and missing a day is never punished.

### F9. Course page and library

**Course page**: a header with the course's title, length, as-of date and main button (F3), and three tabs:

- **Syllabus**, the tab a course opens on: what the course leaves out and why, and any policy note from §8, in one line; then the modules and lessons with their status.
- **Answers**: the key questions and your answer notes (F7).
- **Sources**: every source the course cites, grouped by kind, with its date. Their numbers match the citations in the briefs.

**Library**: all your courses with their status, and your course requests that are *Requested* or *Not built*.

---

## 7. Content quality

Every published course meets these requirements:

- **Cited**: every claim in a brief cites a source the course lists, or is labeled *general knowledge*.
- **Verified**: each claim is checked against its source. A claim that cannot be fully confirmed is either removed or kept with an *uncertain* label.
- **Sound exercises**: every automatically marked exercise has exactly one correct answer, can be answered from the course's briefs, and has an explanation. Every short-answer exercise has a sample answer and checklist.
- **Enough practice**: every concept has enough exercises for Recall and checkpoints, and at least two review versions, one of which is a recall prompt.
- **Consistent**: terms, notation and explanations are consistent across lessons. Each concept is taught in one lesson, and each misconception is addressed in one lesson.
- **Covers every key question**: every key question is advanced by at least one lesson.
- **Displays correctly**: every brief, exercise and formula is confirmed to display correctly on desktop and phone before the course is published.
- **Copyright**: quotes are brief, and full texts are linked rather than copied.

---

## 8. Content policies

| Situation | Behavior |
|---|---|
| **Broad topic** | The course covers one slice that fits the time available, and the syllabus names what is left out. |
| **Narrow topic** | A mini-course. |
| **Fast-moving topic** | The course's as-of date is shown prominently in the course page header, and each source shows its date. Recent sources are preferred. |
| **Contested or political topic** | Sources are balanced across positions. The strongest form of each major position is presented and attributed, and disagreement is labeled *contested*. Exercises test understanding of each position, never agreement with one. |
| **Health, legal, financial or safety topic** | Authoritative sources are preferred, such as health agencies and peer-reviewed reviews. Content is general education only, with no personal medical, legal or financial advice, and points to professionals where relevant. |
| **Key question with no settled answer** | The course teaches the current state of knowledge and the open problems. |
| **Little good research available** | The course relies more on general knowledge, labeled as such, and the syllabus says so. |
| **Skill topic** | Only the theory is taught, and the syllabus says so. |
