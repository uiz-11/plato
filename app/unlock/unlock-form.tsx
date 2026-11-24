"use client"

import { useActionState } from "react"

import { unlock, type UnlockState } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const initialState: UnlockState = { error: null }

export function UnlockForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(unlock, initialState)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-2">
        <label htmlFor="passcode" className="text-sm font-medium">
          Passcode
        </label>
        <Input
          id="passcode"
          name="passcode"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "passcode-error" : undefined}
        />
        {/* role="alert" announces on insert. Hiding it while pending re-inserts
            it after each failed try, so a repeated error is announced too. */}
        {state.error && !pending && (
          <p
            id="passcode-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {state.error}
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Unlocking…" : "Unlock"}
      </Button>
    </form>
  )
}
