import { defineConfig } from "drizzle-kit"

// `npm run db:generate` writes a migration for each schema change (§6).
export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
})
