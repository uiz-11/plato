import { describe, expect, it } from "vitest"

import type { Exercise } from "@/lib/content/schema"

import {
  canSubmitFill,
  explanationOpens,
  gradeAnswer,
  gradeFromConfidence,
  gradeFromSelfMark,
  gradeRecallPrompt,
  isRetryAt,
  isWrongSure,
  markExercise,
  requeueWrongSure,
  selfMarkFromTicks,
  type ExerciseResponse,
} from "./marking"
import type { Confidence, Grade } from "./types"

const base = {
  concepts: ["c1"],
  pool: "review" as const,
  prompt: "Prompt?",
  explanation: "Because.",
  anchor: "a1",
}
const opts = (p: string) => [
  { id: `${p}-a`, text: "A" },
  { id: `${p}-b`, text: "B" },
  { id: `${p}-c`, text: "C" },
]

const mc: Exercise = {
  ...base,
  id: "mc",
  type: "mc",
  options: opts("o"),
  correct: "o-b",
}
const scenario: Exercise = {
  ...base,
  id: "sc",
  type: "scenario",
  scenario: "A thing happens.",
  options: opts("o"),
  correct: "o-c",
}
const fill: Exercise = {
  ...base,
  id: "fill",
  type: "fill",
  accepted: ["Mitochondria", "the powerhouse"],
}
const spot: Exercise = {
  ...base,
  id: "spot",
  type: "spot",
  sentences: opts("s"),
  faulty: "s-b",
  fixes: opts("f").slice(0, 2),
  correctFix: "f-a",
}
const short: Exercise = {
  ...base,
  id: "short",
  type: "short",
  sample: "A short sample.",
  checklist: ["one", "two", "three"],
}

describe("markExercise", () => {
  it.each<[Exercise, ExerciseResponse, boolean]>([
    [mc, { type: "mc", optionId: "o-b" }, true],
    [mc, { type: "mc", optionId: "o-a" }, false],
    [scenario, { type: "scenario", optionId: "o-c" }, true],
    [scenario, { type: "scenario", optionId: "o-b" }, false],
    [fill, { type: "fill", text: "mitochondria" }, true],
    [fill, { type: "fill", text: "  MITO-chondria. " }, true],
    [fill, { type: "fill", text: "The Powerhouse!" }, true],
    [fill, { type: "fill", text: "mitochondrion" }, false], // no fuzzy matching
    [fill, { type: "fill", text: "..." }, false],
    [spot, { type: "spot", sentenceId: "s-b", fixId: "f-a" }, true],
    [spot, { type: "spot", sentenceId: "s-b", fixId: "f-b" }, false], // right sentence, wrong fix
    [spot, { type: "spot", sentenceId: "s-a", fixId: "f-a" }, false], // wrong sentence, right fix
  ])("%# %s", (exercise, response, correct) => {
    expect(markExercise(exercise, response)).toEqual({ kind: "auto", correct })
  })

  it.each([
    [[0, 1, 2], "full"],
    [[2, 0, 1], "full"],
    [[0], "partial"],
    [[0, 2], "partial"],
    [[], "none"],
    [[0, 0, 0], "partial"], // duplicates count once
    [[5, -1, 0.5], "none"], // out-of-range ticks are ignored
  ] as const)("short answer ticked %j → %s", (ticked, selfMark) => {
    expect(
      markExercise(short, { type: "short", text: "x", ticked: [...ticked] })
    ).toEqual({ kind: "self", selfMark })
  })

  it("rejects a response for another type", () => {
    expect(() => markExercise(mc, { type: "fill", text: "x" })).toThrow()
  })
})

describe("selfMarkFromTicks", () => {
  it.each([
    [0, 2, "none"],
    [1, 2, "partial"],
    [2, 2, "full"],
    [3, 4, "partial"],
    [4, 4, "full"],
  ] as const)("%i of %i → %s", (ticked, total, mark) => {
    expect(selfMarkFromTicks(ticked, total)).toBe(mark)
  })
})

describe("canSubmitFill", () => {
  it.each([
    ["", false],
    ["   ", false],
    ["?!.", false],
    ["a", true],
    [" x ", true],
  ])("%j → %s", (input, ok) => {
    expect(canSubmitFill(input)).toBe(ok)
  })
})

describe("grade table", () => {
  it.each<[boolean, Confidence, Grade]>([
    [true, "sure", "remembered"],
    [true, "not_sure", "partly"],
    [true, "guess", "forgot"],
    [false, "sure", "forgot"],
    [false, "not_sure", "forgot"],
    [false, "guess", "forgot"],
  ])("correct %s, %s → %s", (correct, confidence, grade) => {
    expect(gradeFromConfidence(correct, confidence)).toBe(grade)
  })

  it.each([
    ["full", "remembered"],
    ["partial", "partly"],
    ["none", "forgot"],
  ] as const)("self-mark %s → %s", (mark, grade) => {
    expect(gradeFromSelfMark(mark)).toBe(grade)
  })

  it.each(["forgot", "partly", "remembered"] as const)(
    "a recall prompt rated %s has that grade",
    (rating) => {
      expect(gradeRecallPrompt(rating)).toEqual({
        correct: null,
        confidence: null,
        selfMark: null,
        grade: rating,
      })
    }
  )
})

describe("gradeAnswer", () => {
  it("fills the attempt columns for an auto-marked answer", () => {
    expect(
      gradeAnswer(mc, { type: "mc", optionId: "o-b" }, "not_sure")
    ).toEqual({
      correct: true,
      confidence: "not_sure",
      selfMark: null,
      grade: "partly",
    })
  })

  it("fills the attempt columns for a short answer and ignores confidence", () => {
    expect(
      gradeAnswer(
        short,
        { type: "short", text: "x", ticked: [0, 1, 2] },
        "guess"
      )
    ).toEqual({
      correct: null,
      confidence: null,
      selfMark: "full",
      grade: "remembered",
    })
  })

  it("needs a confidence for an auto-marked answer", () => {
    expect(() =>
      gradeAnswer(mc, { type: "mc", optionId: "o-b" }, null)
    ).toThrow(/confidence/)
  })
})

describe("explanation and re-queue triggers", () => {
  it.each<[Exercise, ExerciseResponse, Confidence | null, boolean, boolean]>([
    // exercise, response, confidence, opens, wrong Sure
    [mc, { type: "mc", optionId: "o-b" }, "sure", false, false],
    [mc, { type: "mc", optionId: "o-b" }, "not_sure", true, false],
    [mc, { type: "mc", optionId: "o-b" }, "guess", true, false],
    [mc, { type: "mc", optionId: "o-a" }, "sure", true, true],
    [mc, { type: "mc", optionId: "o-a" }, "not_sure", true, false],
    [mc, { type: "mc", optionId: "o-a" }, "guess", true, false],
    [short, { type: "short", text: "x", ticked: [0, 1, 2] }, null, true, false],
    [short, { type: "short", text: "x", ticked: [] }, null, true, false],
  ])(
    "%# opens %s, wrong Sure %s",
    (ex, response, confidence, opens, wrongSure) => {
      const answer = gradeAnswer(ex, response, confidence)
      expect(explanationOpens(answer)).toBe(opens)
      expect(isWrongSure(answer)).toBe(wrongSure)
    }
  )
})

describe("requeueWrongSure", () => {
  const id = (s: string) => s

  it.each([
    // queue, index, expected
    [["a", "b", "c", "d", "e"], 0, ["a", "b", "c", "a", "d", "e"]], // three items later
    [["a", "b", "c", "d", "e"], 1, ["a", "b", "c", "d", "b", "e"]],
    [["a", "b", "c", "d", "e"], 2, ["a", "b", "c", "d", "e", "c"]], // exactly at the end
    [["a", "b", "c", "d", "e"], 3, ["a", "b", "c", "d", "e", "d"]], // fewer remain: end
    [["a", "b", "c", "d", "e"], 4, ["a", "b", "c", "d", "e", "e"]], // the last item
    [["a"], 0, ["a", "a"]],
  ])("%j at %i → %j", (queue, index, expected) => {
    const grown = requeueWrongSure(queue, index, id)
    expect(grown).toEqual(expected)
    // The block's total grows by one.
    expect(grown!.length).toBe(queue.length + 1)
    // The inserted copy is the retry; the original is not.
    expect(isRetryAt(grown!, index, id)).toBe(false)
    expect(isRetryAt(grown!, grown!.lastIndexOf(queue[index]), id)).toBe(true)
  })

  it("re-queues an exercise at most once per session", () => {
    const once = requeueWrongSure(["a", "b", "c", "d"], 0, id)!
    expect(once).toEqual(["a", "b", "c", "a", "d"])
    // A wrong Sure on the retry does not re-queue it again.
    expect(requeueWrongSure(once, 3, id)).toBeNull()
    // Other exercises can still be re-queued.
    expect(requeueWrongSure(once, 1, id)).toEqual([
      "a",
      "b",
      "c",
      "a",
      "b",
      "d",
    ])
  })

  it("keys object items, as in the review queue", () => {
    const q = [
      { conceptId: "x", version: 0 },
      { conceptId: "y", version: 1 },
    ]
    const grown = requeueWrongSure(q, 0, (r) => r.conceptId)!
    expect(grown.map((r) => r.conceptId)).toEqual(["x", "y", "x"])
    expect(requeueWrongSure(grown, 2, (r) => r.conceptId)).toBeNull()
  })

  it("does not change the queue it is given", () => {
    const q = ["a", "b"]
    requeueWrongSure(q, 0, id)
    expect(q).toEqual(["a", "b"])
  })

  it("rejects an index outside the queue", () => {
    expect(() => requeueWrongSure(["a"], 1, id)).toThrow(RangeError)
  })

  it.each([-1, 2, 0.5])("isRetryAt rejects index %d", (index) => {
    // 2 is the checkpoint summary position: one past the last exercise.
    const q = [{ conceptId: "x" }, { conceptId: "y" }]
    expect(() => isRetryAt(q, index, (r) => r.conceptId)).toThrow(RangeError)
  })
})
