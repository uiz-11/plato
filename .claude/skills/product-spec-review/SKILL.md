---
name: product-spec-review
description: Review a product specification for correctness, scope, consistency, altitude and brevity, using parallel reviewer agents, then report or apply verified fixes. Use when the user asks to review, proofread, trim or finalize a product spec, or whether one is ready to commit. Not for writing specs, or for technical designs, wireframes or code.
---

# Product specification review

A product specification states the flow, rules and requirements that hold whatever the design. Wording and layout belong to the UX design. How it is built, and whether it is feasible, belong to the technical design. Most problems come from mixing those layers, stating a rule twice, and spending words on minor points.

## Inputs

- **The spec under review.**
- **Its sources**: the docs and URLs it cites, including the previous version, if there is one. The spec must agree with the previous version's product rules, or record each difference in its changes section. The previous version may predate these rules, so don't treat its wording or level of detail as precedent.
- **The user's decisions** in this conversation. Reviewers must not reopen them.

## Mode

- **Edit**, when the user asks to fix, tighten, trim or finalize: run every step.
- **Findings**, when the user asks to review or check, or asks whether it is ready: stop after step 2. Report the verified findings, the proposed fixes and a ready or not-ready verdict, then offer to apply them.
- **One narrow focus**: review it yourself, without agents.

## What a good spec looks like

Apply each rule's reason to cases the rule doesn't name.

1. **Fixed facts, not experience choices.** Keep product rules (statuses, permissions, limits, ordering, data shared) and external constraints. Reduce anything a UX designer could change to the requirement underneath: where something lives, what a page groups, notification mechanics, values shown.
2. **No UI wording or button names.** Describe the action, not the control's label. The only exception is wording an external party requires, with the source cited.
3. **No implementation or feasibility.** Protocols, formats, endpoints and libraries belong to the technical design. Each open item names who resolves it: the technical design or the owner. Each risk is stated as its consequence for the user.
4. **Brief.** Every section and detail earns its place, and space follows importance. Cut sentences that justify a rule, unless the reason changes how the rule is applied. Check this on every revision, because rewrites grow.
5. **Each rule stated once**, in its most specific place, so copies can't drift apart.
6. **Clear after trimming.** Every sentence makes sense to a new reader. When brevity costs clarity, clarity wins.
7. **Consistent.**
   - Terms and statuses are defined once and spelled the same everywhere.
   - The same thing gets the same words throughout.
   - The header's conventions are followed.
   - Cross-references are correct.
   - Table column names make sense on their own and match across tables.
   - Numbering continues the previous version's.
8. **No contradictions.** The overview, principles and scope agree with the features, and no two statements conflict.
9. **Correct claims.** Every claim matches its source and isn't overstated.
10. **Clear scope.** It is unambiguous what's in and what's out. Every state a user can reach is defined, with how they enter it and how they leave it.
11. **Referenced.** The header lists every source, and claims about a source link to it.
12. **Ready to commit.** Links and anchors resolve, tables render, and there is no draft mark, typo or leftover question.

## Workflow

0. **Read** the spec and its sources yourself, so you can judge the reviewers' findings.
1. **Review in parallel.** Run separate general-purpose agents in one turn, so no reviewer's framing biases another. The fact checker needs web access.

   | Reviewer | Rules |
   |---|---|
   | Fact check (report verified claims only as a count) | 9, 11 |
   | Altitude | 1, 2, 3 |
   | Consistency, including differences from the previous version that aren't recorded | 5, 7, 8 |
   | Scope and brevity | 4, 6, 10, 12 |

   Brief each reviewer like this:

   ```
   You are the [name] reviewer for a product specification. Do not edit any file.
   Spec: [path]. Sources: [cited docs and URLs].
   Judge only against rules [numbers] in .claude/skills/product-spec-review/SKILL.md.
   Already decided, do not reopen: [decisions, or "none"].
   Return up to ~25 items, most important first: section, short quote,
   problem, fix (rewritten text, or "cut").
   ```

2. **Verify.** Reviewers are often confidently wrong.
   - For each factual fix, read the cited passage yourself.
   - Drop findings that flag wording required by an external party, where the spec cites the source.
   - Check terms, statuses and links yourself, with search.
   - Settle disagreements between reviewers.
   - Raise with the user any finding that would undo one of their decisions, and any two parallel ways of doing the same job. The owner prefers one shared path.
3. **Apply** (edit mode). Keep the section order and numbering, and add or drop sections only as the content needs.
4. **Final check** (edit mode). Run one agent against all the rules, looking especially for text made unclear, or requirements lost, by trimming. Verify its findings, then apply them.
5. **Report.** Say what was wrong, what you changed or propose to change, what you left alone and why, and what needs the user's decision. Give the line count before and after. Don't commit unless asked.
