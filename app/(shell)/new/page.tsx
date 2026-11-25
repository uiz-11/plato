import type { Metadata } from "next"

import { RequestForm } from "@/components/plato/request-form"
import { requireLearner } from "@/lib/auth/learner"

export const metadata: Metadata = { title: "New request" }

// New request (§9.4, spec F1, WF-B1).
export default async function NewRequestPage() {
  await requireLearner()
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-6">
      <h1 className="text-2xl font-semibold md:text-3xl">New request</h1>
      <RequestForm />
    </div>
  )
}
