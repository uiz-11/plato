// `requests:export` (§11.1): fetches the open course requests from the app and
// writes one file per request to `.pipeline/requests/<id>.json`, the course
// pipeline's input. It only reads from the app.

import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { z } from "zod"

const OpenRequests = z.array(
  z.strictObject({
    // A UUID, so it is also a safe file name.
    id: z.uuid(),
    text: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
  })
)
export type OpenRequest = z.infer<typeof OpenRequests>[number]

export type ExportResult =
  | { ok: true; written: string[]; removed: string[] }
  | { ok: false; message: string }

export interface ExportOptions {
  /** `PLATO_URL`: the app's base URL, which may include a path prefix. */
  baseUrl: string
  /** `PLATO_PASSCODE`, sent as a bearer token. Omit when the gate is off. */
  passcode?: string
  /** Where the request files go, usually `.pipeline/requests`. */
  outDir: string
  fetch?: typeof fetch
}

const FILE = /^[0-9a-f-]{36}\.json$/i
const ENDPOINT = "api/pipeline/requests"

/** The endpoint under `baseUrl`, keeping any path prefix. */
export function endpointUrl(baseUrl: string): URL | null {
  try {
    const base = new URL(baseUrl)
    if (base.protocol !== "http:" && base.protocol !== "https:") return null
    if (!base.pathname.endsWith("/")) base.pathname += "/"
    base.search = ""
    base.hash = ""
    return new URL(ENDPOINT, base)
  } catch {
    return null
  }
}

const fail = (message: string): ExportResult => ({ ok: false, message })

/**
 * Writes `<outDir>/<id>.json` (`{ id, text, createdAt }`) for each open
 * request, then removes request files for requests that are no longer open
 * (published or not built since the last export). Other files are left alone.
 * Each file is written to a temporary name and renamed, so a reader never
 * sees half a file, and nothing is removed unless every write succeeded.
 */
export async function exportRequests(
  options: ExportOptions
): Promise<ExportResult> {
  const { baseUrl, passcode, outDir, fetch: get = fetch } = options
  const url = endpointUrl(baseUrl)
  if (!url) return fail(`PLATO_URL is not an http(s) URL: ${baseUrl}`)

  let response: Response
  try {
    // Redirects are not followed, so the passcode only goes to PLATO_URL.
    response = await get(url, {
      headers: passcode ? { Authorization: `Bearer ${passcode}` } : {},
      redirect: "manual",
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return fail(`Could not reach ${url}: ${reason}`)
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location")
    const target = location ? new URL(location, url).href : "another URL"
    return fail(
      `${url} redirected (${response.status}) to ${target}. Set PLATO_URL to the app's final address.`
    )
  }
  if (response.status === 401)
    return fail(`${url} refused the passcode (401). Check PLATO_PASSCODE.`)
  if (!response.ok)
    return fail(
      `${url} answered ${response.status} ${response.statusText}`.trim()
    )

  const parsed = OpenRequests.safeParse(
    await response.json().catch(() => undefined)
  )
  if (!parsed.success)
    return fail(
      `${url} did not return a list of requests: ${z.prettifyError(parsed.error)}`
    )

  const written: string[] = []
  try {
    mkdirSync(outDir, { recursive: true })
    for (const r of parsed.data) {
      const file = join(outDir, `${r.id}.json`)
      const body = { id: r.id, text: r.text, createdAt: r.createdAt }
      const tmp = `${file}.tmp`
      writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`)
      renameSync(tmp, file)
      written.push(file)
    }
    const open = new Set(parsed.data.map((r) => `${r.id}.json`))
    const removed = readdirSync(outDir)
      .filter((name) => FILE.test(name) && !open.has(name))
      .sort()
      .map((name) => join(outDir, name))
    for (const file of removed) rmSync(file)
    return { ok: true, written, removed }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return fail(
      `Could not write to ${outDir} (${written.length} of ${parsed.data.length} written, nothing removed): ${reason}`
    )
  }
}
