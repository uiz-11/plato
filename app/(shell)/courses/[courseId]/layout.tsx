import "katex/dist/katex.min.css"

import type { Metadata } from "next"

import { CourseHeader } from "@/components/plato/course-header"
import { CourseTabs } from "@/components/plato/course-tabs"
import { getCourseHeader } from "@/lib/dal/course"

export async function generateMetadata(
  props: LayoutProps<"/courses/[courseId]">
): Promise<Metadata> {
  const { courseId } = await props.params
  const header = await getCourseHeader(courseId)
  return { title: header.title }
}

// The course page (§8.1, §9.4, WF-C1 to WF-C3): the header and tabs stay on
// every tab. An unknown course id 404s in `getCourseHeader`.
export default async function CourseLayout(
  props: LayoutProps<"/courses/[courseId]">
) {
  const { courseId } = await props.params
  const header = await getCourseHeader(courseId)
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <CourseHeader header={header} />
      <CourseTabs courseId={courseId} />
      {props.children}
    </div>
  )
}
