// The player runtime's decisions, as plain functions so they are tested
// without a browser (§8.4).

/**
 * The id prefix of the brief inside a `BriefSheet` (`ContentContext.idPrefix`),
 * here so the server page and the sheet share it.
 */
export const BRIEF_SHEET_PREFIX = "brief-sheet"

export interface DraftCopy {
  key: string
  text: string
  /** The client's time of the last change. */
  updatedAt: number
}

/**
 * The draft to show on load: a local copy newer than the server's wins,
 * otherwise the server's (§8.4 Typed text). Null when there is neither.
 */
export function chooseDraft(
  local: DraftCopy | null,
  server: DraftCopy | null
): DraftCopy | null {
  if (local && (!server || local.updatedAt > server.updatedAt)) return local
  return server
}

/**
 * Runs one task at a time: a call made while another runs is dropped and
 * resolves to false. A unit's last event and **×** share one, so they cannot
 * race. `onBusy` reports when a task starts and ends.
 */
export function exclusiveRunner(onBusy: (busy: boolean) => void) {
  let busy = false
  return async (run: () => Promise<void>): Promise<boolean> => {
    if (busy) return false
    busy = true
    onBusy(true)
    try {
      await run()
      return true
    } finally {
      busy = false
      onBusy(false)
    }
  }
}
