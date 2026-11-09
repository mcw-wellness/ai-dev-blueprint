import type { On, PromptAutocompleteInput, PromptAutocompleteResult } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { BAND, NOW, answered, poll, turn } from '../fixtures/band'
import { BOLD_RED, NUMBERED } from '../fixtures/blocks'

/** What the session sends as the owner's prompts, in order. */
function sends(on: On): string[] {
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  return sent
}

/** The engine's own band, which the plugin passes to when it has nothing to show. */
function engineBand(on: On) {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
}

/** Whether the band drawn now shows `text`: by default, the three decisions of NUMBERED. */
async function shows($: Parameters<TestBody>[0], text: RegExp | string = /3 decisions/) {
  const ui = await $.ui.mount(BAND)
  const up = (await ui.find({ type: 'Text', text })) !== undefined
  await ui.unmount()
  return up
}

test('a pick marks its chip, a second press takes it back; the pick that leaves no decision with replies open sends them all', async ($, on) => {
  const suggested: string[] = []
  const sent = sends(on)
  engineBand(on)
  const clock = await answered($, on, NUMBERED, suggested)
  await clock.advance(14 * 60_000)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /3 decisions · oldest 14m · Tab takes the answer/ })).toBeDefined()
  await ui.press({ key: 'd2:yes' })
  expect((await ui.find({ key: 'd2:yes' }))?.text).toBe('✓ yes')
  expect((await ui.find({ key: 'send' }))?.text).toBe('send 1 of 2')
  await ui.press({ key: 'd2:yes' })
  expect((await ui.find({ key: 'd2:yes' }))?.text).toBe('★ yes')
  await ui.press({ key: 'd2:no' })
  // The ghost text follows the picks over the ★.
  expect(suggested.at(-1)).toBe('re 🔴1: 5; 🔴2: no')
  expect(sent).toEqual([])
  // Decision 3 is answered in words: it holds nothing back.
  await ui.press({ key: 'd1:1' })
  expect(sent).toEqual(['re 🔴1: 1; 🔴2: no'])
  await ui.unmount()
  expect(await shows($)).toBe(false)
  expect(suggested[0]).toBe('re 🔴1: 5; 🔴2: yes')
})

test('the owner’s own prompt carries the replies picked in the band', async ($, on) => {
  const sent = sends(on)
  engineBand(on)
  await answered($, on, NUMBERED)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'd1:5' })
  await ui.unmount()
  await $.prompt.submit({ text: 'and for 2: only after the cap test', origin: { kind: 'composer' } } as never)
  expect(sent).toEqual(['re 🔴1: 5\n\nand for 2: only after the cap test'])
  expect(await shows($)).toBe(false)
})

test('a pressed grant is the owner\'s go and sends it at once (owner, 2026-10-27)', async ($, on) => {
  const sent = sends(on)
  engineBand(on)
  // A relayed grant counts too (the owner's 10-27 Kei block).
  await answered($, on, '🔴 **Needs you:** relay his answer. Reply "Kei\'s go: KB2P live" or "wait".')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: "d1:Kei's go: KB2P live" })
  expect(sent).toEqual(["re 🔴1: Kei's go: KB2P live"])
  await ui.unmount()
})

test('a grant picked while another decision is open never rides on a prompt the owner types', async ($, on) => {
  const sent = sends(on)
  engineBand(on)
  await answered($, on, '🔴 **Needs you:**\n1. **Restart?** Reply "go: restart live g5" or "wait".\n2. **Size?** Reply "5" or "1".')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'd1:go: restart live g5' })
  await ui.unmount()
  await $.prompt.submit({ text: 'hold off', origin: { kind: 'composer' } } as never)
  expect(sent).toEqual(['hold off'])
})

test('send sends the replies picked so far', async ($, on) => {
  const sent = sends(on)
  engineBand(on)
  await answered($, on, NUMBERED)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'd2:yes' })
  await ui.press({ key: 'send' })
  expect(sent).toEqual(['re 🔴2: yes'])
  await ui.unmount()
  // Answered, a chip of the same reply only puts a new answer in the prompt: a double press never sends twice.
  expect(await shows($)).toBe(false)
})

test('re: lists the last answer’s lines and inserts the quote; a turn without a block keeps an unanswered band', async ($, on) => {
  on('prompt.autocomplete', () => ({ suggestions: [] }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  engineBand(on)
  await answered($, on, NUMBERED)

  // The kit raises every event, but its typings name no call for this one, which only the engine raises.
  const prompt = $.prompt as unknown as { autocomplete: (e: PromptAutocompleteInput) => Promise<PromptAutocompleteResult> }
  const { suggestions } = await prompt.autocomplete({ text: 're:hours', cursor: 8, token: 're:hours', start: 0 })
  expect(suggestions).toEqual([{ text: 're "Remaining: about 7 hours." ', label: 'Remaining: about 7 hours.', description: '' }])

  // A background agent's report asks nothing: the block is still unanswered, until a reply says nothing is needed.
  await $.turn.complete(turn('The scout is back: CI passed.', 't2'))
  expect(await shows($)).toBe(true)
  await $.turn.complete(turn('Done. The scout settled both; I merged.\n\n🔴 **Needs you:** nothing.', 't2b'))
  expect(await shows($)).toBe(false)
  await $.prompt.submit({ text: 'merge it', origin: { kind: 'composer' } } as never)
  await $.turn.complete(turn('Done. Merged.', 't3'))
  expect([await shows($, /Needs you/), await shows($, 'engine band')]).toEqual([false, true])
})

test('explain sends its question at once and keeps the band through the answer', async ($, on) => {
  const sent = sends(on)
  const filled: string[] = []
  on('prompt.read', () => ({ value: { text: 'my draft', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  engineBand(on)
  await answered($, on, NUMBERED)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'd2:explain' })
  expect(sent).toEqual([
    'Explain 🔴2 ("DIFF-15: at the position cap, should native count a dust remainder as already gone?") in plain words: what it does, what it changes for me, and what you recommend. Answer only; change nothing.',
  ])
  expect(filled).toEqual([])
  await ui.unmount()

  // The running turn's answer is no explanation; the explanation asks nothing, so the decisions stay.
  await $.turn.complete(turn(NUMBERED, 't1b'))
  await $.turn.start({ text: sent[0] ?? '', turnId: 't2' })
  await $.turn.complete(turn('It drops the remainder.', 't2'))
  expect(await shows($)).toBe(true)
  // The owner's next prompt answers them; the answer after it clears the band.
  await $.prompt.submit({ text: 'merge it', origin: { kind: 'composer' } } as never)
  await $.turn.complete(turn('Done. Merged.', 't3'))
  expect(await shows($, 'engine band')).toBe(true)
})

test('the owner’s own prompt puts the band away until an answer asks again; asking to explain keeps it', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }))
  engineBand(on)
  const typed = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } } as never)
  const clock = await answered($, on, NUMBERED)
  await typed('explain 🔴2')
  expect(await shows($)).toBe(true)
  // The owner moves on: the band goes at once, and no redraw or minute's tick brings it back while the turn runs.
  await typed('port polymarket_take too')
  expect(await shows($)).toBe(false)
  await clock.advance(3 * 60_000)
  expect(await shows($)).toBe(false)
  await $.turn.complete(turn(NUMBERED, 't2'))
  expect(await shows($)).toBe(true)
})

test('/resume within the process shows the band the resumed session left open; /clear shows none', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let session = 'a'
  let messages: { role: 'assistant'; text: string; toolUses: [] }[] = []
  poll(on, () => session)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: messages }))
  on('classic.SessionStart', () => ({}))
  on('prompt.suggest', () => ({ isShown: true }))
  engineBand(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(await shows($)).toBe(false)
  // The engine switches the session once its hooks on /resume ran.
  await $.classic.SessionStart({ source: 'resume' } as never)
  ;[session, messages] = ['b', [{ role: 'assistant', text: NUMBERED, toolUses: [] }]]
  await clock.settle()
  expect(await shows($)).toBe(true)
  // `/clear` starts a session that asks nothing.
  await $.classic.SessionStart({ source: 'clear' } as never)
  ;[session, messages] = ['c', []]
  await clock.settle()
  expect(await shows($)).toBe(false)
})

test('★ all picks only unpicked decisions and never a go reply, which takes its own press', async ($, on) => {
  const sent = sends(on)
  engineBand(on)
  await answered($, on, '🔴 **Needs you:**\n1. **A?** "a" (recommended) or "b".\n2. **C?** "c" (recommended) or "d".\n3. **Restart?** "go: restart live g5" (recommended) or "wait".')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'all' })
  expect(sent).toEqual([])
  await ui.press({ key: 'd3:go: restart live g5' })
  expect(sent).toEqual(['re 🔴1: a; 🔴2: c; 🔴3: go: restart live g5'])
  await ui.unmount()
})

test('dismiss takes a row and its pick away, sending nothing; send answers the rest', async ($, on) => {
  const sent = sends(on)
  engineBand(on)
  await answered($, on, BOLD_RED)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'd2:accept G-7' })
  await ui.press({ key: 'd1:drop Closable' })
  await ui.press({ key: 'd2:dismiss' })
  expect(sent).toEqual([])
  expect(await ui.find({ key: 'd2' })).toBeUndefined()
  expect((await ui.find({ key: 'send' }))?.text).toBe('send 1 of 2')
  await ui.press({ key: 'd3:no' })
  expect(sent).toEqual(['re 🔴1: drop Closable; 🔴3: no'])
  await ui.unmount()
})
