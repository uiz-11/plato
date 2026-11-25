import { describe, expect, it } from "vitest"

import { exerciseAnsweredFrom } from "./exercise"

// Reading an answered exercise back from the server (§8.4).

const stored = {
  correct: false,
  confidence: "sure" as const,
  selfMark: null,
  grade: "forgot" as const,
}

describe("exerciseAnsweredFrom", () => {
  it("rebuilds the answer and its marking", () => {
    const answer = {
      kind: "exercise" as const,
      response: { type: "mc" as const, optionId: "o1" },
      confidence: "sure" as const,
    }
    expect(exerciseAnsweredFrom({ type: "mc" }, { ...stored, answer })).toEqual(
      {
        answer,
        marked: stored,
      }
    )
  })

  it("keeps the marking of an answer it cannot read, so Next still works", () => {
    for (const answer of [
      null,
      { kind: "rating" as const, grade: "forgot" as const },
      {
        kind: "exercise" as const,
        response: { type: "fill" as const, text: "x" },
        confidence: "sure" as const,
      },
    ]) {
      expect(
        exerciseAnsweredFrom({ type: "mc" }, { ...stored, answer })
      ).toEqual({ answer: null, marked: stored })
    }
  })

  it("is null when nothing was answered", () => {
    expect(exerciseAnsweredFrom({ type: "mc" }, null)).toBeNull()
  })
})
