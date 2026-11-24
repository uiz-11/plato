import { join } from "node:path"

export const E2E_PASSCODE = "e2e-passcode-at-least-20-chars"
export const E2E_COOKIE_SECRET = "e2e-cookie-secret"
export const STORAGE_STATE = join(import.meta.dirname, ".auth/learner.json")

/** `test.use(locked)` starts a spec with no cookie. */
export const locked = { storageState: { cookies: [], origins: [] } }
