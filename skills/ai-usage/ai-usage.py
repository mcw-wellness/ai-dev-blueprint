#!/usr/bin/env python3
"""ai-usage — remaining Claude Code / Codex quota for every local profile.

Profiles: ~/.claude, ~/.claude-*  (credentials in macOS Keychain)
          ~/.codex,  ~/.codex-*   (credentials in <home>/auth.json)

Read-only: never refreshes or rewrites tokens (that would rotate them out
from under the CLI). An expired access token is reported, not fixed —
start the CLI in that profile once and re-run.

Uses unofficial endpoints (the same ones /usage and CodexBar use):
  GET https://api.anthropic.com/api/oauth/usage
  GET https://chatgpt.com/backend-api/wham/usage
"""
import base64
import hashlib
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
RED, YEL, GRN, DIM, BOLD, RST = "\033[31m", "\033[33m", "\033[32m", "\033[2m", "\033[1m", "\033[0m"
if not sys.stdout.isatty():
    RED = YEL = GRN = DIM = BOLD = RST = ""


class ProfileError(Exception):
    pass


# ---------- formatting ----------

def ago_or_in(ts: float) -> str:
    d = ts - time.time()
    s = abs(d)
    txt = f"{int(s // 86400)}d {int(s % 86400 // 3600)}h" if s >= 86400 else \
          f"{int(s // 3600)}h {int(s % 3600 // 60)}m" if s >= 3600 else f"{int(s // 60)}m"
    return f"in {txt}" if d >= 0 else f"{txt} ago"


def when(ts: float) -> str:
    local = datetime.fromtimestamp(ts)
    fmt = "%H:%M" if local.date() == datetime.now().date() else "%a %d %b %H:%M"
    return f"{local.strftime(fmt)} ({ago_or_in(ts)})"


def bar(pct: float) -> str:
    color = RED if pct >= 90 else YEL if pct >= 70 else GRN
    filled = round(pct / 10)
    return f"{color}{'█' * filled}{'░' * (10 - filled)} {pct:3.0f}% used{RST}"


def iso(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def http_json(url: str, headers: dict) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "ai-usage", **headers})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise ProfileError(f"HTTP {e.code} from {url}: {e.read()[:200].decode(errors='replace')}")


def jwt(token: str) -> dict:
    p = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))


# ---------- Claude ----------

def claude_profiles():
    dirs = [HOME / ".claude"] + sorted(p for p in HOME.glob(".claude-*") if p.is_dir())
    return dirs


def claude_report(d: Path) -> list[str]:
    default = d == HOME / ".claude"
    service = "Claude Code-credentials" if default else \
        "Claude Code-credentials-" + hashlib.sha256(str(d).encode()).hexdigest()[:8]
    cfg_file = HOME / ".claude.json" if default else d / ".claude.json"
    acct = json.loads(cfg_file.read_text()).get("oauthAccount", {}) if cfg_file.exists() else {}
    email = acct.get("emailAddress", "?")
    org = acct.get("organizationName", "")

    r = subprocess.run(["security", "find-generic-password", "-s", service, "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return [f"{DIM}not logged in (no Keychain item '{service}'){RST}"]
    o = json.loads(r.stdout)["claudeAiOauth"]

    out = [f"{email}  {DIM}{org} · {o.get('subscriptionType')} · {o.get('rateLimitTier')}{RST}"]
    if o.get("refreshTokenExpiresAt"):
        out.append(f"login expires   {when(o['refreshTokenExpiresAt'] / 1000)}")
    if not o.get("expiresAt"):
        out.append(f"{YEL}no valid login (expiresAt=0) — run claude in this profile and /login{RST}")
        return out
    if o["expiresAt"] / 1000 < time.time():
        out.append(f"{YEL}access token expired {ago_or_in(o['expiresAt'] / 1000)} — "
                   f"run claude in this profile once, then re-run{RST}")
        return out

    u = http_json("https://api.anthropic.com/api/oauth/usage",
                  {"Authorization": f"Bearer {o['accessToken']}", "anthropic-beta": "oauth-2025-04-20"})
    for lim in u.get("limits") or []:
        model = ((lim.get("scope") or {}).get("model") or {}).get("display_name")
        label = {"session": "session (5h)", "weekly_all": "weekly (all)"}.get(lim["kind"], lim["kind"])
        if model:
            label = f"weekly {model}"
        reset = f"resets {when(iso(lim['resets_at']))}" if lim.get("resets_at") else ""
        out.append(f"{label:<15} {bar(lim['percent'])}  {reset}")
    ex = u.get("extra_usage") or {}
    if ex.get("is_enabled"):
        div = 10 ** ex.get("decimal_places", 2)
        out.append(f"{'extra usage':<15} {ex['used_credits'] / div:.2f} / "
                   f"{ex['monthly_limit'] / div:.2f} {ex.get('currency', '')} this month")
    return out


# ---------- Codex ----------

def codex_profiles():
    return [HOME / ".codex"] + sorted(p for p in HOME.glob(".codex-*") if p.is_dir())


def codex_window(name: str, w: dict) -> str:
    hours = w["limit_window_seconds"] / 3600
    label = f"{name} ({hours:.0f}h)" if hours < 24 else f"{name} ({hours / 24:.0f}d)"
    return f"{label:<15} {bar(w['used_percent'])}  resets {when(w['reset_at'])}"


def codex_report(d: Path) -> list[str]:
    f = d / "auth.json"
    if not f.exists():
        return [f"{DIM}not logged in (no auth.json) — CODEX_HOME={d} codex login{RST}"]
    a = json.loads(f.read_text())
    tok = a.get("tokens") or {}
    if not tok:
        return [f"{DIM}API-key mode, no ChatGPT login{RST}"]
    idt = jwt(tok["id_token"])
    auth = idt.get("https://api.openai.com/auth", {})
    out = [f"{idt.get('email', '?')}  {DIM}{auth.get('chatgpt_plan_type', '?')}{RST}"]
    access_exp = jwt(tok["access_token"])["exp"]
    out.append(f"{'login token':<15} expires {when(access_exp)}  {DIM}"
               f"(last refresh {ago_or_in(iso(a['last_refresh']))}; codex refreshes it on use){RST}")
    if access_exp < time.time():
        out.append(f"{YEL}access token expired — run codex in this profile once, then re-run{RST}")
        return out

    u = http_json("https://chatgpt.com/backend-api/wham/usage",
                  {"Authorization": f"Bearer {tok['access_token']}",
                   "chatgpt-account-id": tok.get("account_id", "")})
    rl = u.get("rate_limit") or {}
    for name, key in (("primary", "primary_window"), ("secondary", "secondary_window")):
        if rl.get(key):
            out.append(codex_window(name, rl[key]))
    for extra in u.get("additional_rate_limits") or []:
        out.append(f"{DIM}{json.dumps(extra)[:120]}{RST}")
    if rl.get("limit_reached"):
        out.append(f"{RED}LIMIT REACHED{RST}")
    c = u.get("credits") or {}
    if c.get("has_credits"):
        out.append(f"{'credits':<15} balance {float(c['balance']):,.0f}")
    resets = (u.get("rate_limit_reset_credits") or {}).get("available_count")
    if resets:
        out.append(f"{'limit resets':<15} {resets} manual reset(s) available")
    return out


# ---------- main ----------

def run(fn, d):
    try:
        return fn(d), None
    except Exception as e:  # reported per profile below and fails the exit code
        return None, f"{type(e).__name__}: {e}"


def main():
    jobs = [("CLAUDE", d, claude_report) for d in claude_profiles()] + \
           [("CODEX", d, codex_report) for d in codex_profiles()]
    with ThreadPoolExecutor(len(jobs)) as ex:
        results = list(ex.map(lambda j: run(j[2], j[1]), jobs))

    print(f"{DIM}{datetime.now().strftime('%a %d %b %H:%M')}{RST}")
    failed, section = False, None
    for (prod, d, _), (lines, err) in zip(jobs, results):
        if prod != section:
            section = prod
            print(f"\n{BOLD}{prod}{RST}")
        name = d.name.split("-", 1)[1] if "-" in d.name else "default"
        print(f"  {BOLD}{name:<9}{RST}", end="")
        if err:
            failed = True
            print(f"{RED}ERROR {err}{RST}")
            continue
        print(lines[0])
        for line in lines[1:]:
            print(f"  {'':<9}  {line}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
