#!/usr/bin/env bash
# Claude Code status line.
# Displays: model · context usage · cwd · git branch · [permission mode] · account email
#
# The account email is NOT in the payload Claude Code sends — it is read from
# the active profile's own .claude.json (CLAUDE_CONFIG_DIR, else ~/.claude),
# which is what makes a multi-seat setup legible: the line says which account
# is paying for this session. Cached beside the file and refreshed only when
# .claude.json changes, so a large profile file is not re-parsed every render.

input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
cwd_raw=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
# Drop the boilerplate prefix and keep everything below it: the checkout name
# plus where you are inside it. ~/Documents/GitHub is on every path and carries
# no information, so it is stripped; anything else under home keeps its "~/".
cwd="${cwd_raw#$HOME/Documents/GitHub/}"
[ "$cwd" = "$cwd_raw" ] && cwd=$(printf '%s' "$cwd_raw" | sed "s|^$HOME|~|")
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# Permission mode. Claude Code's key name for this has moved around, so rather
# than hard-coding one guess, scan every path whose name mentions "permission"
# and take the first value that looks like a real mode. Set
# CLAUDE_STATUSLINE_DEBUG=1 to dump the raw payload and see what it actually
# sends. NOTE: do not widen the path filter to "mode" - it matches "model".
mode=$(echo "$input" | jq -r '
  [ paths(scalars) as $p
    | select((($p | map(tostring) | join(".")) | test("ermission")))
    | getpath($p) | select(type == "string") ] as $cand
  | ($cand | map(select(. == "bypassPermissions" or . == "acceptEdits"
                        or . == "plan" or . == "default")) | first)
    // ($cand | first) // "default"')
case "$mode" in
  bypassPermissions) mode_label="bypass";  mode_color='\033[31m' ;;  # red: no prompts
  acceptEdits)       mode_label="accept";  mode_color='\033[33m' ;;
  plan)              mode_label="plan";    mode_color='\033[36m' ;;
  default|"")        mode_label="default"; mode_color='\033[35m' ;;
  *)                 mode_label="$mode";   mode_color='\033[35m' ;;
esac

# Profile name: which isolated instance this session belongs to. Not in the
# payload - it lives in the environment. CLAUDE_INSTANCE if the launcher set
# it, otherwise derived from the config dir (~/.claude-vvs -> vvs).
config_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
profile="${CLAUDE_INSTANCE:-}"
if [ -z "$profile" ]; then
  case "$(basename "$config_dir")" in
    .claude-*) profile="${config_dir##*/.claude-}" ;;
    *)         profile="default" ;;
  esac
fi

if [ "${CLAUDE_STATUSLINE_DEBUG:-}" = "1" ]; then
  printf '%s' "$input" > "$config_dir/.statusline-last-payload.json" 2>/dev/null || true
fi

# Account email for the active profile, mtime-cached.
claude_json="$config_dir/.claude.json"
[ -f "$claude_json" ] || claude_json="$HOME/.claude.json"
email=""
if [ -f "$claude_json" ]; then
  cache="$config_dir/.statusline-account"
  if [ -s "$cache" ] && [ "$cache" -nt "$claude_json" ]; then
    email=$(cat "$cache")
  else
    email=$(jq -r '.oauthAccount.emailAddress // empty' "$claude_json" 2>/dev/null)
    if [ -n "$email" ] && [ -d "$config_dir" ]; then
      { printf '%s' "$email" > "$cache"; } 2>/dev/null || true
    fi
  fi
fi

branch=""
if branch_raw=$(GIT_OPTIONAL_LOCKS=0 git -C "${cwd_raw:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null); then
  branch="$branch_raw"
fi

out="$(printf '\033[36m%s\033[0m' "$model")"

if [ -n "$used_pct" ]; then
  used_int=$(printf '%.0f' "$used_pct")
  if   [ "$used_int" -ge 80 ]; then color='\033[31m'
  elif [ "$used_int" -ge 50 ]; then color='\033[33m'
  else                              color='\033[32m'
  fi
  out="${out} $(printf "${color}ctx:%s%%\033[0m" "$used_int")"
fi

[ -n "$cwd" ] && out="${out} $(printf '\033[33m\xf0\x9f\x93\x81 %s\033[0m' "$cwd")"
[ -n "$branch" ] && out="${out} $(printf '\033[32m(%s)\033[0m' "$branch")"
[ -n "$profile" ] && out="${out} $(printf '\033[94m[%s]\033[0m' "$profile")"
out="${out} $(printf "${mode_color}[%s]\033[0m" "$mode_label")"
[ -n "$email" ] && out="${out} $(printf '\033[90m%s\033[0m' "$email")"

# Weekly limit of every logged-in profile, from ai-usage. Cached 1 h and refreshed in the
# background (one refresh at a time), so the status line never waits on the network.
wk_dir="$HOME/.cache/ai-usage"
wk_file="$wk_dir/weekly.txt"
if [ ! -f "$wk_file" ] || [ -n "$(find "$wk_file" -mmin +60 2>/dev/null)" ]; then
  mkdir -p "$wk_dir"
  if mkdir "$wk_dir/lock" 2>/dev/null; then
    ( python3 "$HOME/.claude/skills/ai-usage/ai-usage.py" --weekly-line > "$wk_file.tmp" 2>/dev/null \
        && mv "$wk_file.tmp" "$wk_file"; rmdir "$wk_dir/lock" ) >/dev/null 2>&1 &
  fi
fi
[ -s "$wk_file" ] && out="${out}
$(printf '\033[90m%s\033[0m' "$(cat "$wk_file")")"

printf '%s' "$out"
