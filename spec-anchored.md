# Spec-Anchored Development

Specs are **living documents** that stay alive for the entire lifetime of a feature — not just during initial implementation. When you return 6 months later, the spec is still the source of truth for intent.

| Level | Spec lives... | Human edits... |
|-------|---------------|----------------|
| Spec-first | until task is done | code |
| **Spec-anchored** (us) | **while feature lives** | **spec + code** |
| Spec-as-source | forever | only spec, code is generated |

## Rules

1. **No code without a spec.** Before writing code, create or update the spec.
2. **Spec and code change together.** Spec updates ship in the same commit as code changes.
3. **Spec describes intent, not implementation.** What, why, boundaries, edge cases. Code handles the how.
4. **Document the WHY.** Every major decision must have rationale.
5. **Document alternatives considered.** What you rejected matters as much as what you chose.
6. **AI agents:** check for existing spec before modifying a feature. Read it first. Update when done. Remind user if a behavior change lacks a corresponding spec update.

## Spec Template

See [project-level/SPEC.template.md](project-level/SPEC.template.md).

## Classification — Know the Difference

| Type | What it is | Lives in | Example |
|------|-----------|----------|---------|
| **Spec** | What we intend to build — our code, our design, our behavior | `specs/` | AVD protocol, Android kiosk app, remember-me feature |
| **Finding** | What we observed about things we don't control — hardware, libraries, APIs | `experiments/findings/` or project equivalent | "SandenVendo skips VEND SUCCESS", "TFLite rejects transformer attention ops" |
| **Decision / ADR** | Architectural choice between 2+ alternatives that constrains future work | `specs/decisions/` (ADR) or spec decision log (local) | "Kotlin over Flutter", "MDB only, no MQTT between devices" |

## Common Mistakes

- **"The machine does this weird thing"** → That's a **finding**, not a spec. You didn't design it, you observed it.
- **"We tested 3 OCR APIs and picked Google Vision"** → The eval is a **finding**. The choice is a **decision**. Neither is a spec. The spec is "cloud OCR for MRZ" which references the decision.
- **"We chose X over Y"** → Only a **decision** if there were 2+ viable alternatives with real trade-offs. If X was the only option, it's just implementation — put it in the spec.
- **Experiment results in specs** → Experiments produce **findings**, not specs. The finding informs the spec, but they're separate documents.
- **Research in decisions** → Research results are **findings**. A decision is the *choice you made* based on research, not the research itself.

## How They Connect

```
Finding: "Google Vision returns MRZ in 400ms, Azure in 600ms, our model in 200ms but 39.7% accuracy"
    ↓ informs
Decision: "Use Google Vision for cloud OCR (best accuracy/latency balance at acceptable cost)"
    ↓ referenced by
Spec: "Phase 1 cloud OCR pipeline — uses Google Vision API (see Decision 005)"
    ↓ updated after implementation with
Lessons learned: "Google Vision struggles with IR-lit documents, had to add preprocessing step"
```

## Spec Decisions vs ADRs

| | Spec Decision | ADR |
|---|--------------|-----|
| **Scope** | One feature | Multiple features or whole project |
| **Lives in** | Decision log table inside the spec | `specs/decisions/NNN-*.md` (numbered record) |
| **Example** | "Use CameraX not Camera2" (MRZ scanner spec) | "Kotlin native for Android app" (affects all phases) |
| **Approval** | Implicit — part of spec review | Explicit — requires human approval |
| **Template** | Table row: Date, Decision, Why, Who | [project-level/ADR.template.md](project-level/ADR.template.md) |

**Rule of thumb:** If changing the decision only requires updating one spec → spec decision. If it would require updating multiple specs or rethinking the architecture → ADR, give it a number.

## ADR Rules

- Create when a decision spans multiple features
- Never reuse numbers (even if deprecated)
- Link superseding decisions bidirectionally
- **Require human approval** before creating or modifying
- See [project-level/ADR.template.md](project-level/ADR.template.md)

---

# Documentation Structure

Three distinct categories of document. Each has a deliberate location and naming style so readers immediately know what they're looking at.

| Category | Contains | Location | Naming | Volatility |
|---|---|---|---|---|
| **Status docs** | Where we are, what's left | Repo root | `UPPERCASE.md` (e.g. `ROADMAP.md`, like `README.md`) | High — updated every work session |
| **Specs** | What we are building, how it works, why | `specs/` | `lowercase-with-hyphens.md` | Low — updated on real design changes |
| **ADRs** | Architectural decisions with context and consequences | `specs/decisions/` | `NNN-short-slug.md` (zero-padded) | Immutable once approved |

## Status docs

At minimum, every project should have a `ROADMAP.md` at the repo root. It is the **single source of truth** for what's done and what's left. `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` follow the same uppercase-at-root pattern when they exist.

Status docs are short, scannable, updated often. They don't define "done" (an ADR does) or duplicate spec content — they cross-reference both.

## Specs

Design documents. One spec per feature or component. Spec files never contain code — they describe the contract. The `specs/` directory is the long-lived knowledge base: what the system does, why it was designed this way.

Spec filenames are `lowercase-with-hyphens.md` (e.g. `architecture.md`, `legacy-signal-api.md`, `testing-strategy.md`).

## ADRs

Architectural Decision Records. Numbered `NNN-short-slug.md` (e.g. `004-parallel-import-verification.md`). Immutable once approved — if a decision changes, write a new ADR that **Supersedes** the old one; never edit history.

## Open questions — inline with stable IDs

Open questions are **not** stored in a central file. They live inline in whatever doc raises them, at the point where the context matters. Format:

```markdown
> **Q-NNN OPEN** — short statement of the question.
> Why it matters / what it blocks.
> To answer: how to resolve.
```

When answered, flip the marker in place:

```markdown
> **Q-NNN ANSWERED** (YYYY-MM-DD, resolved by [ADR-00M](path) / [spec §X](path)) —
> the answer.
```

**Numbering**: `Q-NNN` is a flat project-wide namespace, three digits, never reused. Assigned in order raised. A question lives in exactly one doc — if it's cross-cutting, it goes in the roadmap or a scoping section; otherwise it goes next to the design concern it affects.

**Global view** via grep:

```bash
rg '^> \*\*Q-\d+ OPEN\*\*'     # all unresolved
rg '^> \*\*Q-\d+ ANSWERED\*\*' # historical answers
```

**Rule**: when planning a feature or entering implementation, any Q-NNN OPEN that blocks the work must be answered first. Answering = flipping the marker to ANSWERED with a resolution link.

## Rules for keeping these clean

- **Specs own their domain.** If a spec discusses a topic, any open question on that topic lives inline in that spec.
- **Roadmap tracks status only.** It does not define "done" (that's an ADR) and does not contain spec content.
- **ADRs are immutable once approved.** Write a superseding ADR rather than editing.
- **Open questions never go in a central file.** They live where the context is. The index is produced by grep, not by a list.
- **Cross-reference by ID, not by content.** If `specs/foo.md` needs to mention an open question raised in `specs/bar.md`, reference `Q-NNN` — don't copy the question content.
