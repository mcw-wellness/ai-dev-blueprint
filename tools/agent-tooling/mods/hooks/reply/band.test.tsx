import { expect, test } from 'claude-code/testing'
import type { FoundElement } from 'claude-code/testing'

import { fit, pack } from './band'
import { BAND, answered, words } from '../fixtures/band'
import { needsYou } from './parse'
import { GRANT } from '../fixtures/grant'
import { BOLD_RED, NUMBERED, QUALIFIED, QUOTA } from '../fixtures/blocks'

test('a point without a bold lead is its first clause, the same at every width; a long point is cut at a clause', () => {
  expect(needsYou(QUOTA)[0]?.title).toBe('If you want the 512 limit…')
  const long = 'G-7: in site permissions (Slack, Notion), block app.slack.com and www.notion.so, or accept the risk'
  expect(fit(long, 30)).toBe('G-7: in site permissions…')
  // Never inside brackets: the cut leaves `(Slack, Notion)` whole.
  expect(fit(long, 82)).toBe('G-7: in site permissions (Slack, Notion), block app.slack.com and www.notion.so…')
  expect(fit(long, 200)).toBe(long)
})

test('explain stays with the last reply where the two fit a line; it never pushes a line past the band', () => {
  // Two replies and explain in 20 cells: explain alone on a line would read as a reply of its own.
  expect(pack([10, 8, 7], 20).starts).toEqual([0, 1])
  // A 40-cell reply and explain do not fit 45 cells together: explain takes a line of its own.
  expect(pack([44, 7], 49)).toEqual({ starts: [0, 1], width: 44 })
})

test('a row reads number, point, replies; no chip has a hotkey, which a digit typed into an empty prompt would press', async ($, on) => {
  await answered($, on, BOLD_RED)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 195 } })

  const row = await ui.find({ key: 'd3' })
  // One line left to right: number, a grant's badge, point, then its replies, ★ first.
  expect(row?.text).toBe(' 3   Your go  Restructure the skills (14 to 9, flat skills/)?★ go skillsnoexplaindismiss')
  const [point, replies] = (row?.children ?? []) as FoundElement[]
  expect(replies?.props).toMatchObject({ flexShrink: 0 })
  // Rows look alike: every point as wide as the widest, so every row's replies start at one column.
  const points = await Promise.all([1, 2, 3, 4].map(async n => ((await ui.find({ key: `d${n}` }))?.children as FoundElement[])[0]?.props))
  expect(points).toEqual(Array(4).fill(point?.props))
  expect(point?.props).toEqual({ width: 86, flexShrink: 0 })
  expect((replies?.children as FoundElement[]).map(words)).toEqual(['★ go skills', 'no', 'explain', 'dismiss'])
  const buttons = await Promise.all(['d3:go skills', 'd3:no', 'd1:drop Closable', 'd2:accept G-7'].map(key => ui.find({ key })))
  expect(buttons.map(b => [b?.props.hotkey, b?.props.plain])).toEqual(Array(4).fill([undefined, undefined]))
  await ui.unmount()
  // Where one row's replies do not fit beside it, every row's go under its point.
  const narrow = await $.ui.mount(BAND)
  const shapes = await Promise.all([1, 2, 3, 4].map(async n => (await narrow.find({ key: `d${n}` }))?.props.flexDirection))
  expect(shapes).toEqual(Array(4).fill('column'))
  await narrow.unmount()
})

test('replies never run past the band: too wide beside the point, they wrap on lines under it', async ($, on) => {
  await answered($, on, QUALIFIED)
  for (const bodyColumns of [55, 95, 195]) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns } })
    for (const n of [1, 2, 3]) {
      const row = (await ui.find({ key: `d${n}` }))!
      const lines = (row.children as FoundElement[]).filter(c => String(c.props.key).startsWith(`d${n}:replies`))
      const labels = lines.map(l => (l.children as FoundElement[]).map(words))
      // A chip is `[ label ]`, explain and dismiss their bare labels; one cell between them; beside the point, its number before them.
      const wide = labels.map(l => l.reduce((w, label) => w + label.length + (['explain', 'dismiss'].includes(label) ? 0 : 4), l.length - 1))
      // Its left edge two cells in, in line with the reply's body.
      const lead = 2 + (row.props.flexDirection === 'column' ? 4 : 5)
      expect(Math.max(...wide) + lead).toBeLessThanOrEqual(bodyColumns)
      expect(labels.flat()).toHaveLength(needsYou(QUALIFIED)[n - 1]!.options.length + 2)
    }
    await ui.unmount()
  }
})

test('the band sits under a faint rule, in line with the reply body; its label is the crimson words, no second 🔴', async ($, on) => {
  await answered($, on, BOLD_RED)
  const ui = await $.ui.mount(BAND)
  const band = await ui.find({ type: 'Box' })
  expect(band?.props).toMatchObject({ flexDirection: 'column', paddingLeft: 2 })
  expect(band?.children?.[0]).toMatchObject({ type: 'Text', props: { color: 'subtle' }, children: ['─'.repeat(98)] })
  expect(band?.children?.[1]).toMatchObject({ props: { key: 'head' } })
  expect(await ui.find({ type: 'Text', text: /🔴/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Needs you$/ }))?.props).toMatchObject({ color: 'error', bold: true })
  // The recommended reply is green, bold and starred; the others on the theme's selection tint, in light and dark.
  const chips = await Promise.all(['d3:go skills', 'd3:no'].map(key => ui.find({ key })))
  expect(chips.map(c => (c?.children as FoundElement[])[0]?.props)).toEqual([
    expect.objectContaining({ color: 'text', backgroundColor: 'diffAddedDimmed', bold: true }),
    expect.objectContaining({ color: 'text', backgroundColor: 'userMessageBackground', bold: false }),
  ])
  await ui.unmount()
})

test('the hint gives up whole segments from the right, never part of one', async ($, on) => {
  const clock = await answered($, on, NUMBERED)
  await clock.advance(14 * 60_000)
  const full = '3 decisions · oldest 14m · Tab takes the answer'
  const shown: string[] = []
  for (const bodyColumns of [60, 75, 200]) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns } })
    const said = String((await ui.find({ type: 'Text', text: /^\s+3 decisions/ }))?.text).trim()
    expect(`${full} · `.startsWith(`${said} · `)).toBe(true)
    shown.push(said)
    await ui.unmount()
  }
  expect(shown).toEqual(['3 decisions · oldest 14m', '3 decisions · oldest 14m', full])
})

test('off fullscreen, where no click reaches the band, the chord that hides it stands in for hide, at any width', async ($, on) => {
  await answered($, on, NUMBERED)
  const shown: [boolean, boolean][] = []
  for (const [isFullscreen, bodyColumns] of [[false, 200], [false, 55], [true, 200]] as const) {
    const viewport = { columns: bodyColumns + 2, rows: 50, isFullscreen }
    const ui = await $.ui.mount({ ...BAND, viewport, props: { ...BAND.props, bodyColumns } })
    const chord = (await ui.find({ type: 'Text', text: 'ctrl+x ctrl+a hides' })) !== undefined
    shown.push([chord, (await ui.find({ type: 'Button', key: 'dismiss' })) !== undefined])
    await ui.unmount()
  }
  expect(shown).toEqual([
    [true, false],
    [true, false],
    [false, true],
  ])
})

test('a decision offering a grant wears a warning ` Your go ` badge before its point, and no ghost text offers it', async ($, on) => {
  const suggested: string[] = []
  await (await answered($, on, GRANT, suggested)).advance(250)
  const ui = await $.ui.mount(BAND)
  expect(suggested.at(-1)).toBe('re 🔴3: merge #1035 first; Kei redoes #1034')
  // One recommended reply is no grant: `★ all` would pick it alone, so it is not offered.
  expect(await ui.find({ key: 'all' })).toBeUndefined()
  const point = async (key: string) => ((await ui.find({ key }))?.children as FoundElement[] | undefined)?.[0]
  const go = (await ui.findAll({ type: 'Text', text: ' Your go ' })).filter(t => t.props.color === 'warning')
  expect(go.map(t => t.props)).toEqual([{ color: 'warning', bold: true }])
  expect(words((await point('d2'))!)).toContain(' Your go  Stop native-d5')
  expect(words((await point('d3'))!)).not.toContain('Your go')
  await ui.unmount()
})
