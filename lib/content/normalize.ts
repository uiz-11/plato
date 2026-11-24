/**
 * The one answer-matching rule (§7.2): NFKC, lower case, and no punctuation or
 * whitespace. The player, the server and the validator all use this function,
 * so they cannot disagree. There is no fuzzy matching (§14).
 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\s]/gu, "")
}
