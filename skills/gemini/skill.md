---
name: gemini
description: Run Google Gemini CLI for web search, code review, brainstorming, or general Q&A. Project-context aware.
user-invocable: true
argument-hint: "[search|review|review-principal|brainstorm|ask] <prompt or flags>"
allowed-tools:
  - Bash
  - Read
---

# Gemini CLI Skill

Use the locally installed Google Gemini CLI (`/opt/homebrew/bin/gemini`, v0.27+) for web search, code review, brainstorming, or general Q&A.

## Defaults

- **Model:** `pro` (alias → `gemini-3-pro-preview` if preview features enabled, else `gemini-2.5-pro`). Always prefer `pro`.
- **Mode:** non-interactive (`-p`).
- **Approval:** `--approval-mode yolo` — user's preference.
- **Timeout:** 5 min (`timeout: 300000`).

Canonical invocation:
```bash
gemini --approval-mode yolo -m pro -p "<prompt>"
```

With stdin:
```bash
<source> | gemini --approval-mode yolo -m pro -p "<prompt>"
```

## Subcommands

### 1. `search` — Web search

Gemini Pro grounds answers in Google Search when the prompt asks for current info.

```bash
gemini --approval-mode yolo -m pro -p "Search the web and answer with cited sources: <query>"
```

**Examples:**
- `/gemini search zebra behavior`
- `/gemini search latest ClickHouse 25.x release notes`

---

### 2. `review` — Code / document / data review

**Purpose: a complementary second perspective, NOT a clone of Codex.** The prompt here is deliberately light — same approach the `@lkbaba/mcp-server-gemini` analyze-content tool used. Do NOT push Gemini into "rigorous, step-by-step, CRITICAL/HIGH/MEDIUM" mode — that mimics Codex and kills the complementary angle. Gemini's value is finding *different* issues than Codex (naming, API design, readability, subtle semantic concerns, edge cases Codex misses), not the same ones with the same ranking.

Use `/codex-review` for depth and rigor. Use `/gemini review` for a second set of eyes from a different vantage point. Run both for anything consequential and union-merge findings.

**Task modes** (user picks one, default = `review`):
- `review` — quality, issues, improvements (default)
- `summarize` — concise summary with key points
- `explain` — break down complex parts
- `optimize` — performance & efficiency suggestions
- `debug` — identify bugs & logic errors + fixes

**Prompt template** — keep it light, let Gemini pick the angle:

```
# Content Analysis Task

## Content Type
<code | document | data>   ← auto-detect from file extension or content

## Programming Language
<language>                 ← auto-detect from file extension (.py → Python, .ts → TypeScript, etc.)

## Analysis Task
Step 1: In one or two sentences, summarize the apparent intent of this code.
Step 2: <task-specific instruction, see below>

## Focus Areas
- <focus1>
- <focus2>

## Anti-Noise Rules (from Google code-review-commons — apply to ALL reviews)
- Do NOT suggest the user "check", "confirm", "verify", or "ensure" something — either it's a real issue (say so specifically) or don't mention it.
- Do NOT explain what the code does back to the author. They wrote it.
- Do NOT comment on pure style (missing trailing newlines, whitespace) unless it affects execution or readability meaningfully.
- If the same issue appears in multiple places, state it once and list the other locations — do NOT repeat the full comment.
- Correctness and logic concerns matter more than stylistic preferences. Prioritize accordingly.
- For diffs specifically: only comment on lines that changed (`+`/`-`), not surrounding context lines.
- For test files specifically: only flag major issues (wrong assertions, missing cases for a key branch), not style or refactoring ideas.

## Output Format
Markdown. Use headers, lists, and code blocks as you see fit. Structure is yours to choose — what suits the review.

## Content to Analyze
<fenced code block with content>
```

**Task instructions** (drop into the template — copied from the MCP verbatim, intentionally open-ended):
| Task | Instruction |
|---|---|
| review | "Perform a thorough review. Identify issues, suggest improvements, and evaluate quality." |
| summarize | "Create a concise summary of the content, highlighting key points and main ideas." |
| explain | "Explain the content in detail. Break down complex parts into understandable segments." |
| optimize | "Analyze for optimization opportunities. Focus on performance, efficiency, and best practices." |
| debug | "Identify potential bugs, logic errors, and issues. Suggest fixes for each problem found." |

**Do NOT add** to the Analysis Task section: "step-by-step reasoning", "CRITICAL/HIGH/MEDIUM grouping", "rigorous", "deep thinking". Those push Gemini into Codex-mimic mode. Let Gemini organize the output however it wants — if it chooses severity grouping on its own, fine; if it gives a prose review, also fine.

**Language auto-detection** from extension:
| Ext | Language |
|---|---|
| `.py` | Python |
| `.ts`, `.tsx` | TypeScript |
| `.js`, `.jsx` | JavaScript |
| `.go` | Go |
| `.rs` | Rust |
| `.java` | Java |
| `.sql` | SQL |
| `.sh`, `.bash` | Bash |
| `.rb` | Ruby |
| `.md` | Markdown (treat as document, not code) |

**Invocation patterns:**

*Review a single file:*
```bash
cat path/to/file.py | gemini --approval-mode yolo -m pro -p "$(cat <<'EOF'
# Content Analysis Task
## Content Type
code
## Programming Language
Python
## Analysis Task
Perform a thorough review. Identify issues, suggest improvements, and evaluate quality.
## Focus Areas
- security
- error handling
## Output Format
Markdown.
## Content to Analyze
EOF
)"
```

*Review uncommitted diff:*
```bash
git diff HEAD | gemini --approval-mode yolo -m pro -p "<same template, Content Type = code, omit Programming Language (diff may span languages)>"
```

*Review changes vs base branch:*
```bash
git diff main...HEAD | gemini ... -p "<template + Focus Areas including 'regressions vs main'>"
```

*Review a specific commit:*
```bash
git show <sha> | gemini ... -p "<template>"
```

**For remote PRs** — delegate to the installed `code-reviewer` agent skill (Google's official). Just ask naturally and let Gemini's skill discovery activate it:
```bash
gemini --approval-mode yolo -m pro -p "Review PR #<number> in this repo using the code-reviewer skill."
```
It'll run `gh pr checkout`, preflight, read PR context, and return a structured review.

---

### 3. `review-principal` — Rigorous "Principal Engineer" review

**Purpose: opt-in rigor.** Use when you explicitly want a sharper, bug-hunting review from Gemini — more hostile than the default `review`, with severity grading and a principal-engineer persona. Sourced directly from Google's `code-review-commons` skill (in `gemini-cli-extensions/code-review`).

**When to use:**
- Before merging something high-stakes
- When you want a Codex-style second pass but from Gemini's different vantage point
- When the default `review` was too soft for the situation

**When NOT to use:**
- Daily code review — `review` is better (complementary, not competing with Codex)
- If you plan to also run `/codex-review` — running both `review-principal` AND Codex mostly duplicates findings. Pick one rigorous + one complementary.

**Prompt template** — same file/diff input as `review`, but with a heavier framing:

```
# Code Review — Principal Engineer Mode

## Persona
You are a very experienced Principal Software Engineer and a meticulous Code Review Architect.
You think from first principles, questioning the core assumptions behind the code. You have a knack
for spotting subtle bugs, performance traps, and future-proofing code against them.

## Objective
Deeply understand the intent and context of the provided code. Then perform a thorough, actionable,
and objective review. Identify potential bugs, security vulnerabilities, performance bottlenecks,
and clarity issues. Provide insightful feedback and concrete, ready-to-use code suggestions.
Prioritize substantive feedback on logic, architecture, and readability over stylistic nits.

## Instructions
1. Summarize the change's intent in one or two sentences before looking for issues.
2. Meticulously trace the logic. Actively consider edge cases, off-by-one errors, race conditions,
   null/error handling, and resource lifecycle.
3. Classify each finding as CRITICAL, HIGH, MEDIUM, or LOW.
4. For each finding: precise location, what's wrong, why, and a concrete suggested fix (code block
   when applicable).
5. For tests: flag only major issues (wrong assertions, missing cases for a key branch).

## Severity Taxonomy
- CRITICAL: security vulnerabilities, system-breaking bugs, complete logic failure
- HIGH: performance bottlenecks (N+1), resource leaks, major architectural violations, severe
  maintainability-breaking code smell
- MEDIUM: typos in code (not comments), missing input validation, over-complex logic, naming
  convention violations
- LOW: hardcoded values → constants, minor log message polish, docstring expansion, doc typos,
  test quality nits, TODOs

## Anti-Noise Rules (apply even in principal mode)
- Do NOT suggest the user "check/confirm/verify/ensure" something. Either it's a real issue — say
  so specifically — or skip it.
- Do NOT explain what the code does back to the author.
- Do NOT comment on purely stylistic issues (trailing newlines, whitespace).
- Same issue in multiple locations → state once, list the other locations.
- For diffs: only comment on + and - lines, not context.

## Content Type / Programming Language / Focus Areas / Content
<same fields as the default `review` template>
```

**Invocation patterns:** identical to `review` — file via `cat | gemini`, diff via `git diff | gemini`, commit via `git show | gemini`. The only difference is the prompt.

**Expected output:** if no issues → "No issues found. Code looks clean and ready to merge." If issues → summary + per-file, per-line findings with severity and suggested fix.

**Comparison with the default `review`:**
| | `review` | `review-principal` |
|---|---|---|
| Persona | Neutral reviewer | Principal Engineer |
| Goal | Complementary second perspective to Codex | Rigorous bug-hunting |
| Severity grading | None required | Required (CRITICAL/HIGH/MEDIUM/LOW) |
| Tone | Evaluative, notes positives too | Hostile-reviewer (in a professional way) |
| Best used alongside | `/codex-review` for depth | Solo, or as backup if Codex unavailable |

---

### 4. `brainstorm` — Project-aware ideation

Patterned after the MCP's `gemini_brainstorm` — supports project-context files, style taxonomy, and structured output.

**Style taxonomy** (user picks one, default = `innovative`):
- `innovative` — emerging tech, new business models, future trends (temperature lean ~0.8)
- `practical` — quick implementation, proven tech, resource-aware, immediate impact (lean ~0.6)
- `radical` — challenge assumptions, 10x not 10%, completely new approaches (lean ~0.9)

Since the CLI doesn't expose temperature, **reinforce the style in the prompt** (stronger language for radical, tighter for practical).

**Project context** — user can pass file paths (README.md, architecture docs, PRD) via `--context <file...>`. The skill reads them and prepends as "Project Background" so ideas fit the real codebase, not generic ones. Use `Read` tool to load each file, then embed content in the prompt.

**Prompt template:**

```
# Brainstorming Session

## Topic
<topic>

## Project Background
<concatenated contents of context files, each prefixed with ### <path>>
Important: ensure your ideas are compatible with this project's architecture and tech stack.

## Additional Context
<optional free text>

## Requirements
- Generate exactly <N> distinct ideas (default 5, user can override with --count N)
- Style: <innovative|practical|radical>

## Style Guidelines
<style-specific bullets, see below>

## Output Format
Markdown. For each idea:
- **Title** — clear, descriptive
- **Description** — 2–3 sentences
- **Pros** — 2–4 bullets
- **Cons** — 1–3 bullets
- **Feasibility** — low / medium / high

End with a short recommendation of your top pick and why.
```

**Style guidelines** (drop into the template):
| Style | Guidelines |
|---|---|
| innovative | Focus on innovation: leverage emerging tech (AI, LLMs, streaming, serverless); explore new business/architectural models; consider future trends; push beyond conventional solutions. |
| practical | Focus on practicality: prioritize quick implementation; use proven technologies; respect resource constraints; focus on immediate impact. |
| radical | Challenge every assumption. Explore completely new approaches. Don't be limited by current constraints. Think 10x, not 10%. |

**Invocation patterns:**

*Bare brainstorm (no project context):*
```bash
gemini --approval-mode yolo -m pro -p "<template with Topic=<x>, no Project Background>"
```

*Project-aware brainstorm:*
1. Read each `--context` file via `Read` tool.
2. Build template with `## Project Background` populated.
3. Run Gemini.

Example user invocation:
```
/gemini brainstorm "how to eliminate TickDB" --context enterprise-dataflow/tickdb-elimination-plan.md enterprise-dataflow/enterprise-data-lifecycle.md --style practical
```
→ Skill reads both files, builds the template, runs gemini.

**Iterating:** use `-r latest -p "<follow-up>"` to continue the same session — e.g. drill into one idea.

---

### 5. `ask` — General Q&A

```bash
gemini --approval-mode yolo -m pro -p "<question>"
```

---

## Instructions for the agent running this skill

1. **Parse args** to pick a subcommand. If ambiguous: lookup/current-info → `search`; open-ended/creative → `brainstorm`; diff/PR/commit/file review → `review` (default; use `review-principal` only if user says "rigorous", "strict", "principal", or asks for "bug hunt"); otherwise → `ask`.
2. **Always** use `-m pro --approval-mode yolo -p`.
3. **Sandbox check — before running any Gemini command that references absolute file paths in the prompt**: scan those paths. If any path is outside the current working directory (and its descendants), append `--include-directories <path>` for each root that's outside. Example: a spec in `/a/b/poc-repo/...` referencing C++ in `/a/b/validus/...` needs `--include-directories /a/b/validus`. Failing to do this **silently degrades the review** — Gemini will fall back to web_fetch, 404, and produce findings based only on files it could actually read.
4. For `review` AND `review-principal`:
   - Auto-detect content type + language from the file extension (use the tables above).
   - Treat `.md` and other prose as `document`, not `code`.
   - Build the full structured prompt (don't freeform).
   - Parse user-provided focus areas into the list (e.g. "--focus security,perf" → two bullets).
   - For diffs: set Content Type to `code`, omit single Language (diff may span many).
   - **Key difference:** `review` uses the light MCP-style prompt (complementary perspective, no forced severity grading). `review-principal` uses the heavier Principal Engineer template (severity grading required, bug-hunt framing). Do NOT mix the two templates.
5. For `brainstorm`:
   - If `--context <files...>` given, Read each file and embed contents in `## Project Background`.
   - Apply the correct style guidelines block.
   - Use `--count N` if user specifies, else 5.
6. Run with `timeout: 300000` (5 min).
7. **Verify the output before presenting it as a successful review.** Scan the log tail for:
   - `Path not in workspace` → sandbox misconfigured. Re-run with `--include-directories`. Do NOT present partial findings as a completed review.
   - `status: 429` / `RESOURCE_EXHAUSTED` → model capacity exhausted. Fall back: `-m pro` → `-m gemini-2.5-pro` → `-m gemini-2.5-flash`. Tell the user which model ran.
   - `All fallback fetch attempts failed` → Gemini tried to grab files via web, failed. Same as sandbox issue — fix and re-run.
8. Present the output to the user verbatim; summarize if very long. If you had to fall back to a lower model, say so.
9. If `review` / `review-principal` finds actionable issues, offer to fix them (Claude applies the fix, not Gemini).

## Overriding the defaults

Only override if the user explicitly asks:
- `-m flash` — faster, cheaper (trivial lookups only)
- `-m <concrete-model>` — e.g. `gemini-3-pro-preview` to force a specific build
- `--approval-mode plan` — read-only mode (Gemini can read + search but not edit). Use if user asks for a safer posture.

## Session-related flags

- `-r latest "query"` — continue most recent session (iterative review/brainstorm).
- `--list-sessions` — list prior sessions.

## Sandbox — reading files outside the current working directory

**This matters a lot.** Gemini CLI sandboxes all its file tools to "allowed workspace directories". By default that's: `$CWD` plus `~/.gemini/tmp/<worktree>/`. Any `read_file` on a path outside those directories fails with:

```
Error executing tool read_file: Path not in workspace: Attempted path "/…" resolves outside the allowed workspace directories
```

**Gemini falls back to `web_fetch` against public GitHub raw URLs** — which 404 for private/enterprise repos — then silently produces findings based only on whatever IS in the workspace. That can look like a successful review but isn't. **Always check the tail of Gemini's log for `Path not in workspace` errors before trusting the review.**

### Fix — `--include-directories`

Add `--include-directories <path>` (repeatable, or comma-separated) for each extra directory Gemini should be allowed to read. Example for a cross-repo spec review where we compare a Python spec against C++ in a sibling repo:

```bash
gemini --approval-mode yolo \
  --include-directories /Users/almir/Documents/GitHub/eventus/validus \
  -m pro -p "<prompt that references both repos>"
```

### When to include extra directories

Any prompt that asks Gemini to compare / audit files that live **outside** the current working directory. Common cases:

- Spec-vs-C++ audits (spec in current repo, C++ in a sibling repo).
- Cross-repo refactoring research (API in repo A, callers in repo B).
- Anything that references an absolute path outside `$CWD`.

If you skip this and the target files exist outside the cwd, the review will degrade silently. **Include the directory or don't run the review.**

## Model capacity / 429 handling

Separate from rate limits — capacity errors look like:

```
status: 429, "No capacity available for model gemini-3.1-pro-preview on the server"
reason: MODEL_CAPACITY_EXHAUSTED
```

The CLI auto-retries with backoff; after 10 failed attempts it errors out. Preview models (`gemini-3-pro-preview`, `gemini-3.1-pro-preview`) are especially prone to this.

### Fallback chain when `-m pro` fails

1. First attempt: `-m pro` (preview if enabled, else 2.5-pro).
2. If 429 with `MODEL_CAPACITY_EXHAUSTED`: retry with an explicit stable model `-m gemini-2.5-pro`.
3. If that also 429s: retry with `-m gemini-2.5-flash` — lower quality but usually has capacity. Note in the output that the review used flash, not pro, so the user can rerun later.
4. If *everything* is 429: wait and retry, OR fall back to `/codex-review` alone. Tell the user — never silently skip Gemini; triple-AI review is a project requirement per this project's `CLAUDE.md`.

### Distinguishing capacity errors from sandbox errors

Both surface as tool failures in the log. Check the error message:

- `Path not in workspace` → add `--include-directories`.
- `No capacity available` / `RESOURCE_EXHAUSTED` → fall back model per above.
- Both at once → fix sandbox first (retry will also re-hit capacity, faster to diagnose).

## Operational notes

- **Free-tier rate limits**: 60 requests/min, 1000/day. CLI auto-retries with backoff. If you see "quota will reset after Xs", wait.
- **YOLO quirk**: even with `--approval-mode yolo`, Gemini may still present a plan and ask "Does this plan look good?" before acting. When you want action not discussion, use forceful phrasing: *"Apply now"*, *"Start immediately"*, *"Do this without asking for confirmation"*.
- **Always check the tail of the output** for `Path not in workspace`, `All fallback fetch attempts failed`, or `Attempt N failed with status 429` before presenting the result as a successful review. A silent review based on unreadable files is worse than no review.
- **Remote PR review**: the official `code-reviewer` agent skill is installed at `~/.gemini/skills/code-reviewer/`. Gemini auto-activates it when the prompt mentions reviewing a PR number or URL. No manual invocation needed.

## Examples

- `/gemini search "ClickHouse 25.x release notes"`
- `/gemini review` — review uncommitted changes (light, complementary to Codex)
- `/gemini review --file reference-doc/tools/extract_document.py --focus security,edge-cases`
- `/gemini review --base main`
- `/gemini review --commit HEAD --task debug`
- `/gemini review-principal --file src/auth.py` — rigorous bug-hunt on a high-stakes file
- `/gemini review-principal --base main` — principal-style pre-merge review of a branch
- `/gemini brainstorm "names for the ingestion service" --style practical --count 8`
- `/gemini brainstorm "how to eliminate TickDB" --context enterprise-dataflow/tickdb-elimination-plan.md --style practical`
- `/gemini ask "difference between ReplicatedMergeTree and SharedMergeTree?"`

### Cross-repo review (sibling directory)

When auditing a spec in repo A against source code in sibling repo B, the invocation MUST include `--include-directories` for B, or Gemini's file tools will fail silently and the review will be bogus.

```bash
gemini --approval-mode yolo -m pro \
  --include-directories /Users/almir/Documents/GitHub/eventus/validus \
  -p "<prompt referencing absolute paths in both repos>"
```

Same pattern scales to multiple extra directories: `--include-directories /path/a --include-directories /path/b` (repeatable), or `--include-directories /path/a,/path/b` (comma-separated).
