import "server-only"

import { requireLearner } from "@/lib/auth/learner"
import { readNotBuilt, readPublished } from "@/lib/content/load"
import { getDb } from "@/lib/db/client"
import { requestStatus } from "@/lib/engine/status"

import { readRequests } from "./load"

/** One request as the offline pipeline sees it (§11.1). */
export interface OpenRequest {
  id: string
  text: string
  /** ISO 8601, UTC. */
  createdAt: string
}

/**
 * Requests that are neither published nor listed in `not-built.json`, oldest
 * first, for `GET /api/pipeline/requests` (§11.1).
 */
export async function listOpenRequests(): Promise<OpenRequest[]> {
  await requireLearner()
  const published = readPublished()
  const notBuilt = readNotBuilt()
  return readRequests(getDb())
    .filter(
      (r) => requestStatus(r.id, published, notBuilt).status === "requested"
    )
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((r) => ({
      id: r.id,
      text: r.text,
      createdAt: new Date(r.createdAt).toISOString(),
    }))
}
