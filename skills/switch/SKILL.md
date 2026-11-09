---
name: switch
description: Move the current Claude session to another profile (claude-almir, claude-eventus, claude-tcp, claude-vvs, …) and keep working there, e.g. when this profile's tokens run out. Use when Almir says "/switch <profile>", "switch to almir", "move this session to tcp".
user-invocable: true
allowed-tools:
  - Bash
---

# Switch profile

With a profile named (`/switch almir`), run:

```bash
python3 ~/.claude/skills/switch/switch.py <profile>
```

It copies this session into that profile and opens it there in a new Terminal window, with the
whole conversation. Then tell Almir in one line: it's open in a new window, and this old one can be
closed (`/exit`).

Without a profile, show the weekly use of each profile and ask which one:

```bash
python3 ~/.claude/skills/ai-usage/ai-usage.py --weekly-line
```

Never pick the profile yourself: profiles are separate accounts with different owners.
