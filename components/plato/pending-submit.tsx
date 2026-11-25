"use client"

import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"

/**
 * A submit button that is disabled while its form's action runs, so a second
 * tap cannot start a second session before the redirect (§8.3).
 */
export function PendingSubmit(
  props: Omit<React.ComponentProps<typeof Button>, "type" | "disabled">
) {
  const { pending } = useFormStatus()
  return <Button {...props} type="submit" disabled={pending} />
}
