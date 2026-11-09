import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { report, shownIn } from './view'

type Engine = Parameters<TestBody>[0]

const REPLY = [
  'Done. The note for Kei:',
  '',
  '```draft',
  'Hi Kei.',
  '```',
  '',
  '🔴 **Needs you:**',
  '1. **Merge?** "yes" (recommended) or "no".',
  '2. **Deploy?** "go now" or "wait".',
].join('\n')

const BAND = {
  plugin: 'agent-tooling',
  component: 'AbovePrompt',
  surface: 'terminal',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

/** The reply drawn with `onScreen`: 9 rows, one per line at 100 columns, its block the last three, its draft above. */
const reply = (onScreen: { first: number; last: number } | null | undefined, isFullscreen = true, requestId = 'm1') =>
  ({
    plugin: 'agent-tooling',
    component: 'AssistantMessage',
    surface: 'terminal',
    requestId,
    viewport: { columns: 100, rows: 50, isFullscreen },
    props: { text: REPLY, isFirstOfReply: true, ...(onScreen === undefined ? {} : { onScreen: onScreen && { ...onScreen, of: 9 } }) },
  }) as const

/** A session whose last turn answered REPLY. */
async function answered($: Engine, on: On) {
  mock.clock(on, { now: 0 })
  on('session.id', () => ({ value: 's1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.suggest', () => ({ isShown: true }))
  await $.turn.complete({ answer: REPLY, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
}

/** The band's rows as the reply, drawn so, leaves them: its header, and which decision and draft rows it repeats. */
async function band($: Engine, drawn: ReturnType<typeof reply>, isFullscreen = true) {
  await (await $.ui.mount(drawn)).unmount()
  const ui = await $.ui.mount({ ...BAND, viewport: { columns: 100, rows: 50, isFullscreen } })
  const header = (await ui.find({ type: 'Text', text: /2 decisions · 1 draft/ })) !== undefined
  const rows = [(await ui.find({ key: 'd1:yes' })) && 'decisions', (await ui.find({ key: 'draft1:copy' })) && 'draft'].filter(Boolean)
  await ui.unmount()
  return { header, rows }
}

test('while the reply shows its Needs-you block and draft whole, the band is its header alone; else their rows return', async ($, on) => {
  await answered($, on)
  // Rows 6-8 hold the block, 2-4 the draft.
  expect(await band($, reply({ first: 0, last: 8 }))).toEqual({ header: true, rows: [] })
  expect(await band($, reply({ first: 6, last: 8 }))).toEqual({ header: true, rows: ['draft'] })
  expect(await band($, reply({ first: 0, last: 4 }))).toEqual({ header: true, rows: ['decisions'] })
  // Part of the block on screen is not the block: its first decision would show nowhere.
  expect(await band($, reply({ first: 7, last: 8 }))).toEqual({ header: true, rows: ['decisions', 'draft'] })
  expect(await band($, reply(null))).toEqual({ header: true, rows: ['decisions', 'draft'] })
})

test('two messages of the same text each keep their own record: one showing the block hides the rows, and no report repeats a change', async ($, on) => {
  await answered($, on)
  expect(await band($, reply({ first: 0, last: 8 }, true, 'm1'))).toEqual({ header: true, rows: [] })
  expect(await band($, reply(null, true, 'm2'))).toEqual({ header: true, rows: [] })
  // Only the first record changes what the band draws (this module's records, apart from the loaded plugin's).
  const whole = { first: 0, last: 8, of: 9 }
  expect([report('m1', REPLY, REPLY, whole, 98), report('m2', REPLY, REPLY, null, 98), report('m1', REPLY, REPLY, whole, 98)]).toEqual([true, false, false])
})

test('off fullscreen, where no row is reported, the band keeps every row', async ($, on) => {
  await answered($, on)
  expect(await band($, reply({ first: 0, last: 8 }))).toEqual({ header: true, rows: [] })
  expect(await band($, reply(undefined, false), false)).toEqual({ header: true, rows: ['decisions', 'draft'] })
})

test('a table after the block draws taller than its source: the rows stay until the block itself is on screen', async () => {
  // Drawn: rows 0-1 the lead, 2-3 the block, 4 blank, 5-10 the table in its frame (6 rows from 4 source lines).
  const text = ['Done.', '', '🔴 **Needs you:**', '1. **Merge?** "yes" (recommended) or "no".', '', '| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |'].join('\n')
  report('t1', text, text, { first: 2, last: 10, of: 11 }, 98)
  expect(shownIn(text)?.needs).toBe(true)
  // Scrolled one row past the decision: none shows, so the band keeps its rows.
  report('t1', text, text, { first: 4, last: 10, of: 11 }, 98)
  expect(shownIn(text)?.needs).toBe(false)
})
