import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { endpointUrl, exportRequests } from "./requests-export"

const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const STALE = "33333333-3333-4333-8333-333333333333"

const REQUESTS = [
  {
    id: A,
    text: "Why is the sky blue?",
    createdAt: "2026-11-24T10:00:00.000Z",
  },
  {
    id: B,
    text: "How do vaccines work?",
    createdAt: "2026-11-24T11:00:00.000Z",
  },
]

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "plato-export-"))
  dirs.push(dir)
  return join(dir, "requests")
}

function fakeFetch(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () =>
    Response.json(body, { status, statusText: status === 200 ? "OK" : "" })
  )
}

describe("exportRequests", () => {
  it("writes one file per open request, with the bearer passcode", async () => {
    const out = outDir()
    const get = fakeFetch(REQUESTS)
    const result = await exportRequests({
      baseUrl: "https://plato.example/",
      passcode: "the-passcode",
      outDir: out,
      fetch: get,
    })
    expect(result).toEqual({
      ok: true,
      written: [join(out, `${A}.json`), join(out, `${B}.json`)],
      removed: [],
    })
    const [url, init] = get.mock.calls[0]
    expect(String(url)).toBe("https://plato.example/api/pipeline/requests")
    expect(init?.headers).toEqual({ Authorization: "Bearer the-passcode" })
    expect(JSON.parse(readFileSync(join(out, `${A}.json`), "utf8"))).toEqual(
      REQUESTS[0]
    )
  })

  it("sends no header without a passcode", async () => {
    const get = fakeFetch([])
    await exportRequests({
      baseUrl: "http://localhost:3000",
      outDir: outDir(),
      fetch: get,
    })
    expect(get.mock.calls[0][1]?.headers).toEqual({})
  })

  it("removes files for requests that are no longer open, and nothing else", async () => {
    const out = outDir()
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, `${STALE}.json`), "{}")
    writeFileSync(join(out, "notes.md"), "keep me")
    const result = await exportRequests({
      baseUrl: "http://localhost:3000",
      outDir: out,
      fetch: fakeFetch([REQUESTS[0]]),
    })
    expect(result).toMatchObject({
      ok: true,
      removed: [join(out, `${STALE}.json`)],
    })
    expect(readdirSync(out).sort()).toEqual([`${A}.json`, "notes.md"])
  })

  it("names a refused passcode", async () => {
    const result = await exportRequests({
      baseUrl: "http://localhost:3000",
      passcode: "wrong",
      outDir: outDir(),
      fetch: fakeFetch({ error: "no" }, 401),
    })
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("Check PLATO_PASSCODE"),
    })
  })

  it("refuses a response that is not a list of requests, writing nothing", async () => {
    const out = outDir()
    const result = await exportRequests({
      baseUrl: "http://localhost:3000",
      outDir: out,
      fetch: fakeFetch([{ id: "../../etc/passwd", text: "x", createdAt: "x" }]),
    })
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("did not return a list of requests"),
    })
    expect(() => readdirSync(out)).toThrow()
  })

  it("reports an unreachable app and a bad URL", async () => {
    expect(
      await exportRequests({
        baseUrl: "http://localhost:3000",
        outDir: outDir(),
        fetch: vi.fn<typeof fetch>(async () => {
          throw new TypeError("fetch failed")
        }),
      })
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("fetch failed"),
    })
    expect(
      await exportRequests({ baseUrl: "not a url", outDir: outDir() })
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("not an http(s) URL"),
    })
  })

  it("names where a redirect went, without following it", async () => {
    const get = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 301,
          headers: { Location: "https://plato.example/api/pipeline/requests" },
        })
    )
    const result = await exportRequests({
      baseUrl: "http://plato.example",
      passcode: "the-passcode",
      outDir: outDir(),
      fetch: get,
    })
    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0][1]?.redirect).toBe("manual")
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "redirected (301) to https://plato.example/api/pipeline/requests"
      ),
    })
  })

  it("removes nothing when a write fails", async () => {
    const out = outDir()
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, `${STALE}.json`), "{}")
    // A directory where the first file's temporary name goes makes its write fail.
    mkdirSync(join(out, `${A}.json.tmp`))
    const result = await exportRequests({
      baseUrl: "http://localhost:3000",
      outDir: out,
      fetch: fakeFetch(REQUESTS),
    })
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("0 of 2 written, nothing removed"),
    })
    expect(readdirSync(out)).toContain(`${STALE}.json`)
  })
})

describe("endpointUrl", () => {
  it.each([
    ["https://plato.example", "https://plato.example/api/pipeline/requests"],
    ["https://plato.example/", "https://plato.example/api/pipeline/requests"],
    [
      "https://example.com/plato",
      "https://example.com/plato/api/pipeline/requests",
    ],
    [
      "https://example.com/plato/?x=1#y",
      "https://example.com/plato/api/pipeline/requests",
    ],
  ])("%s", (base, expected) => {
    expect(endpointUrl(base)?.href).toBe(expected)
  })

  it("refuses non-http URLs", () => {
    expect(endpointUrl("file:///etc/passwd")).toBeNull()
    expect(endpointUrl("not a url")).toBeNull()
  })
})
