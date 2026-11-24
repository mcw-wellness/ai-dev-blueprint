// The Reply band: the latest reply's decisions and drafts as rows above the prompt, its ghost text and `re:` quotes.
// What it answers lives in state.ts, its buttons in chip.tsx.
import type { On } from 'claude-code'

import type { Decision } from '../../types'
import { chip, copyChip, label, openChip, replyChip } from './chip'
import { drafts, firstLine } from './draft'
import { grant, quotable } from './parse'
import { current, drop, failed, ghost, open, pick, putAway, recommended, send } from './state'
import { shownIn } from './view'
import { cells, dur } from '../transcript/blocks'

const QUOTE_MAX = 400

// The one way to give the owner a button (owner, 2026-10-27): fixed text, so it stays cached.
export const BUTTONS = {
  id: 'agent-tooling:buttons',
  text: 'Buttons: every choice you offer the owner goes in a `🔴 **Needs you:**` block with each reply quoted (`"5 shares" (recommended) or "1 share"`), your recommended one always followed by `(recommended)` (a grant\'s reply names it, `go: restart live hype_fade`, and a press of it is the owner\'s go), which the terminal draws as reply buttons, the recommended one green with a star; every message he sends to other people (Slack, email, #updates) goes whole in a ```draft fence as the Markdown it should paste as, which gets a copy button, but a reply to you is never a draft: quote it inline as above; a page or link to open goes in a code span `! open <path or URL>`, which gets an open button. The band keeps a block open until the owner answers it, so a later reply carries one only when an ask is new or changed, never the same block again (owner, 2026-10-29).',
  scope: 'session',
} as const

/** How long ago a decision was first asked, in whole minutes (`14m`, `2h05`); nothing under a minute. */
const age = (ms: number): string => (ms < 60_000 ? '' : dur(Math.floor(ms / 60_000)))

// The band's left edge, in line with the reply's body; replies under their point start below its text.
const PAD = 2
const INDENT = 4

/** Cells each of a row's replies takes: `[ label ]` chips, then the bare `explain`. */
const widths = (d: Decision, picks: ReadonlyMap<number, string>): number[] => [
  ...ordered(d).map(o => cells(label({ chip: o, recommended: o === d.recommended }, picks.get(d.n) === o)) + 4),
  ...(d.opens ?? []).map(() => cells('open') + 4),
  cells('explain'),
  cells('dismiss'),
]

/**
 * Chips of these widths, one cell apart, packed into lines of at most `room` cells: where each line starts, and the
 * widest. The last stays with the one before it where the two fit a line, so `explain` never sits alone on one.
 */
export function pack(widths: readonly number[], room: number): { starts: number[]; width: number } {
  const starts = [0]
  let used = 0
  let width = 0
  const last = widths.length - 1
  const glue = last > 0 && widths[last - 1]! + 1 + widths[last]! <= room
  widths.forEach((w, i) => {
    const need = glue && i === last - 1 ? w + 1 + widths[last]! : w
    if (used && !(glue && i === last) && used + 1 + need > room) {
      starts.push(i)
      used = 0
    }
    used += (used ? 1 : 0) + w
    width = Math.max(width, used)
  })
  return { starts, width }
}

/**
 * A point in `room` cells: whole where it fits, else cut after its last clause outside brackets and quotes that fits
 * (or after a word, where that clause would leave most of the room empty), with an ellipsis. The whole is one line up.
 */
export function fit(text: string, room: number): string {
  if (cells(text) <= room) return text
  const clauses: number[] = []
  const spaces: number[] = []
  let depth = 0
  let quoted = false
  ;[...text].forEach((ch, i, all) => {
    if (ch === '"') quoted = !quoted
    if (ch === '(') depth += 1
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch !== ' ') return
    spaces.push(i)
    if (!depth && !quoted && (/[,;:]/.test(all[i - 1] ?? '') || /[(—–]/.test(all[i + 1] ?? ''))) clauses.push(i)
  })
  const fitting = (ends: number[]) => ends.findLast(end => cells(text.slice(0, end)) + 1 <= room)
  const clause = fitting(clauses)
  const word = fitting(spaces)
  const end = clause !== undefined && cells(text.slice(0, clause)) * 2 >= room ? clause : word
  return end === undefined ? text : `${[...text].slice(0, end).join('').replace(/[,;:]$/, '')}…`
}

/** The leading hint segments that fit in `room` cells, after the label's two-cell gap: whole segments, never cut. */
export function hint(segments: readonly string[], room: number): string {
  let n = segments.length
  while (n && cells(`  ${segments.slice(0, n).join(' · ')}`) > room) n -= 1
  return n ? `  ${segments.slice(0, n).join(' · ')}` : ''
}

/** A row's options, its ★ first: the one its number answers. */
function ordered(d: Decision): string[] {
  return d.recommended ? [d.recommended, ...d.options.filter(o => o !== d.recommended)] : [...d.options]
}

/** A quote cut at a word near `QUOTE_MAX`, so the prompt stays readable. */
function cut(text: string): string {
  if (text.length <= QUOTE_MAX) return text
  return `${text.slice(0, text.lastIndexOf(' ', QUOTE_MAX))}…`
}

// The badge before the point of a decision offering a grant, as the transcript draws it (owner, 2026-10-27).
const GO = ' Your go '

/** Answers a `🔴 Needs you` block in one click: decisions as chips above the prompt, the recommended reply as ghost text, `re:` quotes; copies a draft. */
export function reply(on: On): void {
  // The engine's own guess gives way to the recommended replies while a block is open.
  on('prompt.suggest', { origin: { kind: 'suggestion' } }, async ($, e, next) => {
    const text = await ghost($)
    return next(text ? { ...e, text } : e)
  }).catch(($, e, next) => next(e))

  // `re:` lists the last message's paragraphs and bullets; `re:word` narrows them; taking one inserts the quote.
  on('prompt.autocomplete', { token: /^re:/i }, async ($, e, next) => {
    const below = await next(e)
    const a = await current($)
    if (!a) return below
    const want = e.token.slice(3).toLowerCase()
    const mine = quotable(a.answer)
      .filter(q => q.toLowerCase().includes(want))
      .map(q => {
        const words = q.split(' ')
        return { text: `re "${cut(q)}" `, label: words.slice(0, 6).join(' '), description: words.slice(6).join(' ') }
      })
    return { suggestions: [...mine, ...below.suggestions] }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const a = await current($)
    // The drafts the reply asks the owner to send: a row each after the decisions, its number copying it.
    const drafted = a && !a.dismissed ? drafts(a.block).flatMap(({ body }, i) => (a.dropped.includes(`draft${i + 1}`) ? [] : [{ body, key: `draft${i + 1}` }])) : []
    const decisions = a ? open(a) : []
    if (e.props.hasSurvey || e.props.view.agentId || !a || a.dismissed || !(decisions.length + drafted.length)) return next(e)
    const el = $.ui.resolve(e)
    const { Box, Button, Text } = el
    const now = await $.clock.now()
    const quiet = e.props.isWorking
    // While the reply shows its block (or its drafts) on screen, the band is its header alone: no row repeats it.
    const view = e.viewport?.isFullscreen === false ? undefined : shownIn(a.block)
    const all = recommended(decisions)
    const oldest = Math.min(...decisions.map(d => d.askedAt ?? now))
    const room = e.props.bodyColumns - PAD
    const takeAll = all && decisions.filter(d => d.recommended && !grant(d.recommended) && !a.picks.some(([n]) => n === d.n)).length > 1
    const picks = new Map(a.picks)
    // Some decisions picked, others open: `send` sends what is picked now.
    const sendLabel = `send ${picks.size} of ${decisions.filter(d => d.options.length).length}`
    // Off fullscreen the terminal reports no clicks: `hide` and the engine's `[-]` cannot be pressed, its chord can.
    const hide = e.viewport?.isFullscreen === false ? 'ctrl+x ctrl+a hides' : 'hide'
    // The controls after the hint: `[ send n of m ]`, `[ ★ all ]` and a plain `hide`, a cell apart and two from the hint.
    const controls = (picks.size ? cells(sendLabel) + 5 : 0) + (takeAll ? cells('★ all') + 5 : 0) + cells(hide) + 2
    const count = (n: number, one: string) => (n ? [`${n} ${one}${n === 1 ? '' : 's'}`] : [])
    const segments = [
      ...count(decisions.length, 'decision'),
      ...count(drafted.length, 'draft'),
      ...(age(now - oldest) ? [`oldest ${age(now - oldest)}`] : []),
      ...(quiet ? ['working'] : []),
      ...(all || a.picks.length ? ['Tab takes the answer'] : []),
      ...(a.picks.length ? ['a second press takes a pick back'] : []),
    ]

    const header = (
      <Box key="head" columnGap={2}>
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color="error" bold>
              Needs you
            </Text>
            <Text dimColor>{hint(segments, room - cells('Needs you') - controls)}</Text>
          </Text>
        </Box>
        <Box flexShrink={0} columnGap={1}>
          {picks.size > 0 && chip(el, 'send', sendLabel, 'picked', () => void send($))}
          {takeAll &&
            chip(el, 'all', '★ all', 'recommended', () => void pick($, decisions.flatMap(d => (d.recommended && !grant(d.recommended) ? [[d.n, d.recommended] as [number, string]] : [])), true))}
          {hide === 'hide' ? (
            <Button
              key="dismiss"
              label="hide"
              plain
              dimColor
              role="dismiss"
              onPress={() => void putAway($)}
            />
          ) : (
            <Text key="dismiss" dimColor>
              {hide}
            </Text>
          )}
        </Box>
      </Box>
    )

    // A row reads number, point, replies. Replies are `[ chips ]` without a digit label, which would read as a decision
    // number. Rows look alike: where every row fits one line, the replies
    // start at one column; else every row's replies go on lines of their own under its point, wrapped at the band's
    // width, never past its edge. A point is one line, cut at a clause where it must be.
    const dismiss = (key: string) => <Button key={`${key}:dismiss`} label="dismiss" plain dimColor onPress={() => void drop($, key)} />
    const chips = (d: Decision) => [
      ...ordered(d).map(o =>
        replyChip(el, $, { chip: o, n: d.n, title: d.title, recommended: o === d.recommended }, `d${d.n}:${o}`, undefined, picks.get(d.n) === o),
      ),
      ...(d.opens ?? []).map((t, i) => openChip(el, `d${d.n}:open${i}`, t, $)),
      <Button
        key={`d${d.n}:explain`}
        label="explain"
        plain
        dimColor
        onPress={() => {
          void $.prompt.submit({
            text: `Explain 🔴${d.n} ("${d.title}") in plain words: what it does, what it changes for me, and what you recommend. Answer only; change nothing.`,
            asUser: true,
          }).catch(failed($, 'Not sent'))
        }}
      />,
      dismiss(`d${d.n}`),
    ]
    const asks = decisions.map(d => {
      const ago = d.askedAt !== undefined ? age(now - d.askedAt) : ''
      return { key: `d${d.n}`, n: d.n, title: d.title, badge: 'error', go: d.options.some(grant), ago, widths: widths(d, picks), chips: chips(d) }
    })
    // A draft's row: its number and first line in the copy color, one chip that copies it and never touches the prompt.
    const sends = (view?.drafts ? [] : drafted).map(({ body, key }, i) => {
      // Numbered after every decision asked, dismissed ones too, so a draft's digit never takes a decision's.
      const n = a.decisions.length + i + 1
      const copy = copyChip(el, `${key}:copy`, body, $)
      return { key, n, title: `Draft: ${firstLine(body)}`, badge: 'suggestion', go: false, ago: '', widths: [cells('copy') + 4, cells('dismiss')], chips: [copy, dismiss(key)] }
    })
    const rows = [...(view?.needs ? [] : asks), ...sends].map(r => ({ ...r, lines: pack(r.widths, room - INDENT), lead: cells(` ${r.n}  `) + cells(r.go ? `${GO} ` : '') + cells(r.ago && `  ${r.ago}`) }))
    const column = Math.max(...rows.map(r => r.lead + cells(r.title)))
    const beside = rows.every(r => r.lines.starts.length === 1 && column + 1 + r.lines.width <= room)
    const drawn = rows.map(({ key, n, title, badge, go, ago, chips, lines, lead }) => {
      const point = (
        <Box {...(beside ? { width: column, flexShrink: 0 } : { flexShrink: 1 })}>
          <Text wrap="truncate-end" dimColor={quiet}>
            <Text color={badge} bold>
              {` ${n} `}
            </Text>{' '}
            {go && [
              <Text key="go" color="warning" bold>
                {GO}
              </Text>,
              ' ',
            ]}
            {[beside ? title : fit(title, room - lead), ago && <Text key="ago" dimColor>{`  ${ago}`}</Text>]}
          </Text>
        </Box>
      )
      if (beside)
        return (
          <Box key={key} columnGap={1}>
            {point}
            <Box key={`${key}:replies`} flexShrink={0} columnGap={1}>
              {chips}
            </Box>
          </Box>
        )
      return (
        <Box key={key} flexDirection="column">
          {point}
          {lines.starts.map((from, k) => (
            <Box key={`${key}:replies${k}`} paddingLeft={INDENT} columnGap={1}>
              {chips.slice(from, lines.starts[k + 1])}
            </Box>
          ))}
        </Box>
      )
    })

    // A faint rule parts the band from the reply above it; the engine's `[-]` ends it.
    return (
      <Box flexDirection="column" paddingLeft={PAD}>
        <Text color="subtle">
          {'─'.repeat(room)}
        </Text>
        {header}
        {drawn}
      </Box>
    )
  })
}
