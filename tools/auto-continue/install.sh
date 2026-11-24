#!/bin/bash
# Install auto-continue as a launchd agent that ticks every 60 s. Re-run to update.
set -euo pipefail
LABEL=com.almir.auto-continue
SCRIPT="$(cd "$(dirname "$0")" && pwd)/auto_continue.py"
PY="$(command -v python3)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE="$HOME/.local/state/auto-continue"
mkdir -p "$STATE" "$HOME/.local/bin" "$HOME/Library/LaunchAgents"
ln -sf "$SCRIPT" "$HOME/.local/bin/auto-continue"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$SCRIPT</string><string>tick</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$STATE/launchd.out</string>
  <key>StandardErrorPath</key><string>$STATE/launchd.err</string>
</dict></plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL → $SCRIPT (log: $STATE/log, errors: $STATE/launchd.err)"
