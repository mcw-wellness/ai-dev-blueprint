# How to run experiments

**TDD does not apply to experiments.** Experiments are exploratory — you don't know the answer yet, so you can't write tests first.

## When to experiment vs develop

| Signal | Mode |
|--------|------|
| "Build feature X", "Add Y", "Fix Z" | **Development** — see [how-to-develop.md](how-to-develop.md) |
| "Let's try...", "What happens if...", "Test whether...", "Investigate..." | **Experiment** — this doc |

## Scientific method (mandatory)

1. **Hypothesis** — What are you trying to prove/disprove? Be specific.
2. **Setup** — Exact commands, versions, parameters, hardware.
3. **Procedure** — Step-by-step plan. One variable at a time.
4. **Execute** — Run it. Record ALL output (success AND failure).
5. **Analyze** — Root cause, not just "it didn't work."
6. **Document** — Update audit log immediately. Commit raw logs as evidence.
7. **Extract** — If a durable observation was found, extract it as a **finding** (see [spec-anchored.md](spec-anchored.md)).

## Key rules

- **One variable at a time** — multiple changes = useless results.
- **Run multiple times** — single run proves nothing.
- **One experiment at a time** — never run experiments in parallel. Slow and systematic.
- **Document failures** — they're MORE valuable than successes.
- **Findings are not specs** — experiments produce findings about things you don't control. Specs describe what you build.

## Especially for hardware

Hardware experiments cannot be unit-tested in isolation. The scientific method is the *only* discipline that keeps you honest when the device is opaque:

- Peripheral behavior is frequently not what the datasheet says. Assume the datasheet is approximate until you've probed.
- Log everything. Power, timing, USB, serial, RF, side-channels — capture whatever might explain the outcome.
- Keep previous-known-good configurations reproducible. When today breaks, you need to diff against what worked yesterday.
- One board, one variable, one run at a time. "I changed three things and one of them fixed it" is not an answer.
- Photograph wiring and probe placement. Notes aren't enough; a picture disambiguates six months later.

## Experiment directory structure

Each project defines where experiments live. Standard layout:

```
YYYY-MM-DD_<short-description>/
├── AGENTS.md       # Ground rules, hypothesis, what we're trying to achieve and WHY
├── audit-log.md    # Structured record: each attempt as an entry
├── README.md       # Optional: background context, setup notes, links
├── findings.md     # Optional: durable observations extracted from this experiment
├── scan.py / run.sh / *  # Experiment scripts live INSIDE the experiment dir
└── logs/           # Raw output — commit these as evidence
```

**Scripts belong inside the experiment directory, not in the repo-wide `scripts/` dir.** Experiments are allowed to hack — keeping the script next to its `AGENTS.md` keeps results reproducible, scoped, and teardown-atomic. If a script proves out, **promote it deliberately** to `scripts/` or `src/` with tests — that is a separate, conscious step. Don't let experimental scripts silently become production dependencies.

## Templates

- [project-level/experiment-AGENTS.md](project-level/experiment-AGENTS.md) — hypothesis, ground rules, setup
- [project-level/audit-log.md](project-level/audit-log.md) — structured record of each attempt
- [project-level/findings.md](project-level/findings.md) — durable observations

## Experiment → development transition

When an experiment succeeds and you want to productionize the result:

1. Extract findings into a finding document
2. Create a spec for the feature (referencing the finding)
3. Switch to [how-to-develop.md](how-to-develop.md) — TDD, reviews, the whole loop
