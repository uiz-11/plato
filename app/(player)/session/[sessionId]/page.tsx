import Link from "next/link"
import { notFound } from "next/navigation"
import { PlayIcon } from "lucide-react"

import { EmptyIllustration } from "@/components/plato/empty-illustration"
import { buttonVariants } from "@/components/ui/button"
import { sessionExists } from "@/lib/dal/sessions"
import { cn } from "@/lib/utils"

// A stand-in for the player (§8.4), which T15 builds here. Until then the
// start buttons on Today and the course page land on this page, not a 404.
export default async function SessionPage(
  props: PageProps<"/session/[sessionId]">
) {
  const { sessionId } = await props.params
  if (!(await sessionExists(sessionId))) notFound()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <EmptyIllustration icon={PlayIcon} />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Session started</h1>
        <p className="text-sm text-muted-foreground">
          The player isn&apos;t available yet.
        </p>
      </div>
      <Link
        href="/"
        className={cn(buttonVariants(), "min-h-11 focus-visible:ring-ring")}
      >
        Back to Today
      </Link>
    </div>
  )
}
