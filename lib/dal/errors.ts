import "server-only"

// Typed errors the DAL throws for requests it refuses (§8.3). Server Actions
// let them propagate. A client never sends these in normal use, so they mean
// a hand-made request; a merely stale page is handled without an error.

export type DalErrorCode =
  | "unknown_course"
  | "unknown_lesson"
  | "unknown_key_question"
  // Undo on a note that was not deleted in the last minute. Normally a
  // hand-made request too, but also an Undo across a server restart; the
  // client shows that as a failed restore.
  | "not_restorable"
  | "unknown_session"
  // A player event that does not fit the position it was sent at, though
  // the expected position matched: a hand-made request.
  | "bad_event"
  | "bad_draft"

export class DalError extends Error {
  constructor(
    readonly code: DalErrorCode,
    message: string
  ) {
    super(message)
    this.name = "DalError"
  }
}

/**
 * SQLite errors that pass: the database was locked longer than the busy
 * timeout (a backup), or the disk hiccuped. Retrying the same request works,
 * so the player retries these instead of refusing the event (§8.4).
 */
const TRANSIENT_SQLITE = /^SQLITE_(BUSY|LOCKED|IOERR|CANTOPEN|FULL|PROTOCOL)/

export function isTransientDbError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === "string" && TRANSIENT_SQLITE.test(code)
}
