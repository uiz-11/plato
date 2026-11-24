import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { stringify } from "yaml"

import { loadCourseDir } from "@/lib/content/load"

/** Audit files that satisfy the publish checks, built from the course itself. */
export function writeValidAudit(root: string, id: string) {
  const c = loadCourseDir(join(root, "courses", id), null, root)
  const claims = c.lessons.flatMap(({ lesson }) =>
    c.course.sources.map((s) => ({
      lesson: lesson.id,
      claim: "A claim.",
      source: s.id,
      locator: "§1",
      verdict: "confirmed",
    }))
  )
  const exercises = c.lessons
    .flatMap((l) => l.lesson.exercises)
    .filter((e) => e.type !== "short")
    .map((e) => {
      if (e.type === "fill") return { exercise: e.id, answer: e.accepted[0] }
      const verdict = (o: { id: string }, key: string) => ({
        option: o.id,
        verdict: o.id === key ? "defensible" : "indefensible",
      })
      if (e.type === "spot")
        return {
          exercise: e.id,
          options: [
            ...e.sentences.map((o) => verdict(o, e.faulty)),
            ...e.fixes.map((o) => verdict(o, e.correctFix)),
          ],
        }
      return {
        exercise: e.id,
        options: e.options.map((o) => verdict(o, e.correct)),
      }
    })
  const findings = ["consistency", "policy", "copyright"].map((area) => ({
    area,
    issue: "Checked.",
    resolution: "Nothing to change.",
  }))
  const dir = join(root, "courses", id, "_audit")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "claims.yaml"), stringify({ claims }))
  writeFileSync(join(dir, "blind-solve.yaml"), stringify({ exercises }))
  writeFileSync(join(dir, "review.yaml"), stringify({ findings }))
}
