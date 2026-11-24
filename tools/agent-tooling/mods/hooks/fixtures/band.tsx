// The Reply band's mount and a session to draw it in, shared by the reply tests.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { FoundElement, TestBody } from 'claude-code/testing'

export const NOW = Date.parse('2026-10-27T09:00:00Z')

/**
 * A session whose first turn answered `answer`: the copy and open commands it ran, recorded instead, its toasts and,
 * off a Mac, the engine's copies. `os` is what `uname -s` says; `env` the variables beyond HOME.
 */
export async function session(
  $: Parameters<TestBody>[0],
  on: On,
  answer: string,
  exitCode = 0,
  os: 'Darwin' | 'Linux' = 'Darwin',
  env: Record<string, string> = {},
) {
  const ran: (readonly string[])[] = []
  const toasts: string[] = []
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 's1' }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [] }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.suggest', () => ({ isShown: true }))
  on('prompt.fill', () => {
    throw new Error('a copy never fills the prompt')
  })
  on('prompt.submit', () => {
    throw new Error('a copy never sends')
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/Users/o' : env[e.name] }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'uname') return { value: { exitCode: 0, stdout: `${os}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    const ours = e.argv[0] === 'osascript' || e.argv[0] === 'open' || e.argv[0] === 'xdg-open'
    if (ours) ran.push(e.argv)
    const failed = !ours || exitCode !== 0
    return { value: { exitCode: failed ? 1 : 0, stdout: '', stderr: failed ? 'no pasteboard' : '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(answer, 't1'))
  return { ran, toasts, copied }
}

export const BAND = {
  plugin: 'agent-tooling',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

/** A drawn element's words: a Button's label, else its children's, a chip's Box and Button included. */
export const words = (c: FoundElement | string): string =>
  typeof c === 'string' ? c : typeof c.props.label === 'string' ? c.props.label : ((c.children ?? []) as (FoundElement | string)[]).map(words).join('')

/** What the rest of the plugin asks of the engine: the minute's poll, which these tests leave idle. */
export function poll(on: On, session = () => 's1') {
  on('session.id', () => ({ value: session() }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'offline', isStdoutTruncated: false, isStderrTruncated: false } }))
}

/** A turn that answered `text`. */
export const turn = (answer: string, turnId: string) => ({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' }) as const

/** A session whose first turn answered `text`, its clock at NOW; `suggested` collects what the band suggests. */
export async function answered($: Parameters<TestBody>[0], on: On, text: string, suggested: string[] = []) {
  const clock = mock.clock(on, { now: NOW })
  poll(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [] }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.suggest', (_, e) => {
    suggested.push(e.text)
    return { isShown: true }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(turn(text, 't1'))
  return clock
}
