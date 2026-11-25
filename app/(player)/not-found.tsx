import Link from "next/link"
import { CompassIcon } from "lucide-react"

import { EmptyIllustration } from "@/components/plato/empty-illustration"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// An unknown session (§8.1): full-window like the player, with a way back.
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <EmptyIllustration icon={CompassIcon} />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Session not found</h1>
        <p className="text-sm text-muted-foreground">
          There&apos;s no session at this address.
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
