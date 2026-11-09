// The Needs-you cases both parsers run: reply/parse.test.ts, and tools/status/notify_status_test.py, which reads the
// JSON after the `=`. Each message asks `decisions` decisions; keep the body JSON.
export const NEEDS: { case: string; message: string; decisions: number }[] = [
  {
    "case": "bold-numbered decisions, blank lines between",
    "message": "🔴 **Needs you:**\n\n**1. Merge the fix.** Reply \"merge\" or \"hold\".\n\n**2. Stop the run.** Reply \"stop\" or \"keep\".",
    "decisions": 2
  },
  {
    "case": "numbered decisions with bold leads",
    "message": "🔴 **Needs you:**\n1. **Merge.** Reply \"merge\" or \"hold\".\n2. **Stop.** Reply \"stop\" or \"keep\".",
    "decisions": 2
  },
  {
    "case": "a four-backtick fence holding three backticks closes only at four",
    "message": "Example:\n````\n```\n````\n🔴 **Needs you:**\n1. **Merge.** Reply \"merge\".\n2. **Stop.** Reply \"stop\".",
    "decisions": 2
  },
  {
    "case": "a tilde fence holds an example block, which asks nothing",
    "message": "~~~\n🔴 **Needs you:** fake ask\n~~~\nDone.",
    "decisions": 0
  },
  {
    "case": "a quoted bullet asks nothing; the real item does",
    "message": "🔴 **Needs you:**\n> - quoted bullet\n- real ask",
    "decisions": 1
  },
  {
    "case": "a mark ending in a colon introduces its decisions",
    "message": "🔴 **Needs you:** two decisions:\n1. **A.** Reply \"a\".\n2. **B.** Reply \"b\".",
    "decisions": 2
  },
  {
    "case": "a mark that says the ask: its list is its steps",
    "message": "🔴 **Needs you:** run the command below.\n1. step one\n2. step two",
    "decisions": 1
  },
  {
    "case": "bold-numbered decisions right under the mark (AGENTS Writing's shape)",
    "message": "Not done: CI red.\n\n🔴 **Needs you:**\n**1. Pick a size.** \"5 shares\" (recommended) or \"1 share\".\n**2. Restart live hype_fade.** Reply \"go: restart live hype_fade\".",
    "decisions": 2
  },
  {
    "case": "draft fences under a decision are its replies",
    "message": "🔴 **Needs you:**\n1. **Pick.** Reply:\n```draft\nalpha\n```\n```draft\nbeta\n```",
    "decisions": 1
  }
]
