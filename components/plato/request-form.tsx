"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { unstable_rethrow, useRouter } from "next/navigation"
import { toast } from "sonner"

import { createRequest } from "@/app/actions/requests"
import { Button, buttonVariants } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export const REQUEST_SENT =
  "Request sent. It'll appear under Ready once it's built."

/**
 * New request (§9.4, WF-B1): one free-text box and no follow-up questions.
 * **Request course** returns to Today with a toast (WF-B2); **Cancel**
 * returns without sending. The length limits are checked by the action, which
 * answers with an inline error.
 */
export function RequestForm() {
  const router = useRouter()
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof createRequest>>
      try {
        result = await createRequest(text)
      } catch (err) {
        // An expired cookie redirects to /unlock: let Next handle it.
        unstable_rethrow(err)
        // Anything else would replace the form, and the learner's text, with
        // the error screen. Keep both and say so inline.
        setError("Couldn't send your request. Try again.")
        return
      }
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(REQUEST_SENT)
      router.push("/")
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="request-text" className="text-sm font-medium">
          What do you want to learn, and why?
        </label>
        <Textarea
          id="request-text"
          name="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (error) setError(null)
          }}
          autoFocus
          rows={6}
          className="min-h-32"
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? "request-help request-error" : "request-help"
          }
        />
        <p id="request-help" className="text-xs text-muted-foreground">
          Say what you know, how deep to go, how long you have, and which
          sources you trust.
        </p>
        {error && !pending && (
          <p
            id="request-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Link
          href="/"
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "min-h-11 focus-visible:ring-ring md:min-h-9"
          )}
        >
          Cancel
        </Link>
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className="min-h-11 md:min-h-9"
        >
          {pending ? "Sending…" : "Request course"}
        </Button>
      </div>
    </form>
  )
}
