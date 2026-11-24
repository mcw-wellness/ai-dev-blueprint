// A reply block cut into what the engine draws well (markdown) and what this mod draws itself: tables, a
// leading verdict, the 🔴 Needs you mark, a line offering replies, chart and draft fences, GitHub alerts and top-level headings. Drawn text is the source's own characters with
// markdown marks removed, never added to, but for an alert's label, a heading's rule, the padding of a verdict or Needs you badge,
// the ` Your go ` badge and a reply chip's label. Beside the grammar: what every drawing shares, cells, strip and dur.

// Escape sequences go whole; other control characters but the tab and newline.
const ESCAPES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-_])/g
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
/** The text without escape sequences or control characters but tab and newline: it must not drive the terminal. */
export const strip = (text: string): string => text.replace(ESCAPES, '').replace(CONTROLS, '')

/** `1h12`, `42m`, `3d4h`: compact durations from minutes, the one format the hint and the band show. */
export function dur(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m}m`
  if (m < 48 * 60) return `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`
  return `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60)}h`
}

/** A run of drawn text and how it looks; colors are theme keys, so they follow the person's theme. */
/** `code`: a code span, whose spaces are its own and never wrap. */
export type Span = { text: string; bold?: boolean; italic?: boolean; strike?: boolean; color?: string; bg?: string; code?: boolean; href?: string }
/** A reply the Reply band offers, drawn and pressed as its chip: the option, its decision's number and point, whether recommended. */
export type Chip = { chip: string; n: number; title: string; recommended: boolean }
/** A page a reply says to open (`` `! open ~/x.html` ``), drawn as an `open` chip after it. */
export type Opener = { open: string }
/** A page or link a code span opens, with or without `!`: an http(s) link, or a local page, PDF or picture, an anchor (`#target`) allowed. */
export const OPEN = /^`+!?\s*open\s+(https?:\/\/[^\s`]+|[~/][^\s`#]*\.(?:html?|pdf|png|svg|jpe?g)(?:#[^\s`]*)?)\s*`+$/
const OPENS = /`+!?\s*open\s+(?:https?:\/\/[^\s`]+|[~/][^\s`#]*\.(?:html?|pdf|png|svg|jpe?g)(?:#[^\s`]*)?)\s*`+/
/** Per line index of a reply, each reply quoted on it, by its quoted text (`reply/parse.ts`, `offers`). */
export type Offers = ReadonlyMap<number, ReadonlyMap<string, Chip>>

/** `figure`: each cell's leading figure flush right in a lane of its own, any note after it trailing left. */
type Align = 'left' | 'right' | 'figure'
/** `indent`: the source's leading spaces, under a list item. */
export type Table = { header: Span[][]; rows: Span[][][]; align: Align[]; indent: number }
/** `lead`: the TL;DR mark before the word, when the line opens with one (LEAD). */
type Verdict = { word: string; role: string; rest: Span[]; lead?: Span[] }
/** `indent`: a markdown segment's or table's place under a list item, in cells. */
/** A chart: its fence whole (`text`, drawn as markdown until its picture is ready) and the diagram inside (`body`). */
export type Chart = { kind: 'chart'; text: string; body: string; indent: number }
export type Segment =
  | { kind: 'markdown'; text: string; indent: number }
  | { kind: 'table'; table: Table }
  | { kind: 'verdict'; verdict: Verdict }
  /** `> [!WARNING]` and its quote: the label, its theme key and the quote's markdown. */
  | { kind: 'alert'; label: string; color: string; body: string }
  /** A `#` or `##` line, drawn by the engine with a rule under it. */
  | { kind: 'heading'; text: string }
  /** A line opening `🔴 **Needs you:**` at the margin, and the text after the mark; `go`: it opens a decision offering a grant. */
  | { kind: 'needs'; rest: (Span | Chip | Opener)[]; go?: true }
  /**
   * A line holding offered replies, or opening a decision offering a grant (`go`): its indent and list mark, its text
   * with each reply a chip; `gap` and `after`: a blank line before and after it in the source.
   */
  | { kind: 'offer'; indent: number; marker: string; parts: (Span | Chip | Opener)[]; gap: boolean; after: boolean; go?: true }
  /** A ```` ```draft ```` fence no decision offers as a reply: a message the owner sends, its markdown drawn framed and copied by the Reply band; `at`: its fence lines. */
  | { kind: 'draft'; body: string; indent: number; at: [number, number] }
  | Chart

/** The theme key each state word draws in: a final message's verdict (`Done.`, `Not done:`) and a table cell's first word. */
export const ROLES: Record<string, string> = {
  Done: 'success', Merged: 'success', Passed: 'success', Live: 'success', Deployed: 'success', Fixed: 'success', Clean: 'success',
  Resolved: 'success',
  Running: 'claude', 'In progress': 'claude', Waiting: 'claude',
  Next: 'inactive',
  'Not done': 'error', Blocked: 'error', Failed: 'error', Refused: 'error', Down: 'error',
  You: 'merged', 'Needs you': 'merged',
}
// GitHub's alert levels in GitHub's hues.
const ALERTS: Record<string, string> = { NOTE: 'permission', TIP: 'success', IMPORTANT: 'merged', WARNING: 'warning', CAUTION: 'error' }
const ALERT = /^ {0,3}> ?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i
// A `#` or `##` heading at the margin; deeper ones and those under a list item stay the engine's.
const HEADING = /^#{1,2} +\S/
/** A list item's marker; the first group is its indent. */
export const ITEM = /^(\s*)(?:\d+[.)]|[-*+•])\s+/
/** A line under a list: indented, or opening an item. */
export const nested = (line: string): boolean => /^\s/.test(line) || ITEM.test(line)
// The owner's decisions start a line or a list item, a heading's marks allowed; bold may wrap the mark with or without
// the 🔴. One in a quote or a sentence (`No 🔴 Needs you items remain`) asks nothing.
const NEEDS = /^(?:#{1,6} +)?(?:\*\*)?🔴 *(?:\*\*)?Needs you *(?:\*\*)?(:?)(?:\*\*)?(.*)$/iu
export const VERDICT = /^(?:\*\*)?(Done|Running|Not done|Blocked|Failed|Resolved)([.:])(?:\*\*)?(?= |$)/
// Kei's replies open with a TL;DR mark the verdict may follow: `🩵 **TL;DR:** Done. …` on his laptop, and on vvs-box
// `🩷 **TL;DR:** (Needs You) Not done: …`, whose tag claude-herd reads to alert his phone, so the mark stays as written.
const LEAD = /^\p{Extended_Pictographic}\uFE0F? \*\*TL;DR:\*\* +(?:\((?:Critical|Trading|Needs You|Changes|QA|Update|Misc)\) +)?/iu

/** The TL;DR mark a line opens with, else ''. */
export const leadOf = (line: string): string => LEAD.exec(line)?.[0] ?? ''

/** The text after a line's `🔴 Needs you` mark, which a colon ends, else a parenthesis (`(2):`) or the line's end; undefined without one. */
export function needsMark(line: string): string | undefined {
  const m = NEEDS.exec(line.replace(ITEM, '').trimStart())
  return m && (m[1] || /^\s*(\(|$)/.test(m[2]!)) ? m[2] : undefined
}

// Zero cells: combining marks, joiners, variation selectors. Two: a grapheme holding a pictograph or flag, or an East
// Asian wide letter.
const ZERO = /^[\p{Mn}\p{Me}​-‏︀-️]+$/u
const WIDE = /[\p{Emoji_Presentation}\p{Regional_Indicator}ᄀ-ᅟ⺀-〾ぁ-꓏가-힣豈-﫿＀-｠￠-￦\u{20000}-\u{3fffd}]|\p{Extended_Pictographic}(?:️|‍)/u
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' })

/** The characters as the terminal draws them: one entry per grapheme (`🧑‍💻`, `🇨🇭`, `é`). */
export const graphemes = (text: string): string[] => [...GRAPHEMES.segment(text)].map(g => g.segment)

/** Cells one grapheme takes. */
const cell = (g: string): number => (ZERO.test(g) ? 0 : WIDE.test(g) ? 2 : 1)

/** Terminal cells a string takes. */
export const cells = (text: string): number => graphemes(text).reduce((n, g) => n + cell(g), 0)

// Inline marks, earliest first: a code span, an autolink, a link, bold, strikethrough, italic, an escaped character.
const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|<(https?:\/\/[^\s<>]+)>|(?<!!)\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)|\*\*(?=\S)([\s\S]*?\S)\*\*|~~(?=\S)([\s\S]*?\S)~~|(?<![\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?![\w*])|\\([\\`*_{}[\]()#+\-.!|~<>])/

/** Markdown inline text as styled spans: code in the engine's code color, links, bold, italic, struck. */
export function inline(text: string, style: Omit<Span, 'text'> = {}): Span[] {
  const out: Span[] = []
  // A tab reaches the terminal's next stop, which no width here knows: two spaces, as a shell row draws it.
  let rest = text.replace(/\t/g, '  ')
  for (let m = INLINE.exec(rest); m; m = INLINE.exec(rest)) {
    if (m.index > 0) out.push({ ...style, text: rest.slice(0, m.index) })
    const [all, fence, code, auto, label, href, bold, strike, italic, escaped] = m
    if (auto) out.push({ ...style, text: auto, href: auto })
    else if (href) out.push(...inline(label!, { ...style, href }))
    else if (fence) out.push({ ...style, text: /^ .*[^ ].* $/.test(code!) ? code!.slice(1, -1) : code!, color: 'permission', code: true })
    else if (bold) out.push(...inline(bold, { ...style, bold: true }))
    else if (strike) out.push(...inline(strike, { ...style, strike: true }))
    else if (italic) out.push(...inline(italic, { ...style, italic: true }))
    else out.push({ ...style, text: escaped! })
    rest = rest.slice(m.index + all.length)
  }
  if (rest) out.push({ ...style, text: rest })
  return out.filter(s => s.text)
}

/** A table row's cells: split at pipes not escaped, the outer ones dropped. */
function cellsOf(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  return body.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
}

const ROW = /^ {0,3}\|/
const RULE = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
export const FENCE = /^ {0,3}(`{3,}|~{3,})/
// An inline link is drawn as one (owner, 2026-10-27: tables and verdicts with links lost their layout); a reference link
// keeps its target only where the engine draws it, so a paragraph or table holding one stays the engine's, and a block
// with a reference definition stays the engine's whole.
const LINK = /\]\[|\]:/
// What ends a paragraph besides a blank line: a list item, heading, quote, fence or table.
const BLOCK_START = /^ {0,3}([-*+] |\d+[.)] |#{1,6} |> |`{3}|~{3}|\|)/

// A figure leading a cell, with its sign or currency: `1,759 + 3,769 refs`, `+80/−43`, `~21,300`, `$2,000`.
const FIGURE = /^[~≈<>≤≥+\-−±]?\s?[$€£]?\d/
const BLANK = /^(|-|—|–|n\/a)$/

export const plain = (spans: Span[]): string => spans.map(s => s.text).join('')

/** Text holding a link only the engine draws: a reference link, or one `inline` leaves as text (an image). */
const engineLink = (text: string): boolean => LINK.test(text) || plain(inline(text)).includes('](')

/**
 * Right where the source aligns right, or for a column whose every filled cell is a figure with at most a short note
 * (`1,759 + 3,769 refs`). Where a cell has a sentence after its figure (`938 (2.1% of the code)`), the figures align
 * right in a lane of their own and the sentence trails, so every figure stays in line with the others.
 */
function alignOf(rule: string, column: Span[][]): Align {
  if (/-:\s*$/.test(rule) && !/^\s*:/.test(rule)) return 'right'
  const filled = column.map(c => plain(c).trim()).filter(t => !BLANK.test(t))
  if (!filled.length || !filled.every(t => FIGURE.test(t))) return 'left'
  return filled.every(t => t.split(/\s+/).length <= 4) ? 'right' : 'figure'
}

function table(lines: string[]): Table {
  const rules = cellsOf(lines[1]!)
  const width = rules.length
  const row = (line: string) => {
    const c = cellsOf(line).slice(0, width)
    while (c.length < width) c.push('')
    return c.map(t => inline(t))
  }
  const rows = lines.slice(2).map(row)
  const align = rules.map((r, i) => alignOf(r, rows.map(cells => cells[i]!)))
  return { header: row(lines[0]!), rows, align, indent: /^ */.exec(lines[0]!)![0].length }
}

/** The leading verdict, when the block opens with one: its word and the rest of its paragraph. */
function verdict(lines: string[]): { verdict: Verdict; used: number } | undefined {
  const head = leadOf(lines[0] ?? '')
  const m = VERDICT.exec((lines[0] ?? '').slice(head.length))
  if (!m) return undefined
  let used = 1
  while (used < lines.length && lines[used]!.trim() && !BLOCK_START.test(lines[used]!)) used++
  const text = [lines[0]!.slice(head.length + m[0].length), ...lines.slice(1, used)].join(' ').trim()
  if (engineLink(text)) return undefined
  const word = { word: m[1]! + m[2]!, role: ROLES[m[1]!]!, rest: inline(text ? ` ${text}` : '') }
  return { verdict: head ? { ...word, lead: inline(head) } : word, used }
}

/** Only a bare fence of the same kind and at least the same length closes one. */
export function closes(line: string, fence: string): boolean {
  const f = FENCE.exec(line)?.[1]
  return !!f && f[0] === fence[0] && f.length >= fence.length && !line.trim().slice(f.length).trim()
}

/** Per line, whether it is code: a fence or inside one, by the rule the reply is drawn by. */
export function code(lines: readonly string[]): boolean[] {
  let fence: string | undefined
  return lines.map(line => {
    if (fence) {
      if (closes(line, fence)) fence = undefined
      return true
    }
    fence = FENCE.exec(line)?.[1]
    return fence !== undefined
  })
}

// A quote: in a code span of its own (`` `"yes"` ``), with its aside (`` `"yes" (recommended)` ``), or in text.
const QUOTED = /^`+["“]([^"”`]+)["”](\s*\([^()`]*\))?`+$/
export const QUOTES = /["“]([^"”\n]+)["”]/g
/** Markdown emphasis and code marks gone: the text as the terminal shows it. */
export const bare = (text: string): string => text.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()

/**
 * A line's text as spans, each quoted reply in `chips` a chip in its place, each page to open an `open` chip after its
 * command, the aside its code span holds after it; a quote inside a longer code span stays.
 */
function offered(text: string, chips: ReadonlyMap<string, Chip>): (Span | Chip | Opener)[] {
  const pieces: (string | Chip | Opener)[] = []
  const add = (t: string) => (typeof pieces.at(-1) === 'string' ? (pieces[pieces.length - 1] += t) : pieces.push(t))
  for (const part of text.split(/(`+[^`]*`+)/)) {
    const quoted = part.startsWith('`') ? QUOTED.exec(part) : null
    const code = quoted ? chips.get(bare(quoted[1]!)) : undefined
    const page = OPEN.exec(part)?.[1]
    if (part.startsWith('`')) {
      if (code) {
        pieces.push(code)
        add(quoted![2] ?? '')
      } else add(part)
      if (page) {
        add(' ')
        pieces.push({ open: page })
      }
      continue
    }
    let at = 0
    for (const m of part.matchAll(QUOTES)) {
      const chip = chips.get(bare(m[1]!))
      if (!chip) continue
      add(part.slice(at, m.index))
      pieces.push(chip)
      at = m.index + m[0].length
    }
    add(part.slice(at))
  }
  return pieces.flatMap<Span | Chip | Opener>(p => (typeof p === 'string' ? inline(p) : [p]))
}

/**
 * The block as segments; one markdown segment when it holds nothing this mod draws. `charts`: cut out chart fences;
 * `goes`: the lines opening a decision that offers a grant (`reply/parse.ts`, `goes`).
 */
export function segments(
  source: string,
  charts = true,
  offers: Offers = new Map(),
  goes: ReadonlySet<number> = new Set(),
  tables = true, // false: Markdown tables stay the engine's (Kei's choice, AGENT_TOOLING_TABLES)
): Segment[] {
  const text = strip(source)
  // A reference definition (`[r]: https://…`) serves the whole block's links: the engine keeps the block.
  if (/^ {0,3}\[[^\]]+\]:/m.test(text)) return [{ kind: 'markdown', text, indent: 0 }]
  const lines = text.split('\n')
  const out: Segment[] = []
  let md: string[] = []
  // After a table under a list item, the lines indented as deep stay under that item.
  let nest = 0
  const flush = () => {
    // Blank lines at the edges go; a first line's indent stays, since it may open an indented code block.
    const text = md.map(l => l.slice(nest)).join('\n').replace(/^(\s*\n)+/, '').trimEnd()
    if (text) out.push({ kind: 'markdown', text, indent: nest })
    md = []
    nest = 0
  }
  const lead = verdict(lines)
  let i = 0
  if (lead) {
    out.push({ kind: 'verdict', verdict: lead.verdict })
    i = lead.used
  }
  let fence: string | null = null
  const depth = (l: string) => /^ */.exec(l)![0].length
  const blank = (l: string | undefined) => l !== undefined && !l.trim()
  // Under an ordered item whose list numbers lazily (`1.` again), the engine keeps a table or chart: split off, the
  // list would number afresh after it.
  const number = (l: string | undefined) => Number(/^\s*(\d+)[.)] /.exec(l ?? '')?.[1] ?? NaN)
  const lazy = (i: number, end: number) => {
    const owner = depth(lines[i]!) ? lines.slice(0, i).findLast(l => l.trim() && depth(l) < depth(lines[i]!)) : undefined
    const next = owner && lines.slice(end).find(l => depth(l) === depth(owner) && number(l) >= 0)
    return number(next) <= number(owner)
  }
  for (; i < lines.length; i++) {
    const line = lines[i]!
    const f = FENCE.exec(line)?.[1]
    const mark = needsMark(line)
    const go = goes.has(i) ? { go: true as const } : {}
    const chips = offers.get(i) ?? (OPENS.test(line) || goes.has(i) ? new Map<string, Chip>() : undefined)
    // A line less indented than the list item a table sat under ends what stays under that item.
    if (!fence && nest && line.trim() && depth(line) < nest) flush()
    if (fence) {
      if (closes(line, fence)) fence = null
    } else if (f) {
      // A closed mermaid fence holding a diagram is its own segment, chart.tsx draws it, as is a closed draft fence
      // holding text; any other fence stays markdown.
      const info = line.trim().slice(f.length).trim()
      const kind = charts && info === 'mermaid' ? 'chart' : info === 'draft' ? 'draft' : undefined
      let end = i + 1
      if (kind) while (end < lines.length && !closes(lines[end]!, f)) end++
      const body = lines.slice(i + 1, end).join('\n')
      // A draft fence a decision offers as its reply (`reply/parse.ts`) is that reply's chip on a line of its own.
      const reply = kind === 'draft' && end === i + 2 ? offers.get(i + 1)?.get(bare(body)) : undefined
      if (reply) {
        flush()
        out.push({ kind: 'offer', indent: depth(line), marker: '', parts: [reply], gap: blank(lines[i - 1]), after: blank(lines[end + 1]) })
        nest = depth(line)
        i = end
        continue
      }
      const drawn = body.split('\n').some(l => l.trim() && !(kind === 'chart' && l.trim().startsWith('%%')))
      if (end < lines.length && drawn && !lazy(i, end + 1)) {
        flush()
        nest = depth(line)
        const under = new RegExp(`^ {0,${nest}}`)
        out.push(
          kind === 'draft'
            ? { kind, body: lines.slice(i + 1, end).map(l => l.replace(under, '')).join('\n'), indent: nest, at: [i, end] }
            : { kind: 'chart', text: lines.slice(i, end + 1).map(l => l.replace(under, '')).join('\n'), body, indent: nest },
        )
        i = end
        continue
      }
      fence = f
    } else if (mark !== undefined && !nested(line) && !engineLink(line)) {
      // A badge at the margin only: under a list item the engine keeps the line, so the list stays whole.
      flush()
      const rest = mark.trim() ? ` ${mark.trim()}` : ''
      out.push({ kind: 'needs', rest: chips ? offered(rest, chips) : inline(rest), ...go })
      continue
    } else if (chips && !engineLink(line)) {
      // Its replies press as the band's chips do, so this mod draws the line; what is indented under it stays under it.
      flush()
      const indent = depth(line)
      const marker = ITEM.exec(line)?.[0].slice(indent) ?? ''
      const parts = offered(line.slice(indent + marker.length), chips)
      out.push({ kind: 'offer', indent, marker, parts, gap: blank(lines[i - 1]), after: blank(lines[i + 1]), ...go })
      nest = indent + marker.length
      continue
    } else if (HEADING.test(line)) {
      flush()
      out.push({ kind: 'heading', text: line })
      continue
    } else if (ALERT.test(line)) {
      let end = i + 1
      while (end < lines.length && /^ {0,3}>/.test(lines[end]!)) end++
      const level = ALERT.exec(line)![1]!.toUpperCase()
      flush()
      const body = lines.slice(i + 1, end).map(l => l.replace(/^ {0,3}> ?/, '')).join('\n')
      out.push({ kind: 'alert', label: level[0] + level.slice(1).toLowerCase(), color: ALERTS[level]!, body })
      i = end - 1
      continue
    } else if (ROW.test(line) && RULE.test(lines[i + 1] ?? '') && cellsOf(lines[i + 1]!).length === cellsOf(line).length) {
      let end = i + 2
      while (end < lines.length && ROW.test(lines[end]!)) end++
      // A pipe on the line after may be a row without its outer pipes or text of the next block; the engine's parser
      // tells them apart, so it keeps such a table.
      const unsure = /(?<!\\)\|/.test(lines[end] ?? '')
      if (!tables || unsure || lines.slice(i, end).some(engineLink) || lazy(i, end)) {
        md.push(...lines.slice(i, end))
        i = end - 1
        continue
      }
      flush()
      const t = table(lines.slice(i, end))
      out.push({ kind: 'table', table: t })
      nest = t.indent
      i = end - 1
      continue
    }
    md.push(line)
  }
  flush()
  return out
}
