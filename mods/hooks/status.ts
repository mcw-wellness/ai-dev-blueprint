// The thread at a glance: the hint under the prompt (the running step, the forecast,
// what waits on the owner), the status line (STALE while update.sh has pulled hook code this session
// has not loaded; the engine draws a plugin's status line as a warning, so it holds nothing else) and
// the terminal tab's title: the session's name after the one glyph that says what the tab needs (TAB).
//
// The engine (2.1.310) has no API for the tab's title past the session's name, so the title is
// written to the terminal as the OSC 2 sequence. The engine writes its frames to the same terminal
// in pieces (a pty takes 1 KiB at a time, a busy terminal less), and a title that lands between two
// pieces cuts an escape sequence in half: the rest prints on screen as text. The engine's writes are
// out of reach, so the title is one write by a helper that makes it only when the terminal has read
// everything the engine wrote and the engine has not written for QUIET_MS: the spinner redraws every
// 100 ms, and a frame's pieces follow within a few. A turn's notification (OSC 777, which Ghostty
// shows as a desktop notification) goes the same way, after the title.

import type { EngineInterface, On } from 'claude-code'

import type { Plan, Snapshot } from '../types'
import { openDecisions } from './reply/state'
import { needsYou } from './reply/parse'
import { VERDICT, bare, dur, leadOf } from './transcript/blocks'
import { saveSession } from './session'
import { latest } from './thread'

const MIN = 60_000

/** `16:00Z` for epoch milliseconds. */
const hhmm = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)}Z`

/** The thread's finish: the plan's forecast, else the promised `Finish:`. */
const finishOf = (plan: Plan): number | null => (plan.thread ? (plan.thread.plan.length ? plan.forecast : plan.promised) : null)

/** The running step the forecast waits on, the forecast, what waits on the owner, in words; undefined when there is nothing to say. */
export function statusLine(snapshot: Snapshot | null, now: number): string | undefined {
  if (!snapshot || 'error' in snapshot.timeline) return undefined
  const plan = snapshot.timeline.value.plan
  const parts: string[] = []
  const running = plan.steps.filter(p => p.state === 'running').sort((a, b) => b.end - a.end)
  const [lead] = running
  if (lead) {
    const more = running.length > 1 ? ` +${running.length - 1} more` : ''
    parts.push(`now: ${lead.step.name} ${dur((now - lead.start) / MIN)}${more}`)
  }
  if (plan.thread) {
    const at = finishOf(plan)
    if (at !== null) {
      const over = (Math.max(at, now) - (plan.promised ?? at)) / MIN
      parts.push(`done ~${hhmm(at)}${plan.late ? `, ${dur(over)} late` : ''}`)
    }
    if (plan.asks.length) parts.push(`${plan.asks.length} for you`)
  }
  return parts.length ? parts.join(' · ') : undefined
}

// The session's live state the hooks feed in; a reload starts it over.
const live = {
  isFailed: false,
  isWorking: false,
  calls: [] as Call[], // tool calls in flight, main loop and subagents alike
  isClosable: false, // the last reply said `You can close this session.`; a new turn clears it
  hasBackground: false, // shells, agents, monitors or workflows in flight when the main loop last stopped
  tty: undefined as string | undefined, // absent without a terminal and for `claude -p`
  name: '',
  shown: null as string | undefined | null, // null: not set yet, so the first paint replaces the line the module before a reload left
  hint: undefined as string | undefined, // after the hint under the prompt
  reloadFor: undefined as string | undefined, // the pluginTree this module asked /reload-plugins to load
  title: undefined as string | undefined, // on the tab
  want: undefined as string | undefined, // the latest title asked for
  notice: undefined as string | undefined, // a notification's OSC 777 sequence not written yet
  said: '', // the last turn's notification body, for the session file; '' while a turn works or when it notified nothing
  isPainting: false,
  loaded: undefined as string | undefined, // pluginTree as this module was loaded
}

/** Shown while the checkout holds other plugin code than this session runs (update.sh pulled it). */
export const STALE = '⟳ /reload-plugins'

/**
 * The committed blobs of the files the hooks module loads, one `git ls-tree` line each; undefined
 * outside a checkout. Tests, fixtures and the charts (run afresh each time) are left out: a change
 * to them alone reloads no module, so `/reload-plugins` would not clear the marker.
 */
async function pluginTree($: EngineInterface): Promise<string | undefined> {
  const { exitCode, stdout } = await $.process.run(['git', '-C', $.plugin.root, 'ls-tree', '-r', 'HEAD', 'hooks'])
  if (exitCode !== 0) return undefined
  return stdout.split('\n').filter(line => !/\.test\.tsx?$|_test\.py$|\/fixtures\//.test(line)).join('\n')
}

/** Records pluginTree as this module was loaded; a reload starts the module, and so this, over. */
export async function markLoaded($: EngineInterface): Promise<void> {
  live.loaded = await pluginTree($)
}

const QUIET_MS = 50
const RETRY_MS = 50
// Check and write in one process: argv is the terminal, the sequence and the quiet in seconds. Exit
// 0 written, 1 the terminal is busy. TIOCOUTQ counts what the terminal has not read yet (its number is
// macOS's 0x40047473 or Linux's 0x5411).
const WRITE_IF_QUIET = [
  'use Fcntl; use Time::HiRes qw(stat time);',
  'my ($tty, $text, $quiet) = @ARGV;',
  'sysopen(my $fh, $tty, O_WRONLY) or exit 2;',
  'my $unread = pack("i", 0); ioctl($fh, $^O eq "linux" ? 0x5411 : 0x40047473, $unread);',
  'exit 1 if unpack("i", $unread) > 0 || time - (stat $fh)[9] < $quiet;',
  'syswrite($fh, $text) == length $text or exit 2;',
].join('\n')

/** A tool call in flight: which loop's, which tool, and whether it waits on the owner (a question, a permission prompt). */
type Call = { agent: string | undefined; tool: string; input: Readonly<Record<string, unknown>>; isAsking: boolean }

/** What a reply that leaves the owner nothing to do says (AGENTS Delivery): the tab shows ✓. */
const CLOSABLE = 'You can close this session.'

/** The main loop's turn: working from its start; at its end, whether it died on an API error or said it is closable. */
export async function setTurn($: EngineInterface, turn: 'working' | 'failed' | 'ended', answer = ''): Promise<void> {
  live.isWorking = turn === 'working'
  live.isFailed = turn === 'failed'
  live.isClosable = turn === 'ended' && (answer.trim().split('\n', 1)[0] ?? '').includes(CLOSABLE) // the verdict line says it
  if (live.isWorking) live.said = ''
  await paintTab($)
}

/** The background work in flight as the main loop stopped, which the engine reports only there: the session still works. */
export async function setBackground($: EngineInterface, tasks: readonly unknown[]): Promise<void> {
  live.hasBackground = tasks.length > 0
  await paintTab($)
}

/**
 * Runs `run`, a tool call through the engine (its permission prompt, the tool), the call in flight meanwhile: an
 * AskUserQuestion dialog waits on the owner from its start, another call once its permission request reaches him.
 */
export async function calling<T>($: EngineInterface, e: { agentId?: string; tool: string }, run: () => Promise<T>): Promise<T> {
  const call: Call = { agent: e.agentId, tool: e.tool, input: e, isAsking: e.tool === 'AskUserQuestion' }
  live.calls.push(call)
  if (call.isAsking) void paintTab($)
  try {
    return await run()
  } finally {
    live.calls.splice(live.calls.indexOf(call), 1)
    if (call.isAsking) void paintTab($)
  }
}

/**
 * Runs `decide`, the hooks beneath a permission request; none deciding, the engine's dialog asks the owner, and the
 * call it is for waits on him until it ends. The request names no call: it is the one in flight of that loop and tool
 * whose arguments it carries (two Bash calls run at once), else the oldest of them (a hook rewrote the arguments).
 */
export async function permitting<T extends { decision?: unknown }>(
  $: EngineInterface,
  e: { agent_id?: string; tool_name: string; tool_input: unknown },
  decide: () => Promise<T>,
): Promise<T> {
  const result = await decide()
  const mine = live.calls.filter(c => c.agent === e.agent_id && c.tool === e.tool_name && !c.isAsking)
  const args = Object.entries((e.tool_input ?? {}) as Record<string, unknown>)
  const call = mine.find(c => args.every(([k, v]) => JSON.stringify(c.input[k]) === JSON.stringify(v))) ?? mine[0]
  if (!result.decision && call) {
    call.isAsking = true
    void paintTab($)
  }
  return result
}

/** The glyphs the tab leads with: an API error, work in flight, something waits on the owner, nothing left to do. */
const TAB = { failed: '❌', working: '◐', owner: '🔴', closable: '✓' } as const

/**
 * What the tab needs, most urgent first: the turn died on an API error; a question or a permission prompt waits on the
 * owner (both stop a turn that works); the turn works; the last reply's decisions wait on the owner; background work
 * the session started runs on; the last reply said the session can close.
 */
function glyph(isAsked: boolean): string {
  if (live.isFailed) return TAB.failed
  if (live.calls.some(c => c.isAsking)) return TAB.owner
  if (live.isWorking) return TAB.working
  if (isAsked) return TAB.owner
  if (live.hasBackground) return TAB.working
  return live.isClosable ? TAB.closable : ''
}

/** The engine's terminal, by path: children of the engine have no controlling terminal. */
export async function findTerminal($: EngineInterface): Promise<void> {
  const { stdout } = await $.process.run(['/bin/sh', '-c', 'ps -o tty= -p "$PPID"'])
  const tty = stdout.trim()
  live.tty = /^(ttys?\d+|pts\/\d+)$/.test(tty) ? `/dev/${tty}` : undefined // macOS ttys001, Linux pts/3
  await rename($)
}

/** The name `claude agents` lists (set with `-n` or `/rename`), else the directory's. */
export async function rename($: EngineInterface): Promise<void> {
  if (live.tty === undefined) return
  const [id, cwd] = await Promise.all([$.session.id(), $.session.cwd()])
  live.name = cwd.split('/').pop() || cwd
  try {
    const sessions: { sessionId?: string; name?: string }[] = JSON.parse((await $.process.run(['claude', 'agents', '--json'])).stdout)
    live.name = sessions.find(s => s.sessionId === id)?.name || live.name
  } catch {}
  await paintTab($)
}

/** `/clear` or `/resume` switched the session: the last turn's notification was the other session's. */
export async function switchTab($: EngineInterface): Promise<void> {
  live.said = ''
  await rename($)
}

/** Text safe inside an OSC sequence: no control characters, which would end it, nor `;`, which splits OSC 777's fields. */
const clean = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f;]/g, '')

const MAX_NOTICE = 200

/** What a turn's reply notifies the owner of: its first ask in a `🔴 Needs you` block, else its verdict line unless that says `Running:`, as the Codex banner does. */
function noticeOf(answer: string): string | undefined {
  const [ask] = needsYou(answer)
  const line = answer.trim().split('\n', 1)[0] ?? ''
  const first = line.slice(leadOf(line).length)
  const verdict = VERDICT.exec(first)?.[1]
  const body = ask ? `Needs you: ${ask.title}` : verdict !== undefined && verdict !== 'Running' ? bare(first) : undefined
  if (body === undefined) return undefined
  const chars = [...body]
  return chars.length > MAX_NOTICE ? `${chars.slice(0, MAX_NOTICE - 1).join('')}…` : body
}

/** Notifies the owner of a turn's reply that is done or asks him, as a Ghostty notification (OSC 777) titled with the session's name. */
export async function notify($: EngineInterface, answer: string): Promise<void> {
  const body = noticeOf(answer)
  live.said = body === undefined ? '' : clean(body) // the session file's notice, for the phone, either way
  // Kei wants no desktop notification (2026-10-28): only `AGENT_TOOLING_NOTIFY=1` turns them on.
  if ((await $.env.get('AGENT_TOOLING_NOTIFY').catch(() => undefined)) !== '1') return
  if (live.tty === undefined || body === undefined) return
  live.notice = `\u001b]777;notify;${clean(live.name)};${live.said}\u0007`
  await paintTab($)
}

/**
 * Sets the tab's title to what it needs now, once the terminal is quiet; a title asked for while one waits replaces it.
 * The session file follows (session.ts).
 */
export async function paintTab($: EngineInterface): Promise<void> {
  const tty = live.tty
  if (tty === undefined) return
  const name = clean(live.name)
  const lead = glyph(await openDecisions($)) // read first: a turn that starts meanwhile still wins
  live.want = lead ? `${lead} ${name}` : name
  void saveSession($, { name, glyph: lead, notice: live.said })
  if (live.isPainting) return
  live.isPainting = true
  // Not awaited: a busy terminal must not hold up the hook that asked.
  void write($, tty)
    .catch(error => $.ui.log(`tab title: ${error}`))
    .finally(() => (live.isPainting = false))
}

/** Writes the title asked for, then the notification waiting, each as one write between the engine's frames. */
async function write($: EngineInterface, tty: string): Promise<void> {
  while (live.want !== live.title || live.notice !== undefined) {
    const title = live.want
    const isTitle = title !== live.title
    const text = isTitle ? `\u001b]2;${title}\u0007` : live.notice!
    const argv = ['perl', '-e', WRITE_IF_QUIET, tty, text, String(QUIET_MS / 1000)]
    const { exitCode } = await $.process.run(argv)
    if (exitCode === 0 && isTitle) live.title = title
    else if (exitCode === 0 && live.notice === text) live.notice = undefined
    else if (exitCode === 1) await $.clock.sleep(RETRY_MS)
    else throw new Error(`perl exited ${exitCode}`)
  }
}

/** Recomputes the hint from the latest snapshot, and the status line: STALE once the checkout moved on, with one reload asked. */
export async function paintStatus($: EngineInterface): Promise<void> {
  const [snapshot, now, tree] = await Promise.all([latest($), $.clock.now(), pluginTree($)])
  const hint = statusLine(snapshot, now)
  if (hint !== live.hint) {
    live.hint = hint
    $.ui.invalidate('ui.render')
  }
  const isStale = live.loaded !== undefined && tree !== live.loaded
  // update.sh pulled newer hook code: load it once the session is idle, as typing /reload-plugins would. Still stale
  // after a reload that ran (the new module did not load, so this one runs on), STALE stays and no second is asked.
  if (isStale && live.reloadFor !== tree) {
    live.reloadFor = tree
    void $.command.run({ command: 'reload-plugins' }).catch(error => {
      if (live.reloadFor === tree) live.reloadFor = undefined // refused: the next poll asks again
      $.ui.log(`reload: ${error}`)
    })
  }
  const text = isStale ? STALE : undefined
  if (text !== live.shown) {
    live.shown = text
    $.ui.status(text)
  }
}

/** The hint under the prompt ends with the thread's state, dim, the engine's own line kept. */
export function hint(on: On): void {
  on('ui.render', { component: 'PromptHint' }, ($, e, next) =>
    next(live.hint ? { ...e, props: { ...e.props, tail: `  ${live.hint}` } } : e),
  ).catch(($, e, next) => next(e))
}
