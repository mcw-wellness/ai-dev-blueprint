import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import type { Snapshot } from '../types'
import { NOW, SESSION, TIMELINE } from './fixtures/timeline'
import { statusLine } from './status'

const plan = TIMELINE.plan
const snapshot = (more: Partial<typeof plan> = {}): Snapshot => ({
  timeline: { value: { ...TIMELINE, plan: { ...plan, ...more } } },
})

test('the running step, the forecast and whether it is late, what waits on the owner', () => {
  expect(statusLine(snapshot(), NOW)).toBe('now: since 29m · done ~13:00Z · 2 for you')
  expect(statusLine(snapshot({ promised: NOW + 90 * 60_000, late: true }), NOW)).toBe('now: since 29m · done ~13:00Z, 30m late · 2 for you')
  expect(statusLine(snapshot({ thread: null, asks: [] }), NOW)).toBe('now: since 29m') // no handoff: the running agents are the work
  expect(statusLine(null, NOW)).toBeUndefined()
})

// The hooks under the engine: polling, the tab's title.

const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

function engine(on: Parameters<TestBody>[1]) {
  const clock = mock.clock(on, { now: NOW })
  // frameAt: when the engine last wrote to the terminal; idle: the quiet each title was written after.
  const seen = { decide: false, suggested: [] as string[], reloads: 0, refuse: false, lines: [] as (string | undefined)[], tails: [] as (string | undefined)[], titles: [] as string[], notices: [] as string[], files: new Map<string, string>(), saves: 0, id: SESSION, idle: [] as number[], name: 'wendelin-4b', frameAt: 0, notify: true, tree: ['a\thooks/status.ts', 'a\thooks/status.test.ts'] }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: seen.id }))
  on('session.cwd', () => ({ value: '/Users/o' }))
  on('session.messages', () => ({ value: [] })) // a new session: no answer left a band open
  on('prompt.suggest', (_, e) => {
    seen.suggested.push(e.text)
    return { isShown: true }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('classic.Stop', () => ({}))
  // The settings hooks beneath a permission request: they decide only when the test says so.
  on('classic.PermissionRequest', () => (seen.decide ? { decision: { behavior: 'allow' as const } } : {}))
  // The engine running each tool call (a question's dialog, a permission prompt, the tool): open until the test answers it.
  const held: (() => void)[] = []
  const question = { answer: () => held.pop()?.() } // the newest call held
  on('tool.call', () => new Promise(resolve => held.push(() => resolve({ result: { answers: {} } } as never))))
  on('command.run', (_, e) => {
    if (e.command === 'reload-plugins') {
      seen.reloads++
      if (seen.refuse) throw new Error('refused')
    }
    return { text: '' }
  })
  on('ui.status', (_, e) => {
    seen.lines.push(e.text)
    return { value: undefined }
  })
  // The engine's hint line, beneath the plugin: what tail it was handed.
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    seen.tails.push(e.props.tail)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  on('env.get', (_, e) => ({ value: { HOME: '/Users/me', AGENT_TOOLING_NOTIFY: seen.notify ? '1' : undefined }[e.name] }))
  on('process.run', (_, e) => {
    const [cmd] = e.argv
    // The session file's helper and its removal, kept as files by path.
    if (cmd === '/bin/sh' && e.argv[1]!.endsWith('/hooks/save.sh')) {
      seen.saves++
      seen.files.set(`${e.argv[2]}/${e.argv[3]}`, e.init!.stdin!)
      return ok('') as never
    }
    if (cmd === 'rm') {
      seen.files.delete(e.argv[2]!)
      return ok('') as never
    }
    if (cmd === '/bin/sh') return ok('ttys009\n') as never
    if (cmd === 'perl') {
      // The helper: it writes the title unless the engine wrote to the terminal in the last 50 ms.
      const [, , , tty, text, quiet] = e.argv
      expect(tty).toBe('/dev/ttys009')
      const idle = clock.now() - seen.frameAt
      if (idle < Number(quiet) * 1000) return ok('', 1) as never
      if (text!.startsWith('\u001b]2;')) seen.titles.push(text!.slice(4, -1))
      else seen.notices.push(text!)
      seen.idle.push(idle)
      return ok('') as never
    }
    if (cmd === 'git') return ok(`${seen.tree.join('\n')}\n`) as never
    if (cmd === 'claude') return ok(JSON.stringify([{ sessionId: SESSION, name: seen.name }])) as never
    return ok(cmd === 'board' ? '{}' : JSON.stringify(TIMELINE)) as never
  })
  /** The tab's title once the clock has run what is due. */
  const title = async () => (await clock.settle(), seen.titles.at(-1))
  return { clock, seen, question, title }
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const RENAME = { command: 'rename', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } } as const
const end = ($: Parameters<TestBody>[0], reason: 'answer' | 'aborted' | 'error', answer = '') =>
  $.turn.complete({ answer, durationMs: 1, isAborted: reason === 'aborted', turnId: 't', reason })

/** The main loop stops with `tasks` shells still running. */
const stop = ($: Parameters<TestBody>[0], tasks: number) =>
  $.classic.Stop({ stop_hook_active: false, background_tasks: Array(tasks).fill({ id: 'b', type: 'shell', status: 'running', description: 'CI' }), session_crons: [] } as never)

const HINT = { plugin: 'agent-tooling', component: 'PromptHint', requestId: 'prompt-hint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const

/** The tail the plugin hands the engine's hint line now. */
async function tail($: Parameters<TestBody>[0], seen: { tails: (string | undefined)[] }) {
  await (await $.ui.mount({ ...HINT, surface: 'terminal' })).unmount()
  return seen.tails.at(-1)
}

test('the poll puts the thread after the hint under the prompt, in words', async ($, on) => {
  const { clock, seen } = engine(on)
  await $.session.start(START)
  await clock.advance(60_000)
  expect(await tail($, seen)).toBe('  now: since 30m · done ~13:00Z · 2 for you')
  expect(seen.lines.at(-1)).toBeUndefined() // the status line, drawn as a warning, stays for STALE
})

test('a pull of other plugin code asks /reload-plugins once and shows it on the status line until a reload clears it', async ($, on) => {
  const { clock, seen } = engine(on)
  await $.session.start(START)
  await clock.advance(60_000)
  expect(seen.lines.at(-1)).toBeUndefined()
  seen.tree = ['a\thooks/status.ts', 'b\thooks/status.test.ts'] // a test changed: the module the session runs did not
  await clock.advance(60_000)
  expect(seen.lines.at(-1)).toBeUndefined()
  seen.tree = ['b\thooks/status.ts', 'b\thooks/status.test.ts'] // update.sh pulled a change to the module
  await clock.advance(60_000)
  expect(seen.lines.at(-1)).toBe('⟳ /reload-plugins')
  expect(seen.reloads).toBe(1)
  await clock.advance(60_000) // the reload left this module running: no second ask
  expect(seen.reloads).toBe(1)
  seen.refuse = true // the engine refuses the next one: the poll after asks again
  seen.tree = ['c\thooks/status.ts', 'b\thooks/status.test.ts']
  await clock.advance(60_000)
  seen.refuse = false
  await clock.advance(60_000)
  expect(seen.reloads).toBe(3)
  await $.session.start(START) // what /reload-plugins runs once the module is loaded again
  await clock.settle() // at once, not at the next poll
  expect(seen.lines.at(-1)).toBeUndefined()
})

test("the tab: the session's name, at once on /rename, ❌ after an API error until the next turn", async ($, on) => {
  const { seen, title } = engine(on)
  await $.session.start(START)
  expect(seen.titles).toEqual(['wendelin-4b'])
  seen.name = 'river-study'
  await $.command.run(RENAME)
  expect(seen.titles.at(-1)).toBe('river-study')
  await $.turn.start({ text: 'go', turnId: 't' })
  await end($, 'error')
  expect(await title()).toBe('❌ river-study')
  await $.turn.start({ text: 'again', turnId: 't2' })
  expect(await title()).toBe('◐ river-study')
})

test('the tab leads with what it needs: ❌ an API error over ◐ working over 🔴 open decisions', async ($, on) => {
  const { title } = engine(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' })
  expect(await title()).toBe('◐ wendelin-4b') // as the turn starts, not at the next poll
  await end($, 'answer', 'Merged.\n\n🔴 **Needs you:**\n1. **Raise the spot quota?** "yes" (recommended) or "no"')
  expect(await title()).toBe('🔴 wendelin-4b')
  await $.prompt.submit({ text: 'yes', origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'yes', turnId: 't2' })
  expect(await title()).toBe('◐ wendelin-4b') // the owner answered: the agent works again
  await end($, 'error')
  expect(await title()).toBe('❌ wendelin-4b') // over the decisions still open
  await $.turn.start({ text: 'again', turnId: 't3' })
  await end($, 'answer', 'Done.')
  expect(await title()).toBe('wendelin-4b') // nothing left for the owner
})

test('the tab keeps ◐ while background work the turn left runs, under open decisions, until a stop reports none', async ($, on) => {
  const { title } = engine(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' })
  await stop($, 1)
  await end($, 'answer', 'Running: CI, done ~13:00Z.')
  expect(await title()).toBe('◐ wendelin-4b') // the agent still works; the owner is not needed
  await $.turn.start({ text: '<task-notification>', turnId: 't2' })
  await stop($, 1)
  await end($, 'answer', 'Running: CI.\n\n🔴 **Needs you:**\n1. **Raise the spot quota?** "yes" (recommended) or "no"')
  expect(await title()).toBe('🔴 wendelin-4b') // a decision waits on the owner, whatever runs on
  await $.prompt.submit({ text: 'yes', origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'yes', turnId: 't3' })
  await stop($, 0)
  await end($, 'answer', 'Done.')
  expect(await title()).toBe('wendelin-4b')
})

test('a question the turn asks shows 🔴 until the owner answers it, then ◐ again', async ($, on) => {
  const { question, title } = engine(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' })
  const call = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(await title()).toBe('🔴 wendelin-4b')
  question.answer()
  await call
  expect(await title()).toBe('◐ wendelin-4b')
})

test('a permission prompt shows 🔴 from its request until its call ends; a request a hook decides shows none', async ($, on) => {
  const { clock, seen, question, title } = engine(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' })
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as never) // held, as the engine holds it, until answered
  await clock.settle()
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }) // no hook decided: the dialog asks
  expect(await title()).toBe('🔴 wendelin-4b')
  question.answer() // the owner answered; the tool ran
  await call
  expect(await title()).toBe('◐ wendelin-4b')
  // Two Bash calls at once, only the second asked about: its answer clears 🔴 while the first still runs.
  const ci = $.tool.call({ tool: 'Bash', command: 'gh pr checks 12 --watch' } as never)
  await clock.settle()
  const second = $.tool.call({ tool: 'Bash', command: 'rm -rf dist' } as never)
  await clock.settle()
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } })
  expect(await title()).toBe('🔴 wendelin-4b')
  question.answer() // the stub answers the newest call held: the one asked about
  await second
  expect(await title()).toBe('◐ wendelin-4b')
  question.answer()
  await ci
  seen.decide = true // a settings hook allows it: no dialog
  const allowed = $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await clock.settle()
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  expect(await title()).toBe('◐ wendelin-4b')
  question.answer()
  await allowed
})

test('✓ once a reply says the session can close and nothing runs on; the next turn clears it', async ($, on) => {
  const { title } = engine(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' })
  await stop($, 1)
  await end($, 'answer', 'Done. Merged. You can close this session.')
  expect(await title()).toBe('◐ wendelin-4b') // a shell it started still runs
  await $.turn.start({ text: '<task-notification>', turnId: 't2' })
  await stop($, 0)
  await end($, 'answer', 'Done. Merged. You can close this session.')
  expect(await title()).toBe('✓ wendelin-4b')
  await $.turn.start({ text: 'one more thing', turnId: 't3' })
  expect(await title()).toBe('◐ wendelin-4b')
  await end($, 'answer', 'Done.')
  expect(await title()).toBe('wendelin-4b')
})

test("the title is one write between the engine's frames, never during them", async ($, on) => {
  const { clock, seen } = engine(on)
  await $.session.start(START)
  seen.titles.length = seen.idle.length = 0
  // The engine draws a piece of a frame every 10 ms; a title landing between pieces cuts a sequence in half.
  seen.frameAt = clock.now()
  await $.turn.start({ text: 'go', turnId: 't' })
  for (let i = 0; i < 150; i++) { // longer than any wait a title gives up after
    await clock.advance(10)
    seen.frameAt = clock.now()
  }
  expect(seen.titles).toEqual([]) // asked for at once, held while the terminal is being written
  await clock.advance(50)
  expect(seen.titles).toEqual(['◐ wendelin-4b'])
  expect(seen.idle[0]).toBeGreaterThanOrEqual(50)
})

test('a reply that is done, not done or asks the owner notifies him through the terminal after the title; others do not', async ($, on) => {
  const { clock, seen } = engine(on)
  await $.session.start(START)
  const turn = async (answer: string) => {
    await $.turn.start({ text: 'go', turnId: 't' })
    await end($, 'answer', answer)
    await clock.settle()
  }
  const NOTE = (body: string) => `\u001b]777;notify;wendelin-4b;${body}\u0007`
  await turn('**Done.** Merged #12; deployed.\x07\n\nDetail below.')
  expect(seen.notices).toEqual([NOTE('Done. Merged #12 deployed.')]) // marks, `;` and control characters gone
  await turn('Running: CI, done ~13:00Z.')
  await turn('Here is the table you asked for.')
  expect(seen.notices).toHaveLength(1)
  await turn(`Not done: ${'x'.repeat(300)}`)
  expect([...seen.notices.at(-1)!.split(';').at(-1)!.slice(0, -1)]).toHaveLength(200) // cut, with its ellipsis
  await turn('Blocked: the spot quota.')
  expect(seen.notices.at(-1)).toBe(NOTE('Blocked: the spot quota.'))
  seen.frameAt = clock.now() // the engine draws: the notification waits for the quiet, as the title does
  await turn('Merged.\n\n🔴 **Needs you:**\n1. **Raise the spot quota?** "yes" (recommended) or "no"')
  expect(seen.notices).toHaveLength(3)
  await clock.advance(50)
  expect(seen.notices.at(-1)).toBe(NOTE('Needs you: Raise the spot quota?'))
  expect(seen.titles.at(-1)).toBe('🔴 wendelin-4b')
})

test('without AGENT_TOOLING_NOTIFY=1 a reply notifies nothing; the title still follows', async ($, on) => {
  const { clock, seen } = engine(on)
  seen.notify = false
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' })
  await end($, 'answer', 'Merged.\n\n🔴 **Needs you:**\n1. **Raise the spot quota?** "yes" (recommended) or "no"')
  await clock.settle()
  expect(seen.notices).toEqual([])
  expect(seen.titles.at(-1)).toBe('🔴 wendelin-4b')
})

test('a title asked for while one waits replaces it: the newest is written, once', async ($, on) => {
  const { clock, seen } = engine(on)
  await $.session.start(START)
  seen.titles.length = 0
  seen.frameAt = clock.now()
  await $.turn.start({ text: 'go', turnId: 't' })
  await end($, 'error') // ❌ while ◐ waits for a gap
  await clock.advance(100)
  expect(seen.titles).toEqual(['❌ wendelin-4b'])
})

test('the /rename offer waits while the band offers its ghost reply, so Tab takes ★ as the band says', async ($, on) => {
  const { clock, seen } = engine(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' })
  await end($, 'answer', '🔴 **Needs you:**\n1. **Raise the spot quota?** "yes" (recommended) or "no"')
  await clock.advance(60_000)
  expect(seen.suggested).toEqual(['re 🔴1: yes'])
  // The owner's own prompt puts the band away; the decision stays open, but no ghost waits on Tab.
  await $.prompt.submit({ text: 'first the logs', origin: { kind: 'composer' } } as never)
  await clock.advance(60_000)
  expect(seen.suggested.at(-1)).toMatch(/^\/rename /)
})

const FILE = `/Users/me/.runtime/claude-sessions/${SESSION}.json`

test('the session file follows the tab: glyph, name, notice and the band\'s decisions, a grant and the ★ marked; gone at the end', async ($, on) => {
  const { clock, seen } = engine(on)
  const file = async () => (await clock.settle(), JSON.parse(seen.files.get(FILE) ?? 'null'))
  await $.session.start(START)
  expect(await file()).toEqual({ version: 1, sessionId: SESSION, name: 'wendelin-4b', glyph: '', notice: '', decisions: [], updatedAt: '2026-10-25T11:00:00Z' })
  await $.turn.start({ text: 'go', turnId: 't' })
  expect((await file()).glyph).toBe('◐')
  await end($, 'answer', 'Merged.\n\n🔴 **Needs you:**\n1. **Restart live hype_fade?** "go: restart live hype_fade" or "wait" (recommended)\n2. **Raise the spot quota?** Reply "yes" or "no"')
  const asked = await file()
  expect([asked.glyph, asked.notice]).toEqual(['🔴', 'Needs you: Restart live hype_fade?'])
  expect(asked.decisions).toEqual([
    { n: 1, title: 'Restart live hype_fade?', text: '**Restart live hype_fade?** "go: restart live hype_fade" or "wait" (recommended)', commands: [], drafts: [], options: [{ text: 'go: restart live hype_fade', recommended: false, grant: true }, { text: 'wait', recommended: true, grant: false }], answered: false },
    { n: 2, title: 'Raise the spot quota?', text: '**Raise the spot quota?** Reply "yes" or "no"', commands: [], drafts: [], options: [{ text: 'yes', recommended: false, grant: false }, { text: 'no', recommended: false, grant: false }], answered: false },
  ])
  const saves = seen.saves
  await $.command.run(RENAME) // the same tab painted again: nothing new to write
  expect((await file(), seen.saves)).toBe(saves)
  // The owner's prompt answers the block: the file says so before the next turn paints the tab.
  await $.prompt.submit({ text: 'wait on both', origin: { kind: 'composer' } } as never)
  expect((await file()).decisions.map((d: { answered: boolean }) => d.answered)).toEqual([true, true])
  await $.turn.start({ text: 'wait on both', turnId: 't2' })
  expect([(await file()).glyph, (await file()).notice]).toEqual(['◐', '']) // a turn that works has notified nothing yet
  await $.session.end({ reason: 'prompt_input_exit', sessionId: SESSION, resume: {} } as never)
  expect(await file()).toBeNull()
  await $.turn.start({ text: 'late', turnId: 't3' }) // a paint after the end writes no file again
  expect(await file()).toBeNull()
})

// predictions-v2's block, 2026-10-28 (wendelin-ios-ghostty-2026-10-28/work/acceptance-4): the Kei draft never reached the phone.
const KEI_DRAFT =
  'Kei: Polymarket V2 support for the native executor is built and audited, but held. Once merged, while a 5-minute window lists in both V1 and V2, the executor would trade the V2 market. That only matters for G5 once BTC lists V2 (today only the ZEC pilot does). Should G5 trade V2 first when that happens, or stay on V1 until you say?'
const KEI = `🔴 **Needs you:**\n1. **Ask Kei whether G5 should trade V2 first.** This is the one answer still holding pe#1047, the PR that switches windows listed in both V1 and V2 to the V2 market. If Kei says yes, reply \`"merge V2 PR 3, check on <wallet>"\`.\n\`\`\`draft\n${KEI_DRAFT}\n\`\`\``

test("each decision in the session file carries its item's drafts, the band's copy rows; a run of reply fences is no draft", async ($, on) => {
  const { clock, seen } = engine(on)
  const decisions = async () => (await clock.settle(), JSON.parse(seen.files.get(FILE)!).decisions)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' })
  await end($, 'answer', `Built and audited.\n\n${KEI}`)
  expect((await decisions()).map((d: { drafts: string[] }) => d.drafts)).toEqual([[KEI_DRAFT]])
  await $.turn.start({ text: 'next', turnId: 't2' })
  await end(
    $,
    'answer',
    '```draft\nAll: shipped.\n```\n\n🔴 **Needs you:**\n1. **Raise the spot quota?** Replies:\n\n   ```draft\n   yes\n   ```\n\n   ```draft\n   no\n   ```\n2. **Tell William the plan.**\n\n   ```draft\n   William: the plan is on.\n\n   - **Monday**: the cutover\n   ```',
  )
  const [quota, william] = await decisions()
  expect([quota.options.map((o: { text: string }) => o.text), quota.drafts]).toEqual([['yes', 'no'], []])
  expect(william.drafts).toEqual(['William: the plan is on.\n\n- **Monday**: the cutover']) // its own, Markdown kept; the reply's draft above the block none's
})

test('a /clear starts the new session\'s file without the notification the old one\'s last turn gave', async ($, on) => {
  const { clock, seen } = engine(on)
  await $.session.start(START)
  await $.turn.start({ text: 'go', turnId: 't' })
  await end($, 'answer', 'Done. Merged #12.')
  await clock.settle()
  expect(JSON.parse(seen.files.get(FILE)!).notice).toBe('Done. Merged #12.')
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: {} } as never)
  seen.id = 'b0b0b0b0-0000-4000-8000-000000000000'
  await $.classic.SessionStart({ source: 'clear' } as never)
  await clock.settle()
  expect([...seen.files.keys()]).toEqual([`/Users/me/.runtime/claude-sessions/${seen.id}.json`])
  expect(JSON.parse(seen.files.get(`/Users/me/.runtime/claude-sessions/${seen.id}.json`)!).notice).toBe('')
})
