import { spawn } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

// `npm run requests:export` end to end: the real script against a fake app.

const ID = "11111111-1111-4111-8111-111111111111"
const PASSCODE = "a-test-passcode-of-enough-length"
const SCRIPT = join(import.meta.dirname, "requests-export.ts")
const TSX = join(process.cwd(), "node_modules/.bin/tsx")

let server: Server
let url: string
let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "plato-export-cli-"))
  server = createServer((req, res) => {
    if (req.url !== "/api/pipeline/requests") return res.writeHead(404).end()
    if (req.headers.authorization !== `Bearer ${PASSCODE}`)
      return res.writeHead(401).end()
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(
      JSON.stringify([
        {
          id: ID,
          text: "Why is the sky blue?",
          createdAt: "2026-11-24T10:00:00.000Z",
        },
      ])
    )
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((done) => server.close(done))
  rmSync(dir, { recursive: true, force: true })
})

function run(env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (done) => {
      const child = spawn(TSX, [SCRIPT], {
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH ?? "",
          PLATO_PIPELINE_DIR: join(dir, ".pipeline"),
          ...env,
        },
      })
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (d) => (stdout += d))
      child.stderr.on("data", (d) => (stderr += d))
      child.on("close", (code) => done({ code, stdout, stderr }))
    }
  )
}

describe("requests:export", () => {
  it("writes the open requests to .pipeline/requests/", async () => {
    const result = await run({ PLATO_URL: url, PLATO_PASSCODE: PASSCODE })
    expect(result).toMatchObject({ code: 0, stderr: "" })
    expect(result.stdout).toContain("Exported 1 open request")
    const out = join(dir, ".pipeline", "requests")
    expect(readdirSync(out)).toEqual([`${ID}.json`])
    expect(JSON.parse(readFileSync(join(out, `${ID}.json`), "utf8"))).toEqual({
      id: ID,
      text: "Why is the sky blue?",
      createdAt: "2026-11-24T10:00:00.000Z",
    })
  })

  it("exits 1 when the passcode is refused", async () => {
    const result = await run({ PLATO_URL: url, PLATO_PASSCODE: "wrong" })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Check PLATO_PASSCODE")
  })

  it("exits 2 with usage without PLATO_URL", async () => {
    const result = await run({})
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("usage:")
  })
})
