# How to run a Ralph project

A **Ralph project** is a special spec that groups several feature-size specs into one named workstream, then hands them to an autonomous loop (Ralph) that chews through them with human check-ins. Think of it as an epic with a running log. Sized to be achievable in a reasonable time slice — however many specs that takes.

Two phases. Completely separate.

- **Phase 1 — Definition.** Human + AI shape the project and its specs. Human is always in the loop.
- **Phase 2 — Execution.** Ralph runs the loop. Human checks in (next morning, or whenever).

Ambiguity is acceptable at handoff. Ralph resolves unknowns by defaulting to KISS + YAGNI and logging the call — redo is cheaper than stall. See [philosophy.md](philosophy.md).

---

## Phase 1 — Definition

Always human-led. Output is one file: `specs/ralph-<name>.md`.

1. **Name it.** `specs/ralph-<short-name>.md`. Lowercase-hyphens, like any spec.
2. **State the goal.** One paragraph. The overarching vision is what Ralph uses as a tie-breaker when it has to make a KISS/YAGNI call mid-loop. If the human hasn't written one, Ralph asks before anything else.
3. **List candidate specs.** Create stub files in `specs/` if they don't exist yet. Order them linearly. Dependencies as prose — no DAG.
4. **Validate AI-testability** (critical — see [philosophy.md §AI-testability](philosophy.md#ai-testability)). For each spec, AI and human agree on how AI will verify the work without a human-in-the-loop step. Surface every hardware / external-service / cloud-credential dependency and design a concrete workaround — recorded video fixtures, emulators, mocks, stubbed hardware, test env vars, sandboxed cloud accounts. If a spec has no credible AI-testable path, either redesign the spec, change the project scope, or flag it as human-gated. Don't hand untestable specs to Ralph — they always get stuck.
5. **Triple-review is optional per spec.** Use it on risky ones. AI can suggest which specs deserve it. Cheap specs can enter the project as `draft` and get reviewed (or not) later. See [how-to-review-spec.md](how-to-review-spec.md).
6. **Hand off.** Human says "kick it off." No formal gate.

Status values on each spec: `draft | ready | in-flight | done | stuck`.

---

## Phase 2 — Execution

1. **Session start.** Human is usually present — treat this as a short dialogue, not a silent halt. Ralph:
   - Reads the project file. Confirms goal, spec list, order.
   - **Verifies the AI-testability environment is live.** Required hardware attached or emulator ready? Env vars / credentials set? Fixtures, recordings, mocks in place? If anything is missing, ask the human now — don't discover it mid-loop.
   - Raises any remaining questions as `Q-NNN OPEN` (format: [spec-anchored.md](spec-anchored.md) §Open questions), reviews them with the human, documents answers inline. If human isn't around, halt until they are.
2. **Pick next spec.** First one in order that isn't `done`. If it's `ready`, start work. If it's `draft`, halt and ask for promotion — **unless** the human has left an instruction like "fill gaps with KISS+YAGNI, I want to play tomorrow," in which case treat `draft` as `ready` and document every gap filled.
3. **Work the spec.** TDD, then code. Triple code review on the diff (Gemini + Codex + CodeRabbit, Opus arbitrates). See [how-to-develop.md](how-to-develop.md) and [how-to-review-code.md](how-to-review-code.md).
4. **On ambiguity.** Opus picks KISS/YAGNI, appends a line to the **Decisions log** section, continues.
5. **On issue or workaround.** Flaky test, rate-limited service, missing fixture, unexpected library behaviour — anything Ralph had to work around to keep moving. Log to the **Issues & workarounds** section: what happened, what was tried, what finally worked. Don't suppress these — they are the signal for the next morning's human review.
6. **On discovered new spec.** Append it to the spec list as `draft` with a one-line note. Keep working the current spec.
7. **On reviewer severity disagreement.** Pick the harsher call, document, continue.
8. **On stuck** (~5 iterations no progress). Flip status to `stuck`, log why, halt the project, wait for human.
9. **On spec done.** Flip to `done`. Pick next.
10. **On project done** (all specs `done`). Halt with a one-paragraph summary that explicitly surfaces the **Issues & workarounds** and **Decisions log** — they're the agenda for the human review. Human reviews.

---

## The file's shape

```markdown
# Ralph: <name>

## Goal
<one paragraph — the overarching vision>

## Specs (in order)
1. [spec-a.md](spec-a.md) — done
2. [spec-b.md](spec-b.md) — in-flight
3. [spec-c.md](spec-c.md) — ready
4. [spec-d.md](spec-d.md) — draft

## Instructions from human
- (free-form notes — "fill gaps with KISS, I want to play tomorrow", etc.)

## Testability
How AI verifies work without a human in the loop. Shared across specs — per-spec testability lives in the spec.
- **Fixtures / recordings:** <e.g. 4 recorded passport-scan videos at `fixtures/passport/*.mp4`>
- **Emulator / sandbox:** <e.g. Android emulator image, profile X>
- **Mocks / stubs:** <e.g. cloud OCR stubbed via `OcrClient.Fake` for loop runs; real provider only in integration tests>
- **Required env / credentials:** <e.g. `GOOGLE_VISION_KEY`, `AZURE_TESSERACT_ENDPOINT` — sandbox accounts only>

## Open questions
> **Q-001 OPEN** — <question>
> Why it matters / how to resolve.

## Decisions log
- 2026-04-18 — [spec-b] Picked X over Y. Why: KISS, no user-facing difference.

## Issues & workarounds
Things that didn't work as expected and what Ralph did about them. Reviewed by human every morning.
- 2026-04-18 — [spec-b] Google Vision API rate-limited at 10 req/s during loop. Workaround: added 150ms sleep between calls; tests still green. Human: decide if real fix needed before Phase 2 deploy.
```

Both human and Ralph write to this file. Status, instructions, questions, decisions — all plain markdown.

---

## What NOT to add (yet)

- **No DAG / dependency graph.** Linear order is enough until a pilot shows real need.
- **No separate directory per project.** One file. That's it.
- **No separate `DECISIONS.md`.** The in-file Decisions log is enough until it isn't.
- **No estimates, burndowns, owners.** One human, one Ralph.
- **No project-level triple-review.** The per-spec gate does the quality work.
- **No automation yet.** This is a process, not a tool. Automation comes after the pilot proves the shape.
- **No fixed spec count.** Size the project by the goal and the time slice, not by a number.

---

## Pilot log

Informal log of patterns and open questions surfaced during actual runs. Lessons earn promotion into the main body only after they confirm across at least two pilots — don't retrofit rules from a single anecdote.

### 2026-04-18 — Android 17 (Phase 1 definition, in progress)

- **Phase 1 produces more than specs.** Video fixture capture, GCP credential provisioning, device setup — one-off hardware-boundary tasks that aren't specs (not implementable features) but have to be done before Ralph can run. Currently tracked as a **Phase 1 Prerequisites** section in the Android 17 Ralph file. **Q:** promote to a first-class template section, or fold into Testability?
- **Status docs can lie about code state.** `docs/backlog.md` in the target project said Phase 1 "NOT STARTED"; reality was half-implemented with 4 specs already in place. Lesson: during Phase 1 definition, verify state from code + specs + ADRs. Status docs are a hint, not ground truth. **Q:** add "verify actual state" as an explicit Phase 1 sub-step?
- **Applicable ADRs drive scope — but scope their triggers carefully.** ADR 018's "no third-party API keys on device" constraint initially looked like it pulled a Cloud Run Vision auth-proxy spec into Android 17. Re-reading: the hard constraint triggers on "non-dev install / kiosk / beta distribution" — Android 17 is dev-device POC, so the constraint doesn't apply yet. The proxy belongs in a later Ralph project. Lesson: when an ADR flags a "hard constraint," check whether the *trigger* applies to this project's scope before pulling the constraint's mandated work in. **Q:** add "review relevant ADRs, check trigger applicability" to Phase 1 step 3?
- **Order: execute prerequisites before finalizing the file.** If a prereq produces concrete artifacts (paths, endpoints, credentials), do it before writing the Ralph file — otherwise the Testability section fills with placeholders that go stale.
- **Cross-cutting concerns need an explicit ask.** Observability, credential handling, secret storage, security constraints — they emerged mid-definition in Android 17. Could be a short checklist under Phase 1 step 4 (AI-testability) so they don't surprise the loop.
- **Triple-review heuristic, emerging.** Risky / security-relevant / cross-cutting specs → review. Small / low-blast-radius specs → skip. Confirm across more pilots before locking.
- **Experiments may be a Phase 1 prerequisite.** When the first work item is "do we even know if the approach works?" — run an experiment producing a finding, don't try to spec-first. The finding then shapes the actual specs. Ralph loops on specs, not explorations. Recognise the difference early and don't hand a data-starved spec to the loop.
- **Don't do at design-time what the runtime should do.** I was about to pre-pick sharpest video frames offline to feed the OCR eval — which would have evaluated cherry-picked input, not the real pipeline. User caught it. Lesson: eval harnesses must mirror the runtime's input-handling (here: feed whole videos, let the pipeline sample/pick). Applies broadly — whenever you build a test fixture pipeline, ask "does this preprocess the data in a way the real system wouldn't?"
- **High-volatility-in-specs tension.** Ralph project files churn every iteration (status doc behaviour) but live in `specs/` (low-volatility by convention). Watch for ugliness during execution. Sibling execution-log file is the fallback.

---

## Status

**Pre-pilot.** This document will not survive first contact with the first real Ralph project. It exists so we have a plan to start from and mutate. Update the pilot log with lessons as they land — don't polish the main body before contact.
