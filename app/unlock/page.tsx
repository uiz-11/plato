import type { Metadata } from "next"
import { redirect } from "next/navigation"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { isLearner } from "@/lib/auth/learner"
import { safeNextPath } from "@/lib/auth/session"

import { UnlockForm } from "./unlock-form"

export const metadata: Metadata = { title: "Unlock" }

export default async function UnlockPage(props: PageProps<"/unlock">) {
  const { next: raw } = await props.searchParams
  const next = safeNextPath(Array.isArray(raw) ? raw[0] : raw)
  // Already unlocked, or the gate is off in development.
  if (await isLearner()) redirect(next)

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl font-semibold">Plato</h1>
          </CardTitle>
          <CardDescription>Enter your passcode to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <UnlockForm next={next} />
        </CardContent>
      </Card>
    </main>
  )
}
