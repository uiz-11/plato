import { Content, type ContentContext } from "@/components/plato/content"
import { MasteryDisclosure } from "@/components/plato/mastery-disclosure"
import { MasteryMeter } from "@/components/plato/mastery-meter"
import { StatusDot } from "@/components/plato/status-dot"
import { SyllabusMenu } from "@/components/plato/syllabus-menu"
import {
  getSyllabusView,
  type SyllabusLesson,
  type SyllabusModule,
} from "@/lib/dal/course"
import { CHECKPOINT_STATUS_DOT, LESSON_STATUS_DOT } from "@/lib/engine/labels"

// Syllabus (§9.4, spec F9, WF-C1): progress, the out-of-scope line, then each
// module's lessons and checkpoint with their exact status.
export default async function SyllabusPage(
  props: PageProps<"/courses/[courseId]/syllabus">
) {
  const { courseId } = await props.params
  const view = await getSyllabusView(courseId)
  const ctx: ContentContext = { courseId, surface: "course" }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{view.completed}</p>
        {/* What the course leaves out, and any policy note, in one line
            (WF-C1.2). */}
        <p data-slot="out-of-scope" className="text-sm text-muted-foreground">
          <Content tree={view.outOfScope} ctx={ctx} />
          {view.policyNote && (
            <>
              {" "}
              <Content tree={view.policyNote} ctx={ctx} />
            </>
          )}
        </p>
      </div>
      {view.modules.map((m, i) => (
        <ModuleSection
          key={m.moduleId}
          module={m}
          number={i + 1}
          courseId={courseId}
        />
      ))}
    </div>
  )
}

function ModuleSection({
  module: m,
  number,
  courseId,
}: {
  module: SyllabusModule
  number: number
  courseId: string
}) {
  const id = `module-${m.moduleId}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h2 id={id} className="text-xs font-medium text-muted-foreground">
        Module {number} · {m.title}
      </h2>
      <ul className="flex flex-col divide-y">
        {m.lessons.map((l) => (
          <LessonRow key={l.lessonId} lesson={l} courseId={courseId} />
        ))}
        <li
          data-slot="checkpoint-row"
          data-status={m.checkpoint.status}
          className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2"
        >
          <span className="min-w-0 flex-1 text-sm font-medium">
            Checkpoint {m.checkpoint.number}
          </span>
          <StatusDot shape={CHECKPOINT_STATUS_DOT[m.checkpoint.status]}>
            {m.checkpoint.label}
          </StatusDot>
          {/* Lines the status up with the lesson rows' menus. */}
          <span aria-hidden className="w-11 md:w-8" />
        </li>
      </ul>
    </section>
  )
}

function LessonRow({
  lesson: l,
  courseId,
}: {
  lesson: SyllabusLesson
  courseId: string
}) {
  return (
    <li
      data-slot="lesson-row"
      data-status={l.status}
      className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-1"
    >
      <span className="min-w-0 flex-1 text-sm">
        {l.number}. {l.title}
      </span>
      <StatusDot shape={LESSON_STATUS_DOT[l.status]}>{l.statusLabel}</StatusDot>
      {l.mastery ? (
        <MasteryDisclosure lessonNumber={l.number}>
          <ul
            aria-label={`Mastery, Lesson ${l.number}`}
            className="flex flex-col gap-2 pt-1 pb-2 pl-6"
          >
            {l.mastery.map((k) => (
              <li
                key={k.conceptId}
                className="flex flex-col gap-1 text-sm md:flex-row md:items-center md:justify-between md:gap-4"
              >
                <span className="text-muted-foreground">{k.statement}</span>
                <MasteryMeter mastery={k.mastery} className="shrink-0" />
              </li>
            ))}
          </ul>
        </MasteryDisclosure>
      ) : l.menu ? (
        <SyllabusMenu
          courseId={courseId}
          lessonId={l.lessonId}
          number={l.number}
          title={l.title}
          offer={l.menu}
        />
      ) : (
        <span aria-hidden className="w-11 md:w-8" />
      )}
    </li>
  )
}
