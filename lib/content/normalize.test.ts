import { describe, expect, it } from "vitest"

import { normalizeAnswer } from "./normalize"

describe("normalizeAnswer", () => {
  it.each([
    ["Mitochondria", "mitochondria"],
    ["  mitochondria  ", "mitochondria"],
    ["Mito-chondria.", "mitochondria"],
    ["the cell's powerhouse", "thecellspowerhouse"],
    ["“quoted”", "quoted"],
    ["New\tYork\nCity", "newyorkcity"],
    ["ＡＢＣ１２３", "abc123"], // full-width forms fold under NFKC
    ["ﬁ", "fi"], // ligature
    ["Ünïcödé", "ünïcödé"], // letters with marks are kept
    ["e = mc²", "e=mc2"], // symbols are not punctuation; NFKC folds ²
    ["$5", "$5"],
    ["...", ""],
    ["   ", ""],
  ])("%j → %j", (input, expected) => {
    expect(normalizeAnswer(input)).toBe(expected)
  })

  it("does no fuzzy matching", () => {
    expect(normalizeAnswer("mitochondrion")).not.toBe(
      normalizeAnswer("mitochondria")
    )
  })
})
