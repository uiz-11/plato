import { AnswerNotes } from "@/components/plato/answer-notes"
import { getAnswersView } from "@/lib/dal/course"

// Answers (§9.4, spec F7, WF-C2): each key question with the lessons that
// advance it and the learner's notes as stickies. Nothing here is graded.
export default async function AnswersPage(
  props: PageProps<"/courses/[courseId]/answers">
) {
  const { courseId } = await props.params
  const view = await getAnswersView(courseId)

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">Your notes. Not graded.</p>
      {view.keyQuestions.map((q) => {
        const id = `question-${q.id}`
        return (
          <section
            key={q.id}
            aria-labelledby={id}
            data-slot="key-question"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1">
              <h2 id={id} className="text-sm font-medium">
                <span className="mr-2 text-muted-foreground">
                  {q.id.toUpperCase()}
                </span>
                {q.text}
              </h2>
              {q.lessons && (
                <p className="text-xs text-muted-foreground">{q.lessons}</p>
              )}
            </div>
            <AnswerNotes
              courseId={courseId}
              keyQuestionId={q.id}
              notes={q.notes.map((n) => ({
                id: n.id,
                text: n.text,
                lessonLabel: n.lessonLabel,
              }))}
            />
          </section>
        )
      })}
    </div>
  )
}
