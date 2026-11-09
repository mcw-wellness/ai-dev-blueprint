// A markdown table laid out to a width: no borders, a bold header over a muted rule, two-space gutters (three after figures flush right), numbers
// flush right, a muted rule between rows so the eye keeps its row (owner, 2026-10-27). Too narrow for its columns, each row
// becomes its first cell over indented `Header  value` lines, the same rule between rows.

import type { Span, Table } from './blocks'
import { ROLES, cells, graphemes, plain } from './blocks'

type Line = Span[]

const GAP = 2
const RULE_COLOR = 'subtle'
// Column names in labeled rows: quieter than the values, darker than the rule.
const LABEL_COLOR = 'inactive'
// A text column wraps no narrower than this, unless it is that narrow already.
const MIN_COLUMN = 12
// A table wraps at this width however wide the transcript: wider, the eye loses its row (lead, 2026-10-26).
export const WIDEST = 110

// A cell opening with a state word or naming the owner shows that word in its role's color, so a State or Who column
// reads at a glance; every other `you` is marked as the owner's word too; a lone dash recedes.
const STATE = new RegExp(`^(${Object.keys(ROLES).sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}\\p{N}])`, 'u')

/** Every `you` (not `your`, `you'd`) bold in the owner's color, as a cell-leading `You` is: what needs him, found at a glance. */
function you(cell: Span[]): Span[] {
  return cell.flatMap(s =>
    s.code || s.color
      ? [s]
      : s.text
          .split(/(?<![\p{L}\p{N}])(you)(?![\p{L}\p{N}'’])/iu)
          .map((text, k) => (k % 2 ? { ...s, text, color: 'merged', bold: true } : { ...s, text }))
          .filter(p => p.text),
  )
}

// A glyph before each state word, so a state reads by shape as well as hue (owner, 2026-10-27); the owner's You has none.
const ICONS: Record<string, string> = { success: '✓', claude: '◐', error: '✗', inactive: '○' }

function tint(cell: Span[]): Span[] {
  const [first, ...rest] = cell
  if (!first || first.code || first.color) return cell
  if (!rest.length && /^[—–-]$/.test(first.text.trim())) return [{ ...first, color: 'inactive' }]
  // Matched on the cell's text, so `**Down**stream` is no state; colored only when the word lies in the first span.
  const word = STATE.exec(cell.map(c => c.text).join(''))?.[1]
  if (!word || word.length > first.text.length) return cell
  const tail = first.text.slice(word.length)
  // The owner's word, the rarest and the one he acts on, is bold as well.
  const owner = ROLES[word] === 'merged' ? { bold: true } : {}
  const icon = ICONS[ROLES[word]!]
  // A no-break space: the glyph never wraps away from its word.
  const text = icon ? `${icon}\u00a0${word}` : word
  return [{ ...first, text, color: ROLES[word], ...owner }, ...(tail ? [{ ...first, text: tail }] : []), ...rest]
}

const width = (spans: Span[]): number => spans.reduce((n, s) => n + cells(s.text), 0)

/** Spans cut into words, each word keeping its spans' styles; a space separates words. */
function words(spans: Span[]): Span[][] {
  const out: Span[][] = [[]]
  for (const s of spans) {
    const parts = s.code ? [s.text] : s.text.split(/( +)/)
    parts.forEach(part => {
      if (/^ +$/.test(part)) out.push([])
      else if (part) out[out.length - 1]!.push({ ...s, text: part })
    })
  }
  // An arrow joins the word after it, so no line ends on one (`main thread` over `↔ core`).
  return out
    .filter(w => w.length > 0)
    .reduce<Span[][]>((ws, w) => {
      const prev = ws.at(-1)
      if (prev && /^[↔→←⇄⇒]$/.test(plain(prev))) ws[ws.length - 1] = [...prev, { ...prev[0]!, text: ' ' }, ...w]
      else ws.push(w)
      return ws
    }, [])
}

/** A word wider than `max` broken into pieces of at most `max` cells. */
function chop(word: Span[], max: number): Span[][] {
  const out: Span[][] = [[]]
  let n = 0
  for (const s of word) {
    let text = ''
    for (const c of graphemes(s.text)) {
      if (n + cells(c) > max && n > 0) {
        if (text) out[out.length - 1]!.push({ ...s, text })
        out.push([])
        text = ''
        n = 0
      }
      text += c
      n += cells(c)
    }
    if (text) out[out.length - 1]!.push({ ...s, text })
  }
  return out
}

/** The space between two words, inside their link when both are one link's. */
const space = (a: Span, b: Span): Span => (a.href && a.href === b.href ? { text: ' ', href: a.href } : { text: ' ' })

/** Spans wrapped at word boundaries into lines of at most `max` cells, the first at most `first`. */
export function wrap(spans: Span[], max: number, first = max): Line[] {
  const lines: Line[] = []
  let line: Line = []
  for (const word of words(spans).flatMap(w => (width(w) > max ? chop(w, max) : [w]))) {
    // A first word too wide for the first line starts on the next one.
    if (!line.length && !lines.length && width(word) > first) lines.push([])
    if (line.length && width(line) + 1 + width(word) > (lines.length ? max : first)) {
      lines.push(line)
      line = []
    }
    if (line.length) line.push(space(line.at(-1)!, word[0]!))
    line.push(...word)
  }
  if (line.length || !lines.length) lines.push(line)
  return lines
}

/** A cell's figure and the note after it: its first word and the rest. */
function split(cell: Span[]): [Span[], Span[]] {
  const all = words(cell)
  // A sign set apart (`~ 200`) belongs to its figure.
  const n = all.length > 1 && /^[~≈<>≤≥+\-−±]$/.test(plain(all[0]!)) ? 2 : 1
  const join = (ws: Span[][]) => ws.flatMap((w, k) => (k ? [space(ws[k - 1]!.at(-1)!, w[0]!), ...w] : w))
  return [join(all.slice(0, n)), join(all.slice(n))]
}

/** Per column, the cells its figure lane takes: the widest leading figure in a `figure` column, else none. */
const lanes = (t: Table): number[] => t.align.map((a, i) => (a === 'figure' ? Math.max(0, ...t.rows.map(r => width(split(r[i]!)[0]))) : 0))

/** The cells between column `i` and the one before it: one more after figures flush right, so `14   206` reads as two. */
const gutter = (t: Table, i: number): number => (i === 0 ? 0 : t.align[i - 1] === 'right' ? GAP + 1 : GAP)
const gutters = (t: Table): number => t.header.reduce((g, _, i) => g + gutter(t, i), 0)

/** A cell's lines at `w` cells; with a figure lane, its figure flush right in the lane, its note after it and on under it. */
function cellLines(cell: Span[], w: number, lane: number): Line[] {
  if (!lane) return wrap(cell, w)
  const [figure, note] = split(cell)
  const head = pad(figure, lane, true)
  if (!note.length) return [head]
  return wrap(note, w, w - lane - 1).map((l, k) => (k ? l : [...head, { text: ' ' }, ...l]))
}

/** What laying a cell out costs: the cells its figure lane takes before its first line's words, and each word's width. */
type Measure = { before: number; words: number[] }

function measure(cell: Span[], lane: number): Measure {
  if (!lane) return { before: 0, words: words(cell).map(width) }
  const note = words(split(cell)[1]).map(width)
  return { before: note.length ? lane + 1 : lane, words: note }
}

const unwrapped = (m: Measure): number => m.before + m.words.reduce((a, b) => a + b, 0) + Math.max(0, m.words.length - 1)
const longest = (m: Measure): number => m.before + Math.max(0, ...m.words)

/** The lines `wrap` makes of the cell at `w` cells, counted from word widths alone. */
function count(m: Measure, w: number): number {
  let lines = 1
  let used = 0
  let room = w - m.before
  for (const x of m.words) {
    if (used && used + 1 + x > room) {
      lines += 1
      used = x
      room = w
    } else used += (used ? 1 : 0) + x
  }
  return lines
}

/**
 * Column widths that fit `room`, or null when not even every column at its floor does: its longest word, and at least
 * `MIN_COLUMN` unless it is narrower. Columns that fit keep their natural width, headers wrapping first; room left
 * over unwraps the headers. Too wide for that, every column starts at its floor and the room goes where it saves the
 * most lines: table lines first, cell lines breaking ties. Room no step can use goes to the columns still wrapping,
 * so a wrapping table leaves no room unused.
 */
export function columnWidths(t: Table, room: number): number[] | null {
  const lane = lanes(t)
  const all = [t.header, ...t.rows].map((r, k) => r.map((c, i) => measure(c, k ? lane[i]! : 0)))
  const sum = (w: number[]) => w.reduce((a, b) => a + b, 0)
  const whole = t.header.map((_, i) => Math.max(1, ...all.map(r => unwrapped(r[i]!))))
  if (sum(whole) + gutters(t) <= room) return whole
  // Wrapping, a table takes at most `WIDEST` cells, however wide the room.
  const avail = Math.min(room, WIDEST) - gutters(t)
  // Too wide: a header wider than its cells wraps before any cell does (`Size` over `(lines)`).
  const natural = whole.map((_, i) => Math.max(1, longest(all[0]![i]!), ...all.slice(1).map(r => unwrapped(r[i]!))))
  const floor = natural.map((w, i) => Math.max(Math.min(w, MIN_COLUMN), ...all.map(r => longest(r[i]!))))
  if (sum(floor) > avail) return null
  if (sum(natural) <= avail) return unwrapHeaders(natural)
  const widths = [...floor]
  // Each cell's lines per column width, counted once.
  const memo = new Map<number, number[]>()
  const lines = (i: number, w: number): number[] => {
    const key = i * 1024 + w
    if (!memo.has(key)) memo.set(key, all.map(r => count(r[i]!, w)))
    return memo.get(key)!
  }
  // Table lines first, cell lines after: `Who` wrapping to four lines beside a one-line `Step` costs three rows.
  const cost = (ws: readonly number[]) => {
    const each = ws.map((w, i) => lines(i, w))
    return all.reduce((c, _, r) => c + Math.max(...each.map(l => l[r]!)) * 1e6 + sum(each.map(l => l[r]!)), 0)
  }
  // A step widens one column to its next width that saves it a line, the step that lowers the cost most per cell first.
  for (;;) {
    const base = cost(widths)
    const spare = avail - sum(widths)
    let best: { i: number; to: number; gain: number } | undefined
    widths.forEach((w, i) => {
      const now = sum(lines(i, w))
      let to = w + 1
      while (to <= Math.min(whole[i]!, w + spare) && sum(lines(i, to)) >= now) to += 1
      if (to > Math.min(whole[i]!, w + spare)) return
      const gain = (base - cost(widths.map((x, k) => (k === i ? to : x)))) / (to - w)
      if (gain > (best?.gain ?? 0)) best = { i, to, gain }
    })
    if (!best) break
    widths[best.i] = best.to
  }
  // Then the widths of least cost: a depth-first search over each column's widths where one of its cells changes its
  // line count, the last column taking the room left; a branch is dropped once even its widest choices cost no less
  // than the best found, the steps above seeding it. A node budget bounds the time a frame spends.
  const steps = widths.map((_, i) => {
    const out = [floor[i]!]
    for (let w = floor[i]! + 1; w <= whole[i]!; w++) if (lines(i, w).some((l, r) => l !== lines(i, w - 1)[r])) out.push(w)
    return out
  })
  const after = (i: number) => sum(floor.slice(i + 1))
  let best = { ws: [...widths], cost: cost(widths) }
  let budget = 20_000
  const search = (ws: number[]): void => {
    const i = ws.length
    const left = avail - sum(ws)
    if (i === widths.length - 1) {
      const full = [...ws, Math.min(whole[i]!, left)]
      if (cost(full) < best.cost) best = { ws: full, cost: cost(full) }
      return
    }
    for (const w of steps[i]!) {
      if (w > left - after(i) || budget-- <= 0) return
      const rest = left - w
      const widest = floor.slice(i + 1).map((f, k) => Math.min(whole[i + 1 + k]!, rest - after(i) + f))
      if (cost([...ws, w, ...widest]) < best.cost) search([...ws, w])
    }
  }
  search([])
  widths.splice(0, widths.length, ...best.ws)
  // Room no step could use goes where most text still overflows, header and cells alike, a column taking no more than its widest cell.
  const over = (i: number) => all.reduce((o, r) => o + Math.max(0, unwrapped(r[i]!) - widths[i]!), 0)
  for (let open = widths.map((w, i) => w < whole[i]!); avail > sum(widths) && open.some(Boolean); ) {
    const weights = widths.map((_, i) => (open[i] ? over(i) || 1 : 0))
    const spare = avail - sum(widths)
    const grant = weights.map(w => Math.floor((w * spare) / sum(weights)))
    // Rounding's remainder goes to the widest overflow.
    grant[weights.indexOf(Math.max(...weights))]! += spare - sum(grant)
    widths.forEach((w, i) => (widths[i] = Math.min(whole[i]!, w + grant[i]!)))
    open = widths.map((w, i) => w < whole[i]!)
  }
  return widths

  /** Room the cells leave goes to wrapped headers, left to right: `After last cleanup` on one line, not three. */
  function unwrapHeaders(w: number[]): number[] {
    let left = avail - sum(w)
    return w.map((c, i) => {
      const grow = Math.max(0, Math.min(left, width(t.header[i]!) - c))
      left -= grow
      return c + grow
    })
  }
}

const pad = (line: Line, to: number, right: boolean): Line => {
  const fill = ' '.repeat(Math.max(0, to - width(line)))
  return fill ? (right ? [{ text: fill }, ...line] : [...line, { text: fill }]) : line
}

/** A row of cells side by side, each wrapped to its column; trailing spaces dropped. */
function row(cellSpans: Span[][], widths: number[], t: Table, lane: number[]): Line[] {
  const wrapped = cellSpans.map((c, i) => cellLines(c, widths[i]!, lane[i]!))
  const height = Math.max(...wrapped.map(w => w.length))
  return Array.from({ length: height }, (_, k) => {
    const line: Line = []
    wrapped.forEach((w, i) => {
      if (i > 0) line.push({ text: ' '.repeat(gutter(t, i)) })
      line.push(...pad(w[k] ?? [], widths[i]!, t.align[i] === 'right'))
    })
    return trimEnd(line)
  })
}

function trimEnd(line: Line): Line {
  const out = [...line]
  while (out.length && !out[out.length - 1]!.text.trim()) out.pop()
  if (out.length) out[out.length - 1] = { ...out[out.length - 1]!, text: out[out.length - 1]!.text.trimEnd() }
  return out
}

const bold = (spans: Span[]): Span[] => spans.map(s => ({ ...s, bold: true }))

/**
 * Each row as its first cell, styled as the source has it, over its other cells, each led by its header in a quieter
 * color: beside the value while the headers are short, else leading the value's first line, or above it when long.
 * A table without rows is its headers.
 */
function labeled(t: Table, room: number): Line[] {
  if (!t.rows.length) return t.header.flatMap(h => wrap(bold(h), room))
  const labels = t.header.slice(1).map(h => h.map(s => ({ ...s, color: LABEL_COLOR })))
  const labelWidth = Math.max(0, ...labels.map(width))
  const beside = labelWidth + GAP <= room * 0.3
  const out: Line[] = []
  const indent = (lines: Line[], by: string) => lines.map(l => [{ text: by }, ...l])
  for (const [k, r] of t.rows.entries()) {
    if (k) out.push([{ text: '─'.repeat(room), color: RULE_COLOR }])
    out.push(...wrap(r[0]!, room))
    r.slice(1).forEach((value, i) => {
      const label = labels[i]!
      if (!width(value)) return
      if (beside) {
        const lines = wrap(value, room - 2 - labelWidth - GAP)
        out.push(...lines.map((l, k) => [{ text: '  ' }, ...pad(k ? [] : label, labelWidth, false), { text: ' '.repeat(GAP) }, ...l]))
      } else if (width(label) + GAP <= (room - 2) / 2) {
        const lines = wrap(value, room - 4, room - 2 - width(label) - GAP)
        out.push([{ text: '  ' }, ...label, { text: ' '.repeat(GAP) }, ...lines[0]!], ...indent(lines.slice(1), '    '))
      } else out.push(...indent(wrap(label, room - 2), '  '), ...indent(wrap(value, room - 4), '    '))
    })
  }
  return out.map(trimEnd)
}

/** The table's lines at `room` cells, none wider: columns, or labeled rows when columns cannot fit or wrap to half again their height. */
export function layout(source: Table, room: number): Line[] {
  // The first column is the row's label, as written, unless it says the state or who acts (progress and demo tables).
  const first = /^(state|who)$/i.test(plain(source.header[0]!))
  const t = { ...source, rows: source.rows.map(r => r.map((c, i) => (i > 0 || first ? you(tint(c)) : c))) }
  const widths = columnWidths(t, room)
  const rows = labeled(t, Math.min(room, WIDEST))
  if (!widths) return rows
  const columns = grid(t, widths)
  return t.header.length > 1 && t.rows.length > 0 && columns.length > 1.5 * rows.length ? rows : columns
}

function grid(t: Table, widths: number[]): Line[] {
  const full = widths.reduce((a, b) => a + b, 0) + gutters(t)
  const rule: Line = [{ text: '─'.repeat(full), color: RULE_COLOR }]
  const lane = lanes(t)
  const rows = t.rows.flatMap((r, i) => [...(i ? [rule] : []), ...row(r, widths, t, lane)])
  return [...row(t.header.map(bold), widths, t, lane.map(() => 0)), rule, ...rows]
}
