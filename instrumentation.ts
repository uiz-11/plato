// Runs once at server start, before any request is handled (§4).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  // `next build` sets this; the build must never create a database (§6).
  if (process.env.NEXT_PHASE === "phase-production-build") return
  const { migrateOrExit } = await import("./lib/db/migrate")
  migrateOrExit()
}
