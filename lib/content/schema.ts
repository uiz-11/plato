// The contract with the offline course pipeline (§5.2). Every value read from
// a course folder passes through these schemas. Simple count and length limits
// live here; cross-reference and whole-course rules are the validator's (§5.5).
//
// Objects are strict: an unknown key is an error, so a typo in authored YAML
// fails loudly instead of being dropped.

import { z } from "zod"

/** Kebab-case id (§5.1). */
export const Id = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a kebab-case id")

export const QId = z.enum(["q1", "q2", "q3", "q4", "q5"])

/** Inline Markdown: math, emphasis, code, `:cite` and content labels. */
export const Md = z.string().trim().min(1)

const Text = z.string().trim().min(1)
const Url = z.url({ protocol: /^https?$/ })

/**
 * The loader keeps unquoted YAML numbers as their source text (`load.ts`), so
 * number fields turn any numeric string back into a number first. The wrapped
 * schema then reports the real problem ("expected int", "too small") rather
 * than "received string".
 */
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const intFromText = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && NUMERIC.test(v) ? Number(v) : v),
    schema
  )

/** A real calendar date: no 2024-02-31. */
function isRealDate(s: string): boolean {
  const [y, m = 1, d = 1] = s.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

const Link = z.strictObject({
  title: Text,
  url: Url,
  adds: Text,
  minutes: intFromText(z.int().positive()),
  level: z.enum(["intro", "intermediate", "advanced"]),
  recommended: QId.optional(),
})

const Opt = z.strictObject({
  id: Id,
  text: Md,
  misconception: Id.optional(),
})

const Options = z.array(Opt).min(3).max(4)

/** Whitespace-separated words, for the short-answer sample limit. */
export function wordCount(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

export const SHORT_SAMPLE_MAX_WORDS = 25

const exerciseBase = {
  id: Id,
  concepts: z.array(Id).min(1),
  pool: z.enum(["recall", "review", "checkpoint"]),
  prompt: Md,
  explanation: Md,
  anchor: Id,
}

export const Exercise = z.discriminatedUnion("type", [
  z.strictObject({
    ...exerciseBase,
    type: z.literal("mc"),
    options: Options,
    correct: Id,
  }),
  z.strictObject({
    ...exerciseBase,
    type: z.literal("scenario"),
    scenario: Md,
    options: Options,
    correct: Id,
  }),
  z.strictObject({
    ...exerciseBase,
    type: z.literal("fill"),
    accepted: z.array(Text).min(1),
  }),
  z.strictObject({
    ...exerciseBase,
    type: z.literal("spot"),
    sentences: Options,
    faulty: Id,
    fixes: z.array(Opt).min(2).max(3),
    correctFix: Id,
  }),
  z.strictObject({
    ...exerciseBase,
    type: z.literal("short"),
    sample: Text.refine((s) => wordCount(s) <= SHORT_SAMPLE_MAX_WORDS, {
      message: `must be at most ${SHORT_SAMPLE_MAX_WORDS} words`,
    }),
    checklist: z.array(Text).min(2).max(4),
  }),
])

export const Lesson = z.strictObject({
  id: Id,
  title: Text,
  keyQuestions: z.array(QId).min(1),
  whyThisMatters: Md,
  hook: z.strictObject({ text: Text, keyQuestion: QId }).optional(),
  concepts: z
    .array(
      z.strictObject({
        id: Id,
        statement: Text,
        recallPrompts: z
          .array(z.strictObject({ prompt: Md, answer: Md }))
          .min(1),
      })
    )
    .min(3)
    .max(6),
  guesses: z
    .array(
      z.strictObject({
        id: Id,
        prompt: Md,
        options: Options,
        correct: Id,
        why: Md,
      })
    )
    .min(2)
    .max(3),
  misconceptions: z.array(
    z.strictObject({ id: Id, belief: Md, correction: Md })
  ),
  beyond: z.strictObject({
    simplified: z.array(
      z.strictObject({
        id: Id,
        text: Md,
        analogy: Id.optional(),
        links: z.array(Link),
      })
    ),
    notCovered: z.array(
      z.strictObject({
        id: Id,
        topic: Text,
        why: Text,
        links: z.array(Link),
      })
    ),
  }),
  exercises: z.array(Exercise),
})

export const POLICIES = [
  "broad",
  "narrow",
  "fast-moving",
  "contested",
  "health-legal-financial-safety",
  "unsettled",
  "little-research",
  "skill",
] as const

export const Course = z.strictObject({
  schemaVersion: intFromText(z.literal(1)),
  id: Id,
  requestId: z.uuid().optional(),
  title: Text,
  coverLabel: Text.max(12),
  kind: z.enum(["standard", "mini"]),
  asOf: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be YYYY-MM"),
  outOfScope: Md,
  policyNote: Md.optional(),
  policies: z.array(z.enum(POLICIES)),
  keyQuestions: z
    .array(z.strictObject({ id: QId, text: Text }))
    .min(3)
    .max(5),
  modules: z
    .array(
      z.strictObject({
        id: Id,
        title: Text,
        lessons: z.array(Id).min(1),
        // 6–12 in a standard course, 4–12 in a mini-course: the validator
        // checks the kind-specific minimum (§5.5).
        checkpoint: z.array(Id).max(12),
      })
    )
    .min(1),
  sources: z
    .array(
      z.strictObject({
        id: Id,
        group: Text,
        title: Text,
        publisher: Text,
        date: z
          .string()
          .regex(
            /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/,
            "must be YYYY, YYYY-MM or YYYY-MM-DD"
          )
          .refine(isRealDate, "must be a real date"),
        url: Url,
        position: Text.optional(),
      })
    )
    .min(1),
})

/** `content/published.json` (§5.1). Append-only. */
export const PublishedManifest = z.strictObject({
  courses: z.array(
    z.strictObject({
      id: Id,
      requestId: z.uuid().optional(),
      publishedAt: z.iso.datetime({ offset: true }),
    })
  ),
})

/** `content/not-built.json` (§5.1). Append-only. */
export const NotBuiltList = z.array(
  z.strictObject({
    requestId: z.uuid(),
    reason: Text,
    decidedAt: z.iso.datetime({ offset: true }),
  })
)

export type QId = z.infer<typeof QId>
export type Course = z.infer<typeof Course>
export type Module = Course["modules"][number]
export type Source = Course["sources"][number]
export type KeyQuestion = Course["keyQuestions"][number]
export type Policy = (typeof POLICIES)[number]
export type Lesson = z.infer<typeof Lesson>
export type Concept = Lesson["concepts"][number]
export type Guess = Lesson["guesses"][number]
export type Misconception = Lesson["misconceptions"][number]
export type Exercise = z.infer<typeof Exercise>
export type ExerciseType = Exercise["type"]
export type Opt = z.infer<typeof Opt>
export type Link = z.infer<typeof Link>
export type PublishedManifest = z.infer<typeof PublishedManifest>
export type PublishedEntry = PublishedManifest["courses"][number]
export type NotBuiltList = z.infer<typeof NotBuiltList>
export type NotBuiltEntry = NotBuiltList[number]
