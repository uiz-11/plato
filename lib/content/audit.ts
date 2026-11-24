// Audit evidence (§11.3): the files the pipeline's check stage writes to a
// course's `_audit/` folder. The validator's publish checks (`--publish`)
// parse them with these schemas and check that they cover the content; the
// app never loads them.
//
// Verdicts are words, not YAML booleans: the content loader keeps plain
// scalars as their source text (`load.ts`), and a word says more anyway.

import { z } from "zod"

import { Id } from "./schema"

const Text = z.string().trim().min(1)

export const AUDIT_DIR = "_audit"

export const AUDIT_FILES = {
  claims: "claims.yaml",
  blindSolve: "blind-solve.yaml",
  review: "review.yaml",
} as const

/**
 * `claims.yaml`: claims checked against their sources. Per lesson, the
 * entries must cover every source the lesson cites. Verification re-reads the
 * source at the locator, not the research notes.
 */
export const ClaimsAudit = z.strictObject({
  claims: z.array(
    z.strictObject({
      lesson: Id,
      claim: Text,
      source: Id,
      /** Section, page or other place in the source. */
      locator: Text,
      verdict: z.enum(["confirmed", "labelled-uncertain", "removed"]),
    })
  ),
})

/**
 * `blind-solve.yaml`: one entry per automatically marked exercise (every type
 * but `short`), from a solver that saw only the rendered briefs.
 *
 * - `mc`, `scenario`: a verdict on every option.
 * - `spot`: a verdict on every sentence ("this is the faulty one") and on
 *   every fix ("this fixes it").
 * - `fill`: the solver's own answer, which must normalize to an accepted one.
 */
export const BlindSolveAudit = z.strictObject({
  exercises: z.array(
    z.union([
      z.strictObject({
        exercise: Id,
        options: z
          .array(
            z.strictObject({
              option: Id,
              verdict: z.enum(["defensible", "indefensible"]),
              note: Text.optional(),
            })
          )
          .min(1),
      }),
      z.strictObject({ exercise: Id, answer: Text }),
    ])
  ),
})

export const REVIEW_AREAS = ["consistency", "policy", "copyright"] as const

/**
 * `review.yaml`: the review's findings, covering every area: consistency of
 * terms and notation, policy compliance (spec §8) and copyright. An area with
 * nothing to fix still gets a finding that says so. A finding without a
 * resolution fails the publish check.
 */
export const ReviewAudit = z.strictObject({
  findings: z.array(
    z.strictObject({
      area: z.enum(REVIEW_AREAS),
      issue: Text,
      // Optional here so the validator can say which finding is unresolved.
      resolution: z.string().trim().optional(),
    })
  ),
})

export type ClaimsAudit = z.infer<typeof ClaimsAudit>
export type BlindSolveAudit = z.infer<typeof BlindSolveAudit>
export type ReviewAudit = z.infer<typeof ReviewAudit>
