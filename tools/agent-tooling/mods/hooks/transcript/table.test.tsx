import { expect, mock, test } from 'claude-code/testing'

import { REPLIES } from '../fixtures/replies'
import { cells, segments, strip } from './blocks'
import { columnWidths, layout, wrap } from './table'
import { STRANDS, engine, message } from '../fixtures/message'

const WIDTHS = [60, 100, 200]

// The engine's own colors a drawing may use: code spans, the rule and labels, the verdict roles and badge text, reply chips.
const COLORS = new Set([undefined, 'text', 'inverseText', 'permission', 'subtle', 'inactive', 'success', 'claude', 'error', 'merged', 'suggestion', 'warning'])

test('every real table reply fits 60, 100 and 200 columns, drawing only its own words', async $ => {
  const bad: string[] = []
  for (const [n, reply] of REPLIES.entries()) {
    // The source without the inline marks a drawing drops.
    const source = strip(reply).replace(/[`*~\\]|\]\([^)]*\)|\[/g, '')
    for (const columns of WIDTHS) {
      const ui = await $.ui.mount(message(reply, columns))
      for (const t of await ui.findAll({ type: 'Text' })) {
        const text = t.text ?? ''
        const at = `reply ${n} at ${columns}: `
        // No table line runs past the transcript's text column; prose wraps by itself.
        if (t.props?.wrap === 'truncate-end' && cells(text) > columns - 2) bad.push(`${at}${cells(text)} cells: ${text}`)
        if (!COLORS.has(t.props?.color as string | undefined)) bad.push(`${at}color ${t.props?.color}`)
        // Every word drawn is the source's: marks dropped, nothing added but rules and state glyphs.
        for (const word of text.split(/\s+/).filter(w => w && !/^─+$/.test(w) && !['⏺', '✓', '◐', '✗', '○', '★', 'Your'].includes(w)))
          if (!source.includes(word.replace(/[`*~\\]/g, ''))) bad.push(`${at}word ${word}`)
      }
      if (!(await ui.findAll({ type: 'Text' })).some(t => t.props?.wrap === 'truncate-end')) bad.push(`reply ${n} at ${columns}: no table`)
      // The prose stays the engine's markdown.
      if (!(await ui.find({ type: 'Markdown' }))) bad.push(`reply ${n} at ${columns}: no Markdown`)
      await ui.unmount()
    }
  }
  expect(bad).toEqual([])
})

const tableLines = async (ui: { findAll: (q: { type: 'Text' }) => Promise<{ text?: string; props?: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Text' })).filter(t => t.props?.wrap === 'truncate-end').map(t => t.text ?? '')

test('a table: bold header over a rule, a rule between rows, figures flush right; too narrow, labeled rows', async $ => {
  const wide = await $.ui.mount(message(STRANDS, 100))
  expect(await tableLines(wide)).toEqual([
    'Strand    Files                       Lines   Done when',
    '─'.repeat(73),
    'A reply   render/blocks.ts, table.ts    330   fixtures pass at 60/100/200',
    '─'.repeat(73),
    'B charts  views/mermaid.py, chart.ts  1,380   PNG matches golden',
  ])
  expect((await wide.findAll({ type: 'Text', text: 'Strand' })).at(-1)?.props).toMatchObject({ weight: 'bold' })
  // The rule between rows as muted as the header's (owner, 2026-10-27: lines between individual rows).
  const rules = (await wide.findAll({ type: 'Text' })).filter(t => /^─+$/.test(t.text ?? ''))
  expect(rules.flatMap(t => t.props?.color ?? [])).toEqual(['subtle', 'subtle']) // each line's span, not the line
  const narrow = await $.ui.mount(message(STRANDS, 40))
  expect(await tableLines(narrow)).toEqual([
    'A reply',
    '  Files      render/blocks.ts,',
    '             table.ts',
    '  Lines      330',
    '  Done when  fixtures pass at',
    '             60/100/200',
    '─'.repeat(38),
    'B charts',
    '  Files      views/mermaid.py,',
    '             chart.ts',
    '  Lines      1,380',
    '  Done when  PNG matches golden',
  ])
})

test('figures line up on their right edge, a note after one trailing; three cells part figures flush right from the next', async $ => {
  const plumbing = [
    '| Boundary | After last cleanup | Now | After this wave |',
    '|---|---|---|---|',
    '| main thread ↔ sender (new today) | 14 | **206** | ~200 (more once the duplicate write path goes) |',
    '| core ↔ strategy | 119 | 122 | 108 |',
    '| **Total** | **813** | **938** (2.1% of the code) | **~800** |',
  ].join('\n')
  const lines = await tableLines(await $.ui.mount(message(plumbing, 100)))
  const end = (figure: string) => {
    const line = lines.find(l => l.includes(figure))!
    return line.indexOf(figure) + figure.length
  }
  expect(new Set(['206', '122', '938'].map(end)).size).toBe(1)
  expect(new Set(['~200', '108', '~800'].map(end)).size).toBe(1)
  expect(lines.find(l => l.includes('122'))).toContain('119   122')
  // Narrow, a label wraps before an arrow, never after it.
  const narrow = await tableLines(await $.ui.mount(message(plumbing, 60)))
  expect(narrow.filter(l => /↔ {2,}|↔$/.test(l))).toEqual([])
})

// The owner's status table of 2026-10-25: one long `Who` cell among short ones, `Step` long on every row.
const PLAN = `| Step | State | Who |
|---|---|---|
| ro02 live on weekdays (request #38) | Done, live on v605 since 19:42Z | — |
| CryptoStruct London to 13 connections | Done | — |
| Free London cores (stop poly-ro02x2-paper, request #42) | Done 20:32Z | — |
| #1715 review fix (P1) and review | Done, delta review clean | — |
| #1715 CI | Running, about 21:00Z (estimate) | CI |
| Merge #1715, release to testing (restarts nothing) | Next, about 21:15Z | Me |
| Restart mm-live onto #1715 (shadow follows) | I file the request after the release | You approve in Control |
| Create the A/B paper instance on London | After the release | You click Create, I file its settings, you approve Start |
| Check live's latency data reaches the A/B (fallback off), hand it to Kei | Last | Me |
| Send Kei the follow-up note (six points) | Was on your clipboard; the six points are in \`kei-p2-note.md\` | You |`

test('spare width goes where it saves the most lines: no other split of the same width makes the table shorter', () => {
  const [seg] = segments(PLAN)
  if (seg?.kind !== 'table') throw new Error('no table')
  const t = seg.table
  const all = [t.header, ...t.rows]
  const widths = columnWidths(t, 98)!
  const total = widths.reduce((a, b) => a + b, 0)
  // Each column's line count per row at every width, then every split of the total.
  const heights = t.header.map((_, i) => Array.from({ length: total + 1 }, (_, w) => all.map(r => (w ? wrap(r[i]!, w).length : Infinity))))
  const rows = (ws: number[]) => all.reduce((n, _, r) => n + Math.max(...ws.map((w, i) => heights[i]![w]![r]!)), 0)
  let fewest = Infinity
  for (let a = 1; a < total; a++) for (let b = 1; a + b < total; b++) fewest = Math.min(fewest, rows([a, b, total - a - b]))
  expect(rows(widths)).toBe(fewest)
})

test('a cell opening with a state or the owner shows that word in its color; the row label and code stay plain', async $ => {
  const plan = [
    '| Step | State | Who |',
    '|---|---|---|',
    '| Done list | Done, live on v605 since 19:42Z | — |',
    '| #1715 CI | Running, about 21:00Z (estimate) | CI |',
    '| Restart mm-live | Blocked on the release | You approve in Control |',
    '| Release | `Done` in the log | Me |',
    '| Feeds | **Down**stream lag 2 s | — |',
    "| Release | Next, on your word | Me releases; you approve, you'd see it |",
  ].join('\n')
  const ui = await $.ui.mount(message(plan, 120))
  const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  const color = async (text: string) => (await ui.findAll({ type: 'Text', text: exact(text) })).map(t => t.props.color)
  // Drawn word by word: the row label's Done stays plain, the State cell's is colored, the code span keeps its own.
  expect(await color('Done')).toEqual([undefined, 'permission'])
  // Each state word after its glyph, one span in its color: done, running, blocked, not started.
  expect(await color('✓\u00a0Done')).toEqual(['success'])
  expect(await color('◐\u00a0Running')).toEqual(['claude'])
  expect(await color('✗\u00a0Blocked')).toEqual(['error'])
  expect(await color('○\u00a0Next')).toEqual(['inactive']) // grey, apart from a code span's blue
  expect(await color('You')).toEqual(['merged'])
  expect((await ui.findAll({ type: 'Text', text: exact('You') })).map(t => t.props.weight)).toEqual(['bold'])
  // A mid-sentence `you` is marked as the leading `You` is; `your` and `you'd` are not the owner acting.
  expect(await color('you')).toEqual(['merged'])
  expect((await ui.findAll({ type: 'Text', text: exact('you') })).map(t => t.props.weight)).toEqual(['bold'])
  expect(await color('your')).toEqual([undefined])
  expect(await color('—')).toEqual(['inactive', 'inactive'])
  expect(await color('Down')).toEqual([undefined]) // `**Down**stream` is one word, no state
  expect((await color(',')).every(c => c === undefined)).toBe(true) // the rest of the cell stays as written
  expect(await tableLines(ui)).toContain('Done list        ✓\u00a0Done, live on v605 since 19:42Z   —')
})

test('a table that wraps uses all the room it has', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  const band = { plugin: 'agent-tooling', component: 'AbovePrompt', surface: 'terminal' } as const
  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 95, scroll: { offset: 0, bodyRows: 10 }, view: {} }
  await $.ui.mount({ ...band, viewport: { columns: 100, rows: 50, isFullscreen: true }, props })
  await clock.settle()
  // The skills table: one cell lists seven skills, the rest are a word or two. Too wide for 98 cells, it wraps at 98,
  // leaving no room unused while a cell wraps.
  const lines = await tableLines(await $.ui.mount(message(REPLIES.find(r => r.includes('| security-audit |'))!, 100)))
  const skills = lines.slice(0, lines.findIndex(l => l.startsWith('Into')))
  expect(Math.max(...skills.map(cells))).toBe(98)
})

test('at 200 columns a table that fits keeps its width; one that must wrap wraps at 110 cells', async $ => {
  const table = (times: number) => `| Step | Detail |\n|---|---|\n| one | ${'a long cell that keeps going '.repeat(times)}|`
  const fits = await tableLines(await $.ui.mount(message(table(5), 200)))
  expect(fits).toHaveLength(3)
  expect(Math.max(...fits.map(cells))).toBeGreaterThan(110)
  const wraps = await tableLines(await $.ui.mount(message(table(8), 200)))
  expect(Math.max(...wraps.map(cells))).toBe(110)
  expect(wraps.length).toBeGreaterThan(3)
})

// Measured 14-17 units at load average 67 (2026-10-27); wrapping every candidate width took about 20 times that.
const BUDGET_UNITS = 60

test('a hundred-row table too wide for the column lays out within a frame budget', () => {
  const rows = Array.from({ length: 100 }, (_, i) => `| item ${i} | ${'words that wrap '.repeat(8)}| ${'a note '.repeat(6)}|`)
  const [t] = segments(['| Item | Detail | Note |', '| --- | --- | --- |', ...rows].join('\n'))
  if (t?.kind !== 'table') throw new Error('no table')
  // The fastest of three runs, against fixed string work timed alike: a loaded machine slows both.
  const fastest = (work: () => unknown) =>
    Math.min(...[0, 1, 2].map(() => {
      const start = performance.now()
      work()
      return performance.now() - start
    }))
  const unit = fastest(() => Array.from({ length: 200_000 }, (_, i) => `w${i}`).join(' ').split(' ').length)
  const took = fastest(() => layout(t.table, 98))
  // A review measured 2.3 s for this with every candidate width wrapped; render runs on the terminal's thread.
  expect(took / unit).toBeLessThan(BUDGET_UNITS)
})

test('escape sequences in a cell are dropped, never sent to the terminal', async $ => {
  const ui = await $.ui.mount(message('| A |\n|---|\n| \u001b[31mred\u001b[0m \u0007|', 100))
  expect(await tableLines(ui)).toEqual(['A', '───', 'red'])
})

test('a tab in a cell is spaces the widths count, never a tab the terminal draws to its next stop', async $ => {
  const ui = await $.ui.mount(message('| A | B |\n|---|---|\n| x\ty | z |', 100))
  expect(await tableLines(ui)).toEqual(['A    B', '──────', 'x y  z'])
})

test('a table under a list item stays under it, and so does the text after it', async $ => {
  const nested = `- **Merged:**\n\n  | PR | Lines |\n  | --- | --- |\n  | #54 | +80 |\n\n  Nothing deploys.\n- **Open:** none`
  const ui = await $.ui.mount(message(nested, 100))
  const boxes = (await ui.findAll({ type: 'Box' })).map(b => b.props?.marginLeft)
  expect(boxes.filter(m => m === 2)).toHaveLength(2) // the table and "Nothing deploys."
  expect((await ui.findAll({ type: 'Markdown' })).map(m => m.props?.text)).toEqual(['- **Merged:**', 'Nothing deploys.', '- **Open:** none'])
})

test('markdown edge cases: code keeps its spaces; a pipe right after a table and fenced text stay the engine\'s', async ($, on) => {
  engine(on)
  const code = await $.ui.mount(message('| Run |\n|---|\n| `printf "a  b"` |', 100))
  expect(await tableLines(code)).toContain('printf "a  b"')
  const fenced = await $.ui.mount(message('```\n``` not a close\n| A |\n|---|\n| 1 |\n```', 100))
  expect(await fenced.find({ type: 'Text', text: 'engine' })).toBeDefined()
  for (const after of ['deploy | failed', '>Run `a | b | c`', '  - Run `a | b | c`']) {
    const unsure = await $.ui.mount(message(`| Step | State |\n|---|---|\n| ok | yes |\n${after}`, 100))
    expect(await unsure.find({ type: 'Text', text: 'engine' })).toBeDefined()
  }
  const empty = await $.ui.mount(message('| Step | State |\n|---|---|', 40))
  expect(await tableLines(empty)).toContain('Step  State')
})

test('a link in a table cell or the verdict is drawn as a link; the table and the badge stay', async ($, on) => {
  // The owner, 2026-10-27: /progress rows and `Not done:` lines with a link fell back to the engine's drawing.
  engine(on)
  const href = 'https://github.com/x/y/pull/77'
  const linked = await $.ui.mount(message(`| State | Step |\n|---|---|\n| Done | Merge [#77](${href}) |`, 100))
  expect(await linked.find({ type: 'Text', text: 'engine' })).toBeUndefined()
  expect((await tableLines(linked))[2]).toMatch(/^✓\u00a0Done  Merge /)
  expect((await linked.find({ type: 'Link' }))?.props).toMatchObject({ href })
  const lead = await $.ui.mount(message(`Not done: CI is red, see [the run](${href}).`, 100))
  expect(await lead.find({ type: 'Text', text: 'Not done:' })).toBeDefined()
  expect((await lead.find({ type: 'Link' }))?.props).toMatchObject({ href })
  const needs = await $.ui.mount(message(`🔴 **Needs you:** see [the plan](${href})`, 100))
  expect(await needs.find({ type: 'Text', text: 'Needs you' })).toBeDefined()
  // A label of several words is one link, the spaces between its words included.
  const words = await $.ui.mount(message(`| State | Step |\n|---|---|\n| Done | See [the big run](${href}) |`, 100))
  expect((await words.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(Array(5).fill(href))
  // An autolink is a link too, drawn without its angle brackets.
  const auto = await $.ui.mount(message(`| State | Step |\n|---|---|\n| Done | <${href}> |`, 100))
  expect((await tableLines(auto))[2]).toMatch(/^✓\u00a0Done  https:[^<>]+$/)
  expect((await auto.find({ type: 'Link' }))?.props).toMatchObject({ href })
  const wiki = 'https://en.wikipedia.org/wiki/Foo_(bar)'
  const parens = await $.ui.mount(message(`| State | Step |\n|---|---|\n| Done | [Foo](${wiki} "t") |`, 100))
  expect((await parens.find({ type: 'Link' }))?.props).toMatchObject({ href: wiki })
})

test('an image or a link the mod cannot read leaves its table to the engine, never shown as raw marks', async ($, on) => {
  engine(on)
  for (const cell of ['![chart](a.png)', '[x](<a b>)', '[[draft] PR](u)']) {
    const ui = await $.ui.mount(message(`| State | Step |\n|---|---|\n| Done | ${cell} |`, 100))
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  }
})

test('a first column headed State or Who shows its words in their colors, as any other column does', async ($, on) => {
  // The owner, 2026-10-27: /progress and /demo tables open with State, and their states stayed plain.
  engine(on)
  const ui = await $.ui.mount(message('| State | Step |\n|---|---|\n| Running | Review |\n| Blocked | Deploy |', 100))
  const color = async (text: string) => (await ui.findAll({ type: 'Text', text: new RegExp(`^${text}$`) })).map(t => t.props.color)
  expect(await color('◐\u00a0Running')).toEqual(['claude'])
  expect(await color('✗\u00a0Blocked')).toEqual(['error'])
  const label = await $.ui.mount(message('| Step | State |\n|---|---|\n| Done | Running |', 100))
  expect(await tableLines(label)).toContain('Done  ◐\u00a0Running') // a row label stays as written
})

test('widths count what the terminal draws: a grapheme, and two cells for pictographs, flags and wide letters', () => {
  // wcwidth's answers, as the terminal draws them.
  expect(['é', '👍🏽', '🇨🇭', '🧑‍💻', '𠀀', '漢', '✓', '⚠️'].map(cells)).toEqual([1, 2, 2, 2, 2, 2, 1, 2])
})

test('a table ends at the next block; under an ordered item or beside a reference link, the engine keeps it', async ($, on) => {
  engine(on)
  const list = await $.ui.mount(message('| A | B |\n|---|---|\n| 1 | 2 |\n- Run the tests', 100))
  expect(await tableLines(list)).toEqual(['A   B', '─────', '1   2'])
  expect((await list.findAll({ type: 'Markdown' })).map(m => m.props?.text)).toEqual(['- Run the tests'])
  const ordered = await $.ui.mount(message('1. Merged:\n   | A |\n   |---|\n   | 1 |\n1. Next', 100))
  expect(await ordered.find({ type: 'Text', text: 'engine' })).toBeDefined()
  // A table under an item, then one at the top that the engine keeps: each keeps its own indent.
  const both = '- Merged:\n   | A |\n   |---|\n   | 1 |\n\n| Flag | Does |\n|---|---|\n| --dry-run | Preview |\n- Run `a | b`'
  const mixed = await $.ui.mount(message(both, 100))
  expect((await mixed.findAll({ type: 'Markdown' })).map(m => m.props?.text)).toContain('| Flag | Does |\n|---|---|\n| --dry-run | Preview |\n- Run `a | b`')
  const reference = await $.ui.mount(message('| A |\n|---|\n| [x][r] |\n\n[r]: https://example.com', 100))
  expect(await reference.find({ type: 'Text', text: 'engine' })).toBeDefined()
})

// Last: the measured column stays for the rest of the module's life.
test('tables follow the transcript column the band measures, narrower than the terminal', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  const band = { plugin: 'agent-tooling', component: 'AbovePrompt', surface: 'terminal' } as const
  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 46, scroll: { offset: 0, bodyRows: 10 }, view: {} }
  await $.ui.mount({ ...band, viewport: { columns: 200, rows: 50, isFullscreen: true }, props })
  await clock.settle()
  const docked = await $.ui.mount(message(STRANDS, 200))
  const lines = await tableLines(docked)
  expect(Math.max(...lines.map(cells))).toBe(49) // the band's 46 and its 5 marks, less the bullet column
  expect(lines[2]).toBe('A reply   render/blocks.ts,    330   fixtures')
  // Its rows wrap, a rule apart, unshaded.
  expect(lines.findIndex(l => l.startsWith('B charts'))).toBe(lines.findLastIndex(l => /^─+$/.test(l)) + 1)
  expect((await docked.findAll({ type: 'Text' })).some(t => t.props?.backgroundColor)).toBe(false)
})
