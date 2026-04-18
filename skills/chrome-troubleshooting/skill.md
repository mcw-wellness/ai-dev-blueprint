---
name: chrome-troubleshooting
description: Fix "No Chrome extension connected" error for claude-in-chrome MCP tools in Claude Code CLI.
user-invocable: true
argument-hint: (no args needed)
allowed-tools:
  - Bash
  - Read
  - Write
---

# Chrome MCP Troubleshooting

Fix "No Chrome extension connected" when using `mcp__claude-in-chrome__*` tools.

## Root Cause

Claude Desktop and Claude Code BOTH register native messaging hosts for the same
Chrome extension ID (`fcoeoabgfenejglbffodgkkbkcdhcgfn`). When Claude Desktop is
running, it steals the connection and Claude Code can't reach the extension.

## Key Files

| File | Purpose |
|------|---------|
| `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json` | Claude Code's manifest (GOOD) |
| `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json` | Claude Desktop's manifest (CONFLICTS) |
| `~/.claude/chrome/chrome-native-host` | Claude Code's wrapper script |
| `/Applications/Claude.app/Contents/Helpers/chrome-native-host` | Claude Desktop's native binary |
| `/tmp/claude-mcp-browser-bridge-almir/` | Bridge socket directory |

## Fix Steps (in order)

### Step 1: Disable Claude Desktop's native messaging host

```bash
mv ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json \
   ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json.disabled
```

### Step 2: Clear stale bridge sockets

```bash
rm -rf /tmp/claude-mcp-browser-bridge-almir/*
```

### Step 3: Kill orphaned Claude Desktop native host processes

```bash
ps aux | grep chrome-native-host | grep -v grep
# Kill any PIDs shown:
# kill <PID1> <PID2>
```

### Step 4: Restart Chrome completely

- Cmd+Q Chrome (not just close window)
- Reopen Chrome

### Step 5: Restart Claude Code CLI session

- `/exit` from current session
- Start a new `claude` session
- The new session will find the bridge sockets

### Step 6: Verify

```bash
# Check bridge sockets exist:
ls /tmp/claude-mcp-browser-bridge-almir/

# Check native host is running:
ps aux | grep chrome-native-host | grep -v grep

# Check it points to Claude Code (not Desktop):
cat ~/.claude/chrome/chrome-native-host
# Should show: exec "/Users/almir/.local/share/claude/versions/X.X.X" --chrome-native-host

# Test MCP connection:
# In Claude Code, call mcp__claude-in-chrome__tabs_context_mcp
```

## Quick Fix (one-liner)

If it was working before and stopped, usually just need to restart the session:

```bash
# Exit Claude Code, restart, try again
```

## Preventing Recurrence

The conflict returns if Claude Desktop updates and re-creates its manifest.
After updating Claude Desktop, re-run Step 1 to disable its manifest.

To re-enable Chrome for Claude Desktop (and break Claude Code):
```bash
mv ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json.disabled \
   ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.anthropic.claude_browser_extension.json
```

## Debugging Checklist

- [ ] Is Chrome running?
- [ ] Is the Claude extension installed in Chrome? (chrome://extensions)
- [ ] Is Claude Desktop's manifest disabled? (check for `.disabled` suffix)
- [ ] Are bridge sockets present in `/tmp/claude-mcp-browser-bridge-almir/`?
- [ ] Is `chrome-native-host` process running? (`ps aux | grep chrome-native-host`)
- [ ] Does the native host script point to current Claude Code version? (`cat ~/.claude/chrome/chrome-native-host`)
- [ ] Did you restart the Claude Code CLI session after fixing?

## Important Notes

- Claude Code CLI session must be RESTARTED after fixing — MCP connections are established at startup
- `/chrome` command in Claude Code does OAuth login, NOT Chrome extension setup
- The Chrome extension side panel (Cmd+E) is for Claude Desktop only, irrelevant for Claude Code
- Bridge sockets are per-user: `/tmp/claude-mcp-browser-bridge-<username>/`
