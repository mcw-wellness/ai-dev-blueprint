// The thread's data: `board --status` handed to this session's timeline, read each minute for the prompt hint.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Loaded, Snapshot, Timeline } from '../types'

// Change a tag when its value's type changes: it declines what an earlier version stored.
const snapshot = atom({ plugin: 'agent-tooling', key: 'snapshot' } as const, null, { shape: 'snapshot-6' })

// The installed checkout's library, as the skills run it, wherever the plugin loads from
// (the marketplace folder, a cache or `--plugin-dir`).
const TIMELINE = 'agent-tooling/skills/progress/scripts/session_timeline.py'

/** A host command's output, or the last line it printed to stderr, or that its output was cut. */
async function run($: EngineInterface, argv: string[], timeoutMs: number, stdin?: string): Promise<Loaded<string>> {
  try {
    const ran = await $.process.run(argv, { timeoutMs, stdin })
    if (ran.exitCode !== 0) return { error: ran.stderr.trim().split('\n').at(-1) || `exit ${ran.exitCode}` }
    // The engine keeps only the first 4 MiB of stdout; what it kept would read as a JSON SyntaxError.
    if (ran.isStdoutTruncated) return { error: 'output past the 4 MiB cap' }
    return { value: ran.stdout }
  } catch (error) {
    return { error: String(error) }
  }
}

/** A command's output as JSON, or why it could not be read. */
function parsed<T>(out: Loaded<string>): Loaded<T> {
  if ('error' in out) return out
  try {
    return { value: JSON.parse(out.value) as T }
  } catch (error) {
    return { error: String(error) }
  }
}

/** The last snapshot read, null before the first; read while drawing, it redraws on the next. */
export async function latest($: EngineInterface): Promise<Snapshot | null> {
  return read($, snapshot)
}

// Whether Wendelin's progress library is installed (`~/agent-tooling`); on Kei's machines it is not, and the prompt
// hint, which reads it, stays empty instead of spawning `board` and `uv` every minute in every session.
let hasTimeline: boolean | undefined

/** This session's timeline, its thread from `board --status` when that reads. */
async function load($: EngineInterface): Promise<Snapshot> {
  const session = await $.session.id()
  const script = `${(await $.env.get('HOME')) ?? ''}/${TIMELINE}`
  hasTimeline ??= (await $.process.run(['test', '-f', script]).catch(() => ({ exitCode: 1 }))).exitCode === 0
  if (!hasTimeline) return { timeline: { error: `no ${TIMELINE}` } }
  // board --status reads no network; a minute covers a cold start of uv.
  const board = await run($, ['board', '--status'], 60_000)
  const argv = ['uv', 'run', '--quiet', script, session, '--json']
  const out = 'value' in board ? await run($, [...argv, '--board', '-'], 60_000, board.value) : await run($, argv, 60_000)
  return { timeline: parsed<Timeline>(out) }
}

let reading = false

/** Reads a fresh snapshot unless one is being read; a slow read never stacks. */
export async function refresh($: EngineInterface): Promise<void> {
  if (reading) return
  reading = true
  try {
    const next = await load($)
    await update($, snapshot, () => next)
  } finally {
    reading = false
  }
}
