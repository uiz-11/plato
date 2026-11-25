// Runs once at server start, before any request is handled (§4).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  // `next build` sets this; the build must never create a database (§6).
  if (process.env.NEXT_PHASE === "phase-production-build") return
  // Refuse to start with a missing passcode, an unknown time zone, a bad
  // database path or no content (§8.5, §12.1).
  const { checkEnvOrExit } = await import("./lib/env")
  checkEnvOrExit()
  // Swap in a staged restore, then migrate (§12.2).
  const { migrateOrExit } = await import("./lib/db/migrate")
  migrateOrExit()
}
