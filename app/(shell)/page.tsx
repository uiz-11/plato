import { requireLearner } from "@/lib/auth/learner"

// Placeholder until Today (T13).
export default async function Page() {
  await requireLearner()
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-md flex-col gap-2 text-center">
        <h1 className="text-3xl font-semibold">Plato</h1>
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      </div>
    </div>
  )
}
