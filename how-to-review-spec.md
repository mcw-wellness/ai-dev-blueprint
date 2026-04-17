# How to review a plan (pre-code)

Before writing a line of code, the plan goes through two independent reviewers: **Gemini** and **Codex**. This catches bad plans while they're still cheap to fix — before you've committed to an architecture.

This is step 3 of the 8-step loop in [how-to-develop.md](how-to-develop.md).

## What "a plan" means

A plan is a written description of HOW you intend to implement a spec. It's short (one screenful), specific, and testable. It names:

- The files you'll touch
- The data structures you'll introduce or change
- The tests you'll write first (per [how-to-write-tests.md](how-to-write-tests.md))
- The edge cases you already know about
- Any `Q-NNN OPEN` questions still unresolved

If the plan is vague ("add a new endpoint"), the review will be useless. Tighten the plan *before* submitting it.

## Running the reviews

### Gemini

```bash
/gemini review
```

Or with an explicit prompt:

```bash
/gemini ask "<paste the plan> — is the architecture sound? what's missing diagnostically? what would be painful to change later?"
```

Gemini catches:
- **Architectural issues** ("this introduces a circular dependency between X and Y")
- **Diagnostic gaps** ("you have no plan for observing when this goes wrong")
- **Missing abstractions** that will cost you later

### Codex

```bash
/codex-review ask "<paste the plan> — what bugs or edge cases will bite us? what's subtly wrong?"
```

Codex catches:
- **Subtle correctness bugs** ("this handler assumes non-null but the caller can pass null")
- **Edge-case gaps** ("what happens on empty input? on very large input? on malformed input?")
- **Convention violations** (naming, error handling, patterns already established in the codebase)

## Arbitrating the feedback

Two sets of critiques arrive. Claude (Opus) reads both and categorizes each finding:

| Category | Action |
|---|---|
| **Must address** | Real gap. Revise the plan, re-submit for review. |
| **Worth addressing** | Nice improvement. Fold in if cheap, note as follow-up if expensive. |
| **Reject** | Bad suggestion (missing context, wrong assumption). Write one-line rationale. |

The user approves the categorization. No "Claude decided" without explicit sign-off.

## When to revise vs commit

- **Any must-address finding** → revise the plan. Do not start coding.
- Only **worth-addressing** or **reject** findings remain → commit the plan, move to implementation.
- **Zero findings** → either the plan is solid OR the reviewers are missing something. Be suspicious — try one more round with more context.

## Output

The plan plus the arbitration notes are the record. When you're mid-implementation and hit a decision, refer back. When you write lessons-learned in the spec, reference the pre-code review if something reviewers flagged turned out to bite (or not bite) — that calibrates future reviews.
