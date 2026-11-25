import { STEP_LABEL } from "@/lib/engine/labels"
import type { LessonStep } from "@/lib/engine/lesson"
import { cn } from "@/lib/utils"

const STEPS: readonly LessonStep[] = [
  "warmup",
  "guess",
  "read",
  "recall",
  "answers",
]

/** Short names for the five segments (WF-E). */
const SHORT: Record<LessonStep, string> = {
  warmup: "Warm up",
  guess: "Guess first",
  read: "Read",
  recall: "Recall",
  answers: "Answers",
}

/**
 * The lesson steps row (§9.1, WF-E): five segments, step 5 dashed because it
 * is optional, and done and current steps marked with a symbol as well as
 * shade. Without a warm-up the first reads "Warm up · none". On a phone it is
 * the text "Step 3 of 5 · Read" (WF-I2.1). `current` is null once the lesson
 * is done.
 */
export function StepsRow({
  current,
  hasWarmup,
}: {
  current: LessonStep | null
  hasWarmup: boolean
}) {
  const at = current === null ? STEPS.length : STEPS.indexOf(current)
  return (
    <div>
      <p className="text-xs text-muted-foreground md:hidden">
        {current === null
          ? "All steps done"
          : `Step ${at + 1} of 5 · ${STEP_LABEL[current]}`}
      </p>
      <ol aria-label="Lesson steps" className="hidden gap-1 md:flex">
        {STEPS.map((step, i) => {
          const none = step === "warmup" && !hasWarmup
          const state = none
            ? "none"
            : i < at
              ? "done"
              : i === at
                ? "current"
                : "todo"
          return (
            <li
              key={step}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex flex-1 items-center gap-1 border-t-4 pt-1 text-xs",
                step === "answers" && "border-dashed",
                state === "done" && "border-foreground",
                state === "current" && "border-foreground/50 font-medium",
                (state === "todo" || state === "none") &&
                  "border-muted text-muted-foreground"
              )}
            >
              <span aria-hidden>
                {state === "done" ? "✓" : state === "current" ? "●" : ""}
              </span>
              {none ? "Warm up · none" : SHORT[step]}
              {state === "done" ? (
                <span className="sr-only">, done</span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
