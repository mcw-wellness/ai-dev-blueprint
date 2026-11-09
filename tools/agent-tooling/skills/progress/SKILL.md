---
name: progress
description: Report progress as a table of steps with measured times, labelled estimates and the UTC finish, or where the time went and how to finish sooner; plan a timeline for work not yet started from measured durations. Use for progress, status, ETA, any time left or expected finish (the one closing a `Running:` message too), whether it is done, how long, a timeline or plan estimate, an estimate that seems too long or needs checking, speed it up, ASAP, why slow, blockers.
---

# Progress

Measured timings and estimates, re-measured each answer, never recalled.

## Measure

```sh
uv run ~/agent-tooling/skills/progress/scripts/session_timeline.py [SESSION ...] [--handoff FILE] [--since HH:MM]
```

- `--handoff` adds its board lines and every session on its `Session:` line.
- `--since` skips the session's earlier work: UTC `HH:MM`, or ISO.

## Steps and estimates

- A step is a unit the owner recognises (explore, a component, tests, a review, CI, a merge), not a call: from the plan (handoff `## Plan`, `PLAN.md`, task list), else the timeline. A subagent's step is its own span; overlapping steps are marked parallel; work with no transcript is unmeasured.
- Every estimate is computed from its steps, never a lump such as "about 2 h (an audit with fixes)" (owner, 2026-10-27: "consider what the subtasks are, what their connection is, what depends on each other, what is serial vs what is parallelizable, how long the individual subtasks take and then use that to compute the estimate"): split what is left into steps (a subagent's brief lists its own), give each a labelled estimate from comparable measured steps (Plan a timeline, step 2), mark what waits on what and what runs in parallel, and sum along the critical path. Every wait is a step: CI, review rounds, serial merges, deploys, other sessions, owner approvals.
- Always show the steps behind an estimate (owner, 2026-10-27: "always give at least a rough overview of what the steps are"): at least its sum in one line, each step in plain words with its minutes, parallel steps in brackets: `~95 min = audit 25 → (2 fix PRs 40 ∥ docs 10) → Release 15 → host check 15`; in a progress answer that is its `Remaining:` line, under the table.
- Fan out per AGENTS P2 and P4 (owner, 2026-11-07: "as much as possible use subagents and do things in parallel to speed it up"): runners, the merge queue, model quota, agent and spot caps and the GitHub budget are serial resources, read from their limits; stop fanning out once the critical path is a wait no agent shortens.
- A deadline is no estimate.
- Each `Gate:` is a row, its progress read from content; the finish is no earlier than the latest gate; a stalled gate is a blocker.
- A round-based goal: rounds left from the measured find-rate trend, each at measured round length.

## ETAs and tripwires

From Kei's Vanna (2026-10-29).

- **ETA ledger**: a `Running:` verdict's UTC finish (`done ~14:30Z`; ISO beyond 18 h) is your ETA; the Stop hook keeps it (`tools/status/eta.py`) and the owner's phone shows each tab's ETA and how far it moved. Any other verdict closes it. A `Running:` without a finish, or with one already past, goes back once. Once the finish has moved past the first by max(15 min, half the first estimate), say so in that reply, opening a line with (Changes): the original finish, the new one and the time now; a reply that does not name the original goes back once. Board's `Slip:` rule stays the handoff's `Finish:`: move both when they are one promise.
- **Tripwire**: to watch a number (PnL, paper against live, a queue's depth) without polling, run `python3 ~/agent-tooling/skills/progress/tripwire/tripwire.py NAME --cmd CMD --rule RULE [--vs CMD] [--every 60] [--desc TEXT]` with Bash `run_in_background`; `--help` lists the rules (`below -500`, `drop 200 in 1h`, `drawdown 5% in 1h`). It exits with a `⚑ tripwire` note when the rule trips or its command breaks, which wakes you, not the owner: look, reply with the tag the note names, then run the same command again to keep watching. While one runs your session shows Working: reply `Running:` with the tripwire as what wakes you and when you will stop it as the finish. It dies with your session.
- **Overdue wake**: 5 min after your finish passes with no new verdict while the session is idle, a Stop hook (`tools/status/eta_wake.py`) wakes you once with a note; nothing sends that reply back, so it closes with its verdict or gives a new `done ~HH:MMZ` with a (Changes) line naming the original, the new finish and now. A session showing `◐` (a tripwire, a background wait) is never woken: what it waits on wakes it.
- **Screens**: the phone's ETAs and Tripwires screens read these files (`~/.runtime/etas/`, with each move's (Changes) reason and closed ETAs for 6 h; `~/.runtime/tripwires/`), so the verdict line and the tripwire's `--desc` are what the owner reads there.

## Plan a timeline

For work not started (a design's change list, a plan), never agent-days or a guessed total (owner, 2026-10-27: "grounded in facts and not just wild guesses"):

1. **Units**: split each change into its pull requests, each with a repository and a size bucket (lines added plus deleted: <=100, 101-400, 401-1500, >1500), plus its Releases, observations and fixed waits (a shadow day, a soak).
2. **Measure**: `uv run ~/agent-tooling/skills/progress/scripts/session_timeline.py --pr-timings REPO ... [--json]` gives subagents' start (or previous PR) to open and open to merge, p50 and p90, of merged pull requests only (still-open slow ones drop out, so p90 reads low; `--owner` for another GitHub owner), per repository and bucket (pool a bucket across repositories where a cell has under 5 samples); Release runs from `gh run list`. Work no bucket fits (a port, a new subsystem) takes the measured span of the closest finished thread (LOG.md, `gh pr list`), named.
3. **Graph**: dependencies by need, not by the order of thinking. Agents are not the limit: serial resources are (merges colliding in one file or module, one Release per environment, a host's window), so those queue.
4. **People**: each gate (owner reply, quant owner, a hold, a per-instance go) is a node clearing when first needed; report the latest each can clear without moving the finish.
5. **Answer**: the finish at p50 and at p90, the critical path, the gates with their slack, and a script that computes it from the data, so the next estimate re-runs rather than re-guesses. Cross-check the total against a comparable finished thread.

## Challenge an estimate

Before the first estimate over 30 minutes, and whenever the owner challenges one (owner, 2026-11-07: "oftentimes my AI spits out an estimate that seems way too long"), re-derive it rather than repeat it, in at most a tenth of its length. The result may lower, keep or raise it; first estimates have run about twice as long as needed, so expect to lower it (median 0.46 of the promise over 96 first estimates, 14 days to 2026-11-07; `calibration.py` gives today's). Use the step graph of Steps and estimates or Plan a timeline; build no second plan.

1. **Path**: check what the actual pipeline reuses (a checked tree, the pull request's run or image on main, an incremental recompute) before pricing a step.
2. **Basis** for each step: a comparable measured step with queueing included and the same boundaries, workload and runner class; a throughput from one uninterrupted window. `uv run ~/agent-tooling/skills/progress/calibration/calibration.py [--days 14]` gives recent first estimates against their `Done.`: state its n and median as context, never as a multiplier on a measured step or a fixed wait.
3. **Cut**, each named:
   - an agent step (a review, a recheck, a short subagent) priced at 20 to 30 minutes where comparable ones took 1 to 5;
   - a running check or review charged its full length instead of what is left;
   - independent units run serially (fan them out, Steps and estimates);
   - a p90 where the p50 is the finish (give the p90 apart);
   - one wait counted twice (CI inside a review round, a Release inside verification);
   - review rounds, rebases, retries or Releases assumed before they are needed (a fix round before the review reported, a Release another one already carried), beyond the first required review; carry failure risk at its measured rerun rate;
   - human pace (agent-days, "an afternoon") where measured agent spans exist;
   - a step waiting on one it does not need;
   - per-PR review and CI cycles one merge train replaces;
   - a calendar wait (soak, shadow day, warm-up) a gate ending on evidence can replace, unless a rule or the owner fixed it;
   - a wait an agent added itself (batched restarts, Release windows, extra gates) that no rule requires;
   - a dispatch nobody owns: name who dispatches it.
4. **Add** what is missing: owner approvals, queues on shared resources, reruns at their measured rate; scope added since the last estimate, stated apart from rate error.
5. **Answer** in the `Remaining:` line: `claimed ~X min → challenged ~Y min = a 10 → (b 20 ∥ c 15) → d 5`, one line per change, the p50 as the finish. Start resulting work only within the task's authorization; an estimate asked about other work starts nothing.

## Answer

| State | Step | Took (m) | Left (m) |
| --- | --- | ---: | ---: |
| Done | 4 earlier steps ([handoff](…)) | 62 | — |
| Done | Explore the transcript format | 3 | — |
| Running | Script that times each step (subagent, parallel) | 14 | ~5 |
| Running | CI for the stuck-order fix (pe#1004) | 6 | ~8 |
| Blocked | Release: waits for the publish job | — | ~10 |
| Next | You: approve the prod run | — | — |

- State is Done, Failed, Running, Blocked or Next (AGENTS Writing), rows grouped in that order, each chronological; past the last three, Done steps fold into one row.
- Step: what it does in plain words someone juggling several sessions follows, at most twelve, then its ID in brackets (`CI for the stuck-order fix (pe#1004)`), never an ID or code name alone (owner, 2026-10-27); a blocked step names its blocker and your step opens with "You:"; detail goes in the handoff, never the row.
- Took and Left: one figure each in whole minutes, `~` marking an estimate, `—` for none.
- Chart, whenever two or more steps are open (owner, 2026-10-27): under the table, one ```` ```mermaid gantt ```` fence of what is left (owner, 2026-11-03: "for /progress a gantt chart is usually more useful"): a section per strand on one UTC clock, measured spans `:done`, running ones `:active` to their estimated end, the rest from their estimates placed after what they wait on, the critical path's steps `crit`.
- Below: `Remaining: ~25 min = CI 9 → merge 2 → (Release 8 ∥ docs 5) → host check 6`, dominated by CI, the expected UTC finish along the critical path (parallel steps once), how it moved since the last estimate and why, elapsed wall time and, when material, the owner-wait share. After a slip (handoff skill), the measured cause and the plan change.
- Last, always: what waits on the owner (owner, 2026-10-27), as one `🔴 **Needs you:**` block per AGENTS Writing, or the line `Needs you: nothing.` Gather it fresh: this session's open questions and blocked steps, the handoff's Plan rows marked `you` and open asks blocked on him, and `board --status`'s `needs_you` items starting with the thread's name and `: `.

## Numbers

A number the owner acts on is a row; compare rows only when metric, unit, env and window match; say when they differ.

| Metric (unit) | Revision | Env, window | Measured or projected | Value | Evidence |
| --- | --- | --- | --- | --- | --- |

## Speed up

Asked to go faster, why slow or what blocks:

- `--sinks` splits wall time into owner waits, gaps over 2m by class, and active work (`--json` adds candidate cuts); reclassify a misfiled gap, saying so.
- Name the critical path's dominating step; work beside it saves nothing.
- Look first for repeated work (a run or image main could reuse, a superseded run, a full recompute where an incremental path exists), then time the slow step's stages and name the binding constraint (queue, setup, compute, I/O, a vendor limit, a fixed wait) before adding concurrency or capacity, which paid off in 1 of 7 measured cases.
- A saving counts once observed to the same completion condition on matching workloads (same runner class, 3 or more runs); until then call it projected.
- `| Rank | Option | Basis | Saves | Trades |`, largest measured saving first; trades are nothing, verification (what the dropped check catches), cost (dollars) or risk to money (the instance). Never an option breaking a safety contract, authorization or hard limit.
- Each blocker on the path: the smallest clearing action and who acts.
- Answer: the `--sinks` table, the critical-path line, options, blockers; no progress table.
- Never drop a check silently. Apply what trades nothing within authorization; ask the rest in one batch.
