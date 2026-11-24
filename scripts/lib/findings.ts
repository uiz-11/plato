import { ContentError, formatPath } from "@/lib/content/load"
import type { Finding } from "@/lib/content/validate"

/** `file: path: error: message [rule]`, one per line, errors first. */
export function formatFindings(findings: Finding[]): string {
  return [...findings]
    .sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1))
    .map(
      (f) =>
        `${f.file}${f.path.length ? `: ${formatPath(f.path)}` : ""}: ${f.level}: ${f.message} [${f.rule}]`
    )
    .join("\n")
}

export function summary(findings: Finding[]): {
  errors: number
  warnings: number
} {
  const errors = findings.filter((f) => f.level === "error").length
  return { errors, warnings: findings.length - errors }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export function summaryLine(id: string, findings: Finding[]): string {
  const { errors, warnings } = summary(findings)
  return `${id}: ${plural(errors, "error")}, ${plural(warnings, "warning")}`
}

/** Runs `fn`; a content file that is missing or malformed exits 1 with its message. */
export function exitOnContentError<T>(fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    if (!(error instanceof ContentError)) throw error
    console.error(error.message)
    process.exit(1)
  }
}
