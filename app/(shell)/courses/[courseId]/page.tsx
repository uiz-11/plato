import { redirect } from "next/navigation"

import { requireLearner } from "@/lib/auth/learner"

// A course opens on its Syllabus (spec F3, §8.1).
export default async function CoursePage(
  props: PageProps<"/courses/[courseId]">
) {
  await requireLearner()
  const { courseId } = await props.params
  redirect(`/courses/${courseId}/syllabus`)
}
