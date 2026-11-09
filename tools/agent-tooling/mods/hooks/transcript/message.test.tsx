import { expect, mock, test } from 'claude-code/testing'

import { DROP, GRANT } from '../fixtures/grant'
import { segments } from './blocks'
import { goes, needsYou, offers } from '../reply/parse'
import { answerNamed } from '../reply/state'
import { copyArgv } from '../reply/draft'
import { STRANDS, engine, message } from '../fixtures/message'

test("a leading verdict and each 🔴 Needs you line are bold words on their role's color; prose stays the engine's", async ($, on) => {
  engine(on)
  // The owner, 2026-10-27: "whenever you say you are done or need my input clearly make that visible".
  for (const [text, bg] of [
    ['Done. Merged #73.', 'success'],
    ['**Not done:** CI is red.', 'error'],
    ['Running: the audit, finishing 06:10Z.', 'claude'],
    ['Resolved: PnL is back above the line.', 'success'],
  ]) {
    const ui = await $.ui.mount(message(text!, 100))
    const word = await ui.find({ type: 'Text', text: /^(Done\.|Not done:|Running:|Resolved:)$/ })
    expect(word?.props).toMatchObject({ color: bg, weight: 'bold' })
  }
  const prose = await $.ui.mount(message('Merged. Done. Nothing waits.', 100))
  expect(await prose.find({ type: 'Text', text: 'engine' })).toBeDefined()
  for (const mark of ['🔴 **Needs you:**', '**🔴 Needs you:**']) {
    const asks = `${STRANDS}\n\n${mark}\n1. **Merge?** I recommend yes.`
    const ui = await $.ui.mount(message(asks, 100))
    expect((await ui.findAll({ type: 'Text', text: 'Needs you' })).at(-1)?.props).toMatchObject({ color: 'error', weight: 'bold' })
    expect((await ui.findAll({ type: 'Markdown' })).map(m => m.props?.text)).toContain('1. **Merge?** I recommend yes.')
  }
  // Text after the mark stays on its line; a mention mid-paragraph is no mark.
  const inline = await $.ui.mount(message('🔴 **Needs you:** approve the prod run.', 100))
  expect((await inline.findAll({ type: 'Text' })).map(t => t.text)).toContain(' approve the prod run.')
  expect(segments('The 🔴 Needs you: block below.').map(s => s.kind)).toEqual(['markdown'])
  // On a list item the engine keeps the line, so the list stays whole (the band still reads it).
  expect(segments('- Merged.\n- 🔴 **Needs you:** rotate the key.\n- Deployed.').map(s => s.kind)).toEqual(['markdown'])
  for (const mark of ['🔴 **Needs you**:', '🔴 Needs you (2):']) expect(segments(`${mark}\n1. Merge?`)[0]?.kind).toBe('needs')
})

test('a verdict after Kei’s TL;DR mark is a badge too, the mark and its severity tag drawn before it as written', async ($, on) => {
  engine(on)
  for (const [line, mark] of [
    ['🩵 **TL;DR:** Done. Merged #73.', '🩵 '],
    ['🩷 **TL;DR:** (Needs You) Not done: pick the cap.', '🩷 '],
  ]) {
    const [first] = segments(line!)
    expect(first?.kind).toBe('verdict')
    const ui = await $.ui.mount(message(line!, 100))
    expect(await ui.find({ type: 'Text', text: /^(Done\.|Not done:)$/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('')).toContain(mark!)
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('')).toContain('TL;DR:')
  }
  expect(segments('🩷 **TL;DR:** (Needs You) Not done: x')[0]).toMatchObject({ verdict: { word: 'Not done:' } })
  for (const tag of ['Trading', 'Changes'])
    expect(segments(`🩷 **TL;DR:** (${tag}) Running: x`)[0]).toMatchObject({ verdict: { word: 'Running:' } })
  // A TL;DR without a verdict word stays the engine's.
  expect(segments('🩷 **TL;DR:** (Update) collector healthy.').map(s => s.kind)).toEqual(['markdown'])
})

test('no reply shows the engine’s ⏺: a TL;DR one is drawn here, a plain one the engine draws as a later block', async ($, on) => {
  engine(on)
  const plain = await $.ui.mount(message('🩷 **TL;DR:** (Update) collector healthy.\n\nMore.', 100))
  expect(await plain.find({ type: 'Text', text: 'engine' })).toBeUndefined()
  expect(await plain.find({ type: 'Text', text: '⏺' })).toBeUndefined()
  const verdict = await $.ui.mount(message('🩵 **TL;DR:** Done. Merged.', 100))
  expect(await verdict.find({ type: 'Text', text: '⏺' })).toBeUndefined()
})

test('a plain reply is the engine’s, told it is no reply’s first block so it draws no ⏺', async ($, on) => {
  let seen: unknown
  on('ui.render', ($, e) => {
    if (e.component === 'AssistantMessage') seen = e.props.isFirstOfReply
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const other = await $.ui.mount(message('Merged the fix, CI is green.', 100))
  expect(await other.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(seen).toBe(false)
})

test('a GitHub alert is a box in its color under its label; any other quote stays the engine’s', async $ => {
  const reply = 'Intro.\n\n> [!WARNING]\n> The release restarts **paper hype_fade**.\n> Records are kept.\n\n> A plain quote.\n\nAfter.'
  expect(segments(reply).map(s => s.kind)).toEqual(['markdown', 'alert', 'markdown'])
  const ui = await $.ui.mount(message(reply, 100))
  const box = (await ui.findAll({ type: 'Box' })).find(b => b.props?.borderStyle === 'round')
  // As wide as its label beside its widest line, `The release restarts paper hype_fade.`, and its border and padding.
  expect(box?.props).toMatchObject({ borderColor: 'warning', width: 9 + 1 + 37 + 4 })
  // Its label is a badge on the quote's first line, so a one-line alert takes three rows.
  expect((await ui.findAll({ type: 'Text', text: 'Warning' })).at(-1)?.props).toMatchObject({ color: 'warning', weight: 'bold' })
  const markdown = (await ui.findAll({ type: 'Markdown' })).map(m => m.props?.text)
  expect(markdown).toContain('The release restarts **paper hype_fade**.\nRecords are kept.')
  expect(markdown.join('\n')).toContain('> A plain quote.')
  for (const [level, color] of [['NOTE', 'permission'], ['TIP', 'success'], ['IMPORTANT', 'merged'], ['CAUTION', 'error']])
    expect(segments(`> [!${level}]\n> x`)[0]).toMatchObject({ kind: 'alert', color })
})

test('a top-level # or ## heading is the engine’s over a rule; deeper or indented headings stay the engine’s', async $ => {
  const reply = '## Plan for **today**\n\nText.\n\n### Detail\n\n- item\n\n  ## nested'
  expect(segments(reply).map(s => s.kind)).toEqual(['heading', 'markdown'])
  const ui = await $.ui.mount(message(reply, 60))
  // The engine draws the heading's own markdown, emphasis, entities and links included.
  expect((await ui.findAll({ type: 'Markdown' })).map(m => m.props?.text)).toContain('## Plan for **today**')
  expect((await ui.findAll({ type: 'Text' })).find(t => /^─{58}$/.test(t.text ?? ''))?.props).toMatchObject({ color: 'subtle' })
})

test('replies quoted in a Needs you block are the band’s chips, short forms too, picked and sent as there; other quotes stay text', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('session.id', () => ({ value: 's1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.suggest', () => ({ isShown: true }))
  const sent: string[] = []
  const filled: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  // The owner was typing: a press puts its answer before his draft, which stays.
  on('prompt.read', () => ({ value: { text: 'my draft', cursor: 8 } }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  const reply = [
    'He said "yes" earlier.',
    '',
    '🔴 **Needs you:**',
    '1. **Raise the quota?** `"yes, to 256"` (recommended) or "no"; not `grep "no" log`.',
    '   Since no quota rose, yes, to 256 is safe.',
    '2. **Grafana:** Reply "obs-follow 1", "2" or "3".',
    '   ```',
    '   echo "no"',
    '   ```',
  ].join('\n')
  const turn = (answer: string, turnId: string) => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' })
  await turn(reply, 't1')
  const ui = await $.ui.mount(message(reply, 100))
  const buttons = await ui.findAll({ type: 'Button' })
  // Every reply the band offers, the short forms named as it names them; none from the code or the line above.
  expect(buttons.map(b => b.text)).toEqual(['★ yes, to 256', 'no', 'obs-follow 1', 'obs-follow 2', 'obs-follow 3'])
  expect((buttons[0]?.children as { props: Record<string, unknown> }[])[0]?.props).toMatchObject({ color: 'text', backgroundColor: 'diffAddedDimmed', bold: true })
  // A press picks, drawn picked here as in the band; the pick that leaves no decision open sends them all as one prompt.
  await ui.press({ key: String(buttons[3]?.props.key) })
  expect(sent).toEqual([])
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toContain('✓ obs-follow 2')
  await ui.press({ key: String(buttons[1]?.props.key) })
  expect(sent).toEqual(['re 🔴1: no; 🔴2: obs-follow 2'])
  // Once a later reply came, a chip of this one puts its answer in the prompt, by its point, never by a number the later one reuses.
  await turn('Done. 🔴 **Needs you:** merge? Reply "yes" or "no".', 't2')
  await ui.press({ key: String(buttons[3]?.props.key) })
  expect([sent.slice(1), filled]).toEqual([[], ['re "Grafana": obs-follow 2\n\nmy draft']])
  // A point that is all offer keeps its whole title.
  expect(answerNamed('Reply "a" or "b"', 'a')).toBe('re "Reply "a" or "b"": a')
  const markdown = (await ui.findAll({ type: 'Markdown' })).map(m => m.props?.text)
  // A line of the item holding a reply's words but no quote of it stays the engine's.
  expect(markdown).toEqual(['He said "yes" earlier.', 'Since no quota rose, yes, to 256 is safe.', '```\necho "no"\n```'])
  // The item's mark beside its text, the fence under it at the item's indent.
  expect((await ui.findAll({ type: 'Text', text: '2. ' })).length).toBeGreaterThan(0)
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props?.marginLeft === 3)).toBe(true)
})

test('a draft fence is framed under its Draft label and copy chip, which copies it; an unclosed one stays code', async ($, on) => {
  const ran: (readonly string[])[] = []
  on('process.run', (_, e) => {
    if (e.argv[0] === 'uname') return { value: { exitCode: 0, stdout: 'Darwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    ran.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('env.get', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  const reply = 'Draft for Kei:\n\n```draft\nHi Kei, **paper** restarts at 10:00Z.\n- records kept\n```\n\nAfter.'
  expect(segments(reply).map(s => s.kind)).toEqual(['markdown', 'draft', 'markdown'])
  expect(segments(reply)[1]).toEqual({ kind: 'draft', body: 'Hi Kei, **paper** restarts at 10:00Z.\n- records kept', indent: 0, at: [2, 5] })
  const ui = await $.ui.mount(message(reply, 60))
  const frame = (await ui.findAll({ type: 'Box' })).find(b => b.props?.borderStyle === 'round')
  // As wide as its widest line drawn, `Hi Kei, paper restarts at 10:00Z.`, and its border and padding (owner, 2026-10-27).
  expect(frame?.props).toMatchObject({ borderColor: 'suggestion', width: 33 + 4 })
  const width = async (body: string, columns: number) => {
    const drawn = await $.ui.mount(message(`\`\`\`draft\n${body}\n\`\`\``, columns))
    const box = (await drawn.findAll({ type: 'Box' })).find(b => b.props?.borderStyle === 'round')
    await drawn.unmount()
    return box?.props?.width
  }
  // One short line takes its header's width, ` Draft ` and `[ copy ]`, however wide the terminal.
  expect(await width('glue in fair/', 200)).toBe(16 + 4)
  // A long one is as wide as the prose around it and wraps there: no table's 110-cell cap (owner, 2026-10-27).
  const long = 'Paper restarts at 10:00Z and keeps its records. '.repeat(5)
  expect([await width(long, 60), await width(long, 200)]).toEqual([58, 198])
  expect((await ui.findAll({ type: 'Text', text: 'Draft' })).at(-1)?.props).toMatchObject({ color: 'suggestion', weight: 'bold' })
  // The band's own chip: the same Button and blue label, pressable here too.
  const copy = await ui.find({ type: 'Button', key: 'frame1:copy' })
  expect((copy?.children as { props: Record<string, unknown> }[])[0]?.props).toMatchObject({ backgroundColor: 'userMessageBackground' })
  await ui.press({ key: 'frame1:copy' })
  expect(ran).toEqual([copyArgv('Hi Kei, **paper** restarts at 10:00Z.\n- records kept')])
  expect((await ui.findAll({ type: 'Markdown' })).map(m => m.props?.text)).toContain('Hi Kei, **paper** restarts at 10:00Z.\n- records kept')
  // Under a list item it keeps the item's indent; an unclosed fence is the engine's code block.
  expect(segments('1. Send:\n   ```draft\n   Hi.\n     - x\n   ```')[1]).toEqual({ kind: 'draft', body: 'Hi.\n  - x', indent: 3, at: [1, 4] })
  // Fences right after a numbered item, at the margin, are framed each (the owner's 10-27 block).
  const after = '1. **Keep?** It holds.\n```draft\nkeep\n```\n```draft\ndrop\n```\n   (first one recommended)'
  expect(segments(after).map(s => s.kind)).toEqual(['markdown', 'draft', 'draft', 'markdown'])
  expect(segments('```draft\nHi.').map(s => s.kind)).toEqual(['markdown'])
})

// The owner's 2026-10-27 screenshot: "this looks werid. avoid things like this".
test('draft fences in a row under a numbered decision are its replies: chips on lines of their own, no frames', async ($, on) => {
  on('session.id', () => ({ value: 's1' }))
  const reply = [
    '🔴 **Needs you:**',
    "2. **Where glue goes.** Recommended: `fair/`, as FAIR2's runtime. Alternative: `interface/`, as you sketched.",
    '```draft\nglue in fair/\n```',
    '```draft\nglue in interface/\n```',
  ].join('\n')
  expect(segments(reply, true, offers(reply)).map(s => s.kind)).toEqual(['needs', 'markdown', 'offer', 'offer'])
  const ui = await $.ui.mount(message(reply, 100))
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['glue in fair/', 'glue in interface/'])
  expect((await ui.findAll({ type: 'Box' })).filter(b => b.props?.borderStyle === 'round')).toEqual([])
})

// The owner's 2026-10-27 Images #101 and #103: "why isnt go stop ... a button here?", "why wasnt this a button?".
test('a reply whose code span holds its (recommended), or that follows two asides, is a chip; a grant among them', async ($, on) => {
  on('session.id', () => ({ value: 's1' }))
  const go = 'go: stop live native-d5 at the final-set restart'
  const merge = 'merge #1035 first; Kei redoes #1034'
  expect(needsYou(GRANT).map(d => [d.options, d.recommended])).toEqual([
    [[], undefined],
    [[go, 'keep native-d5 running'], go],
    [[merge, 'hold #1035 until #1034 merges'], merge],
  ])
  const ui = await $.ui.mount(message(GRANT, 100))
  const chips = (await ui.findAll({ type: 'Button' })).map(b => b.text).filter(t => !/copy/i.test(t ?? ''))
  expect(chips).toEqual([`★ ${go}`, 'keep native-d5 running', `★ ${merge}`, 'hold #1035 until #1034 merges'])
  const drop = await $.ui.mount(message(DROP, 100))
  expect((await drop.findAll({ type: 'Button' })).map(b => b.text)).toEqual(["★ drop 'with a clear progression'", 'raise the limit to 3,310'])
})

test('a decision offering a grant opens with a warning ` Your go ` badge, on its own line or the Needs you line; a plain one none', async ($, on) => {
  on('session.id', () => ({ value: 's1' }))
  const parts = segments(GRANT, true, offers(GRANT), goes(GRANT))
  expect(parts.flatMap(p => (p.kind === 'offer' && p.go ? [p.marker] : []))).toEqual(['2. '])
  const ui = await $.ui.mount(message(GRANT, 100))
  expect((await ui.findAll({ type: 'Text', text: 'Your go' })).map(t => t.props)).toEqual([
    expect.objectContaining({ color: 'warning', weight: 'bold' }),
  ])
  const one = '🔴 **Needs you:** restart live hype_fade? Reply "go: restart live hype_fade" or "not now".'
  expect(segments(one, true, offers(one), goes(one))[0]).toMatchObject({ kind: 'needs', go: true })
  expect(goes(DROP)).toEqual(new Set())
})
