// Runs once at server start, before any request is handled (§4).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  // `next build` sets this; the build must never create a database (§6).
  if (process.env.NEXT_PHASE === "phase-production-build") return
  // Refuse to start without a valid passcode gate in production (§8.5).
  const { checkAuthConfigOrExit } = await import("./lib/auth/config")
  checkAuthConfigOrExit()
  const { checkTimeZoneOrExit } = await import("./lib/clock")
  checkTimeZoneOrExit()
  const { migrateOrExit } = await import("./lib/db/migrate")
  migrateOrExit()
}
