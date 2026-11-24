import "server-only"

// Typed errors the DAL throws for requests it refuses (§8.3). Server Actions
// let them propagate. A client never sends these in normal use, so they mean
// a hand-made request; a merely stale page is handled without an error.

export type DalErrorCode =
  "unknown_course" | "unknown_lesson" | "unknown_key_question"

export class DalError extends Error {
  constructor(
    readonly code: DalErrorCode,
    message: string
  ) {
    super(message)
    this.name = "DalError"
  }
}
