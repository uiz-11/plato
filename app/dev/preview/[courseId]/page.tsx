import "katex/dist/katex.min.css"

import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { renderContent, type ContentContext } from "@/components/plato/content"
import { BeyondLesson, LessonBrief } from "@/components/plato/lesson-brief"
import type { ExerciseItem } from "@/components/plato/player/exercise"
import { GuessUnit } from "@/components/plato/player/lesson-steps"
import { requireLearner } from "@/lib/auth/learner"
import { getCourse } from "@/lib/content/load"
import { getRenderedLesson, type RenderedOptions } from "@/lib/content/render"
import { testHooksEnabled } from "@/lib/test-hooks"

import { PreviewExercise, PreviewRecall, PreviewRuntime } from "./preview-items"

export const metadata: Metadata = { title: "Display check preview" }

/**
 * The display check's preview route (§11.4), test hooks only. It renders a
 * course, published or draft, with the real screen components and fixed,
 * fake learner state, in the player's column:
 *
 * - every guess as the Guess step shows it, before a pick;
 * - every brief, with each guess revealed with its first option picked;
 * - every exercise, answered (wrong where it can be), with its feedback and
 *   explanation open;
 * - every recall prompt, with its answer shown.
 *
 * Each item is a `[data-display-item]` the check measures. It reads no
 * learner data and records nothing, but course content is the learner's to
 * see, so it is gated like every page.
 */
export default async function PreviewPage(
  props: PageProps<"/dev/preview/[courseId]">
) {
  if (!testHooksEnabled()) notFound()
  await requireLearner()
  const { courseId } = await props.params
  const course = getCourse(courseId, { includeDrafts: true })
  if (!course) notFound()
  const ctx: ContentContext = { courseId, surface: "player" }

  return (
    <PreviewRuntime>
      <main
        data-slot="player-main"
        data-display-course={courseId}
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-6"
      >
        {course.lessons.map(({ lesson }, n) => {
          const rendered = getRenderedLesson(courseId, lesson.id, {
            includeDrafts: true,
          })
          if (!rendered) throw new Error(`No lesson ${courseId}:${lesson.id}`)
          const number = n + 1
          const guessPicks = Object.fromEntries(
            lesson.guesses.map((g) => [g.id, g.options[0]!.id])
          )
          const guesses = lesson.guesses.map((g) => ({
            id: g.id,
            prompt: renderContent(rendered.guesses[g.id]!.prompt, ctx),
            options: g.options.map((o) => ({
              id: o.id,
              text: renderContent(rendered.guesses[g.id]!.options[o.id]!, ctx),
            })),
          }))
          const options = (o: RenderedOptions | undefined) =>
            o &&
            Object.fromEntries(
              Object.entries(o).map(([id, t]) => [id, renderContent(t, ctx)])
            )
          return (
            <section
              key={lesson.id}
              aria-label={`Lesson ${number}`}
              className="flex flex-col gap-6"
            >
              {guesses.map((g, i) => (
                <Item
                  key={g.id}
                  id={`${lesson.id}/guess/${g.id}`}
                  label={`Lesson ${number} guess ${g.id}`}
                >
                  {/* Its own runtime: a unit reports its lesson position
                      there, and the player only ever mounts one. */}
                  <PreviewRuntime>
                    <GuessUnit
                      lessonId={lesson.id}
                      pickingUp={false}
                      guesses={guesses}
                      index={i}
                    />
                  </PreviewRuntime>
                </Item>
              ))}
              <Item id={`${lesson.id}/brief`} label={`Lesson ${number} brief`}>
                <LessonBrief
                  brief={{ courseId, lesson: rendered, guessPicks }}
                />
                <BeyondLesson
                  courseId={courseId}
                  beyond={{
                    simplified: lesson.beyond.simplified.map((e) => ({
                      id: e.id,
                      text: rendered.simplified[e.id]!,
                      links: e.links,
                    })),
                    notCovered: lesson.beyond.notCovered,
                  }}
                />
              </Item>
              {lesson.exercises.map((exercise) => {
                const r = rendered.exercises[exercise.id]!
                const item: ExerciseItem = {
                  exercise,
                  nodes: {
                    prompt: renderContent(r.prompt, ctx),
                    explanation: renderContent(r.explanation, ctx),
                    scenario: r.scenario && renderContent(r.scenario, ctx),
                    options: options(r.options),
                    sentences: options(r.sentences),
                    fixes: options(r.fixes),
                  },
                  briefKey: lesson.id,
                  draftKey:
                    exercise.type === "short"
                      ? `display-check:${courseId}:${exercise.id}`
                      : undefined,
                }
                return (
                  <Item
                    key={exercise.id}
                    id={`${lesson.id}/exercise/${exercise.id}`}
                    label={`Lesson ${number} exercise ${exercise.id}`}
                  >
                    <PreviewExercise item={item} />
                  </Item>
                )
              })}
              {lesson.concepts.flatMap((concept) =>
                (rendered.concepts[concept.id] ?? []).map((p, i) => (
                  <Item
                    key={`${concept.id}/${i}`}
                    id={`${lesson.id}/recall/${concept.id}/${i + 1}`}
                    label={`Lesson ${number} recall prompt ${concept.id} #${i + 1}`}
                  >
                    <PreviewRecall
                      prompt={renderContent(p.prompt, ctx)}
                      answer={renderContent(p.answer, ctx)}
                    />
                  </Item>
                ))
              )}
            </section>
          )
        })}
      </main>
    </PreviewRuntime>
  )
}

function Item({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}) {
  return (
    <article
      data-display-item={id}
      data-display-label={label}
      className="flex flex-col gap-6 border-b pb-6"
    >
      {children}
    </article>
  )
}
