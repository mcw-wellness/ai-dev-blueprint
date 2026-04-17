---
name: codex-review
description: Run OpenAI Codex CLI to review code changes, get a second opinion, or ask coding questions.
user-invocable: true
argument-hint: "[review|ask] [prompt or flags]"
allowed-tools:
  - Bash
  - Read
---

# Codex Review / Ask Skill

Use the locally installed OpenAI Codex CLI (`/opt/homebrew/bin/codex`) to get a second AI opinion on code.

## Defaults

- **Binary:** `/opt/homebrew/bin/codex`.
- **Non-interactive mode:** `codex exec "<prompt>"` or `codex review --uncommitted`.
- **Sandbox (default):** read-only. Codex can read any file on the filesystem. It cannot write by default. Good for audits and Q&A; bad for tasks that need Codex to edit.
- **Mode selection flags:**
  - `codex exec` — run the agent with a free-form prompt. Codex decides which files to read.
  - `codex review --uncommitted` / `--base <branch>` / `--commit <sha>` — structured review of a diff.
- **Timeout:** 5 min default (`timeout: 300000`). For spec↔source audits that span 1000+ lines across multiple files, use 10 min (`timeout: 600000`) and run in the background.

## How Codex reads files (important context)

**Codex uses shell commands** (`/bin/zsh -lc "nl -ba …"`, `rg`, `cat`, `head`, `grep`) under its sandbox, not a dedicated read tool. As long as the shell user can read a file, Codex can.

This means — unlike Gemini — Codex does NOT have a workspace-directory restriction by default. It reads absolute paths across repos freely. A spec in `/a/b/repo-A/spec.md` referencing C++ in `/a/b/repo-B/src.cpp` works out of the box with no extra flags.

### When Codex CAN'T read a file

Rare, but know the failure modes:

1. **Filesystem permissions.** `stat`/`open` fails. Codex logs the shell error and reports the file as missing. Fix at the OS level (`chmod`, `ls -la`).
2. **Sandbox elevated to `workspace-write`.** With `-s workspace-write` the sandbox tightens — reads are still allowed across the filesystem, but writes/execs are confined to cwd. This mode alone does not block reads.
3. **`~/.codex/config.toml` restricts `sandbox_permissions`.** If the user's config removes `disk-full-read-access`, reads outside cwd will fail. Check `~/.codex/config.toml` for a `sandbox_permissions = ["…"]` line that excludes full-read.
4. **CI/container environments** where the running user has no access to the target directory. Bind-mount or run from a parent that contains both repos.
5. **A file simply doesn't exist** — check the absolute path by hand (`ls -la /…`) before blaming Codex.

### Diagnosing a silent "Codex didn't read my files" failure

If a Codex review produces suspiciously generic findings, look at the output stream:

```
exec
/bin/zsh -lc "nl -ba /absolute/path" in /workdir succeeded in 0ms:
```

Those `exec` blocks show which files Codex actually read. Missing? Either the prompt didn't tell Codex to read them, or reads failed. A failed read shows `exited 1 in Nms` with stderr — check for `Permission denied`, `No such file or directory`, or sandbox-denied messages.

If a review returns without any `exec /bin/zsh -lc "...read..."` entries for the files you asked about, **the review is bogus — rerun with a more explicit prompt** (e.g. "Start by running `wc -l <each file>` and quoting the first line — confirm you can read all files before any analysis.").

## Subcommands

### 1. `review` (default) — structured diff review

Codex's built-in diff-review mode. Good for PR-style reviews on code you've just written.

**No args — uncommitted:**
```bash
codex review --uncommitted
```

**Against a base branch:**
```bash
codex review --base main
```

**A specific commit:**
```bash
codex review --commit HEAD
```

**Custom focus prompt:**
```bash
codex review --uncommitted "Focus on security and error handling"
```

Prefer `review` when you want Codex to operate on a well-defined diff. Prefer `exec` (below) when the audit is broader than a diff (spec↔source parity, architecture question, cross-repo comparison).

### 2. `exec` / `ask` — free-form prompt

Use `codex exec "<prompt>"` for any audit / question that isn't a diff review.

This is the mode to use for:

- Spec ↔ source divergence audits.
- Cross-repo code comparison ("compare X in repo-A/file-1 to Y in repo-B/file-2").
- Architectural review ("is the order-book state machine in module X thread-safe?").
- Targeted Q&A across a whole repo.

**Example — spec vs C++ audit across two repos:**

```bash
codex exec "$(cat <<'EOF'
Rigorous spec-vs-source audit.

DRAFT SPEC (absolute path):
/Users/me/work/poc/specs/parser-foo.md

AUTHORITATIVE SOURCE (absolute paths — read each):
- /Users/me/work/legacy/drivers/foo_driver.cpp
- /Users/me/work/legacy/protocol/foo/messages.h
- /Users/me/work/legacy/protocol/foo/messages.cpp

Before any analysis: run `wc -l` on each file and quote the first non-comment line of each. This confirms you can read all inputs.

Find every place the spec (a) diverges from the source, (b) omits behavior the source has, (c) adds behavior the source doesn't have, or (d) cites an external standard where the source disagrees.

Output: per-section severity-graded findings with file:line citations for the source.
EOF
)"
```

The leading "run `wc -l`" instruction is deliberate — it forces Codex to prove it can reach every file before it starts reasoning. If it can't, it'll say so and stop, rather than fabricating.

## Instructions for the agent running this skill

1. **Parse args**:
   - No args → `codex review --uncommitted`.
   - `review` / `--base` / `--commit` keywords → the diff-review subcommand.
   - Anything else → `codex exec "<prompt>"`.
   - `ask "<question>"` or user phrase implying a question → `codex exec "<question>"`.
2. **Timeout**:
   - Short questions / diff review of small changes → 5 min (`timeout: 300000`).
   - Spec audits, cross-repo comparisons, anything that must read 1000+ lines → 10 min (`timeout: 600000`).
   - Prefer `run_in_background: true` for audits so you can continue working and react to the completion notification.
3. **Cross-repo audits** (spec references files outside cwd): include the **absolute paths** in the prompt. No extra flag needed — Codex's default sandbox reads across the filesystem. **But**: add a "prove you can read each file" sentinel (e.g. "run `wc -l` on every listed file and report the line count first") so silent misses become visible.
4. **Verify the review before presenting it**:
   - Scan the output for `exec\n/bin/zsh -lc "...<filepath>..." … succeeded` entries confirming each claimed source was read.
   - If a file Codex was asked to read appears only in the prompt and never in an `exec` block, the review did not actually use that file. Re-run with a firmer prompt.
   - If an `exec` block shows `exited 1` with `Permission denied` or `No such file`, it's a filesystem issue, not a Codex bug — surface the error to the user.
5. **Present the output verbatim** — Codex produces structured findings. Don't reformat; summarize only if the user asks for a shorter version.
6. **If Codex finds actionable issues**, offer to fix them (Claude applies the fix, not Codex). Never accept Codex's diagnosis without Claude independently reading the flagged code.

## Overriding defaults

Only override on explicit user request:

- `-m <model>` — use a different model. Default is fine for most work.
- `-s read-only` — explicit read-only (belt and suspenders; this is also the default).
- `-s workspace-write` — needed if Codex should be allowed to write files in the workspace. Implies read access remains full.
- `-s danger-full-access` — full read+write+exec. Avoid unless the user is asking for an autonomous edit session and accepts the risk.
- `-C <dir>` — set Codex's working root. Rarely needed; useful when running Codex from a parent directory while focusing on a subdirectory.
- `--full-auto` — `-a on-request --sandbox workspace-write`. Semi-autonomous agent. Don't use for reviews/audits — only for tasks where Codex should make changes.

## Known failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Review claims files are "not accessible" | Filesystem perms OR restrictive `~/.codex/config.toml` | `ls -la <file>`; inspect config.toml for `sandbox_permissions` |
| Review returns generic findings, no file:line citations | Codex didn't actually read the files it was asked about | Rerun with an explicit "prove-you-read-them-first" prompt |
| Process times out mid-audit | Large cross-repo audit exceeded 5 min | Re-invoke with `timeout: 600000` and `run_in_background: true` |
| `codex review --uncommitted` shows no diff | Working tree is clean OR changes are staged in a state Codex doesn't consider "uncommitted" | `git status`; use `--base <branch>` or stage changes |
| Codex asks clarifying questions in `exec` mode | Prompt was ambiguous; Codex stalled asking for confirmation | Prompt more directly: "Do this without asking for confirmation", "Apply immediately" |

## Examples

- `/codex-review` — Review uncommitted changes.
- `/codex-review --base main` — Review all changes vs main.
- `/codex-review --commit HEAD~2` — Review a specific commit.
- `/codex-review ask "Is there a race condition in appointment-update.ts?"` — Ask a question.
- `/codex-review "Focus on HIPAA compliance"` — Review with custom focus.
- `/codex-review ask "Compare the spec at /a/b/poc/specs/foo.md against the C++ driver at /a/b/legacy/drivers/foo.cpp. Start by running wc -l on each. List every divergence with file:line."` — Cross-repo spec audit. No extra flags needed — Codex reads both absolute paths.
