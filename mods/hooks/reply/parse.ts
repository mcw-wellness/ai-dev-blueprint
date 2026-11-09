// Reads an agent's final message: the decisions of its `🔴 **Needs you:**` blocks, and the lines a reply can quote.
import type { Decision } from '../../types'
import type { Chip, Offers } from '../transcript/blocks'
import { FENCE, ITEM, OPEN, QUOTES, bare, closes, code, needsMark } from '../transcript/blocks'

const INDENT = (line: string): number => /^\s*/.exec(line)![0].length
// The texts a parse remembers: more than a screen of replies, each drawn again every minute.
const TEXTS = 64

/** `parse` remembering its result for the texts it read last: a reply is drawn each minute and read by several hooks. */
export function byText<T>(parse: (text: string) => T): (text: string) => T {
  const seen = new Map<string, T>()
  return text => {
    const value = seen.has(text) ? seen.get(text)! : parse(text)
    seen.delete(text)
    if (seen.set(text, value).size > TEXTS) seen.delete(seen.keys().next().value!)
    return value
  }
}
// A sentence that offers replies: its quoted words are what the owner can send back (`Or accept the risk: "accept G-7"`),
// as are quotes a colon puts to choose from (`Which size: "5" or "1"?`) and a quote on a line of its own. A quote no reply
// word or `or …:` offers is a name, a label or a message quoted (`offers only "Allow all sites" or "Block all sites"`,
// `I tried one: "recent account payments have failed"`). A line of quotes alone, joined by `or` or commas with their
// asides, offers each (`"go: restart live g5" or "later"`, owner's host-arch block, 2026-10-29); each token starts at a
// quote, so a long list followed by prose fails in linear time.
const OFFERS =
  /\b(reply|replies|say|answer|recommend\w*)\b|\bor\b[^"“.;]*:\s*["“]|:\s*["“][^"”]+["”]\s*,?\s*or\s*["“]|^\s*(?:[-*+•]|\d+[.)])\s+["“]|^\s*["“][^"”]+["”](?:\s*\([^()]*\))*(?:\s*(?:,\s*(?:or\s*)?|or\s*)["“][^"”]+["”](?:\s*\([^()]*\))*)*\s*\.?$/i
// A paragraph past a blank line that still answers the block above it (`Replies: "keep the hold" or "merge"`).
const REPLIES = /^\W*(replies|reply|answer)\b[^"“]*["“]/i
// A list item that opens with its quoted reply, then a colon or an aside (`- "keep Python code": …`), offers it.
const BULLET = /^\s*(?:[-*+•]|\d+[.)])\s*$/
// What may stand between an offer and its first reply (`Reply "x"`, `Replies: "x"`, `Or accept the risk: "accept G-7"`),
// and between two replies (`"x" (recommended) or "y"`, `"x" (recommended) (y waits) or "y"`, `"x", "y" or "z"`).
const LEAD = /(\b(reply|replies|say|answer|recommend\w*)\b[^"“.;:]{0,12}:?|\bor\b[^"“.;]*:)\s*$/i
const JOIN = /^\s*(\([^()]*\)\s*)*(,?\s*(or)?|\(\s*or)\s*$/i
// A reply word in a clause that says when to do something (`Right before you say "research": log in`) names a reply
// another item offers; it offers none itself (owner's host-arch block, 2026-10-28).
const WHEN = /\b(before|after|when|once|until|till)\s+(you\s+)?(reply|replies|say|answer)\b[^"“.;:]{0,12}:?\s*$/i
const MAX_REPLY = 100
// `"x" (recommended)`, `"x" (the fixer recommends this)`, `(x, recommended)`, `I recommend x`; never `(not recommended)`.
const RECOMMEND =
  /["“]([^"”\n]+)["”]\s*\((?![^()]*(?:\b(?:not|never|against)\b|n['’]t\b))(?:[^()]*\s)?recommend\w*\b[^()]*\)|\((?![^()]*(?:\b(?:not|never|against)\b|n['’]t\b))([^()]{1,40}?),?\s+recommended\)|\b(?:I(?:'d| would)? recommend|recommendation:)\s+["“]?([^"”.;\n]{1,40}?)["”]?(?=[.;\n]|$)/i
const MAX_OPTIONS = 6
// A decision numbered in bold (`**2. Decide whether …**`), as the owner's Writing rule numbers them, is a list item.
const BOLD_NUMBER = /^\*\*(\d+[.)])(\*\*)?\s+/
const numbered = (line: string): string => line.replace(BOLD_NUMBER, (_, n: string, closed?: string) => (closed ? `${n} ` : `${n} **`))

/**
 * A numbered decision's lines, each of two or more draft fences in a row holding one short line read as that line quoted
 * on a line of its own, its fence lines blank: they are the decision's replies, not messages to send (owner, 2026-10-27).
 * A lone fence, or one holding more, stays a draft.
 */
function fencedReplies(lines: readonly string[]): string[] {
  const out = [...lines]
  let run: number[] = []
  const end = () => {
    if (run.length > 1) for (const i of run) out.splice(i, 3, '', `"${lines[i + 1]!.trim()}"`, '')
    run = []
  }
  for (let i = 0; i < lines.length; i++) {
    const fence = FENCE.exec(lines[i]!)?.[1]
    const body = lines[i + 1]?.trim() ?? ''
    if (fence && lines[i]!.trim().slice(fence.length).trim() === 'draft' && body && body.length <= MAX_REPLY && !/["“”]/.test(body) && closes(lines[i + 2] ?? '', fence)) {
      run.push(i)
      i += 2
    } else if (lines[i]!.trim()) end()
  }
  end()
  return out
}

/** Lines of the message, each with its index: where a chip drawn in the reply belongs. */
type Lines = { text: string[]; at: number[] }
/** A list item's lines and the number the message gives it (`2.`). */
type Item = Lines & { own?: number }

/** The text of each `🔴 Needs you` block, from its line to the next paragraph that is no list, quote or command. */
const blocks = byText((answer: string): Lines[] => {
  const lines = answer.split('\n')
  const fenced = code(lines)
  const found: Lines[] = []
  let block: Lines | null = null
  let gap = false
  // A block opened under a list ends at the first line indented less than its own text: its siblings ask nothing.
  let within = 0
  const add = (line: string, i: number) => {
    block!.text.push(line)
    block!.at.push(i)
  }
  for (const [i, raw] of lines.entries()) {
    // A fence holds code or an example: a 🔴 line in one asks nothing.
    if (fenced[i]) {
      if (block) add(raw, i)
      continue
    }
    const line = numbered(raw)
    const mark = needsMark(line)
    if (block && mark !== undefined) block = null
    if (!block) {
      if (mark !== undefined) {
        block = { text: [mark.trimStart()], at: [i] }
        found.push(block)
        gap = false
        within = ITEM.exec(line)?.[0].length ?? INDENT(line)
      }
      continue
    }
    if (!line.trim()) {
      gap = true
      add(line, i)
      continue
    }
    if (INDENT(line) < within) {
      block = null
      continue
    }
    // A decision numbered in bold continues the block only where it numbers on from the last (`**2.` after `1.`): a
    // section numbered afresh after it (`**1. ro02 weekdays: ready**`) is the report.
    const bold = BOLD_NUMBER.exec(raw)?.[1]
    const last = Number(/^\d+/.exec(block.text.findLast(l => /^\d+[.)]\s/.test(l)) ?? '')?.[0] ?? 0)
    const continues = (bold ? parseInt(bold) === last + 1 : ITEM.test(line)) || /^\s|^>|^!/.test(line)
    // A first paragraph under an empty heading line belongs to the block.
    const onlyHead = block.text.every(l => !l.trim())
    if (gap && !continues && !onlyHead && !REPLIES.test(line)) {
      block = null
      continue
    }
    if (/^#{1,6}\s/.test(line)) {
      block = null
      continue
    }
    gap = false
    add(line, i)
  }
  return found
})

/**
 * Each top-level list item is a decision, numbered as the message numbers it; a block without a list, or whose 🔴 line
 * says what is needed and fewer than two items offer replies, is one. A 🔴 line that only qualifies the list (`(each
 * optional; none blocks the cleanup):`) or says `nothing` or `none` says nothing needed.
 */
function items({ text: block, at }: Lines): Item[] {
  const head = block[0]?.replace(/\*\*/g, '').replace(/^\s*\([^()]*\)\s*:?\s*$/, '').trim()
  const none = /^\W*(nothing|none)\b[^"“]*$/i.test(head ?? '')
  const fenced = code(block)
  const listed = block.filter((l, i) => !fenced[i] && ITEM.test(l) && !/^\s*>/.test(l))
  if (listed.length === 0) return none ? [] : [{ text: block, at }]
  const top = Math.min(...listed.map(l => ITEM.exec(l)?.[1]?.length ?? 0))
  const starts = block.flatMap((l, i) => (!fenced[i] && ITEM.exec(l)?.[1]?.length === top ? [i] : []))
  // Each numbered item's lines with its fenced replies quoted, whether it is a decision or the block is one.
  const lines = [...block]
  starts.forEach((s, k) => {
    if (/\d/.test(ITEM.exec(block[s]!)![0])) fencedReplies(block.slice(s, starts[k + 1])).forEach((l, j) => (lines[s + j] = l))
  })
  const whole = [{ text: lines, at }]
  const out: Item[] = []
  for (const [i, line] of lines.entries()) {
    const m = starts.includes(i) ? ITEM.exec(line) : null
    if (m) out.push({ text: [line.replace(ITEM, '')], at: [at[i]!], own: Number(/\d+/.exec(m[0])?.[0]) || undefined })
    else if (out.length) {
      out.at(-1)!.text.push(line)
      out.at(-1)!.at.push(at[i]!)
    }
  }
  // `two decisions:` over items that each offer replies introduces them; over one, or none, it is the point.
  if (head && !none && out.filter(t => decision(t.text.join('\n'), 0).options.length).length < 2) return whole
  return out
}

/** The first sentence, with the next when it is as short as `Still open.` and the next offers no quoted reply, a chip already. */
function sentence(text: string): string {
  const [first = '', second] = bare(text.trim().split('\n')[0] ?? '').split(/(?<=[.?!])\s/)
  return first.split(' ').length <= 3 && second && !/["“]/.test(second) ? `${first} ${second}` : first
}

/** A point without a bold lead: its first clause, capitalized, an ellipsis where the sentence goes on; the rest is one line up. */
function clause(text: string): string {
  const end = text.search(/[,;]\s|\s\(|\s[—–]\s/)
  const head = end < 0 ? text : `${text.slice(0, end)}…`
  return head.charAt(0).toUpperCase() + head.slice(1)
}

/** A bold lead that is a sentence (`**Stop mm-live.**`) or is followed by an aside; one that is not, with the rest of its sentence (`**DIFF-15:** should …?`); else the first sentence. */
function title(text: string): string {
  const lead = /^\s*\*\*(.+?)\*\*(.*)/.exec(text)
  if (!lead) return clause(sentence(text).replace(/[:.]$/, ''))
  const head = bare(lead[1] ?? '')
  const rest = sentence((lead[2] ?? '').replace(/^:/, ''))
  // An aside after the lead (`**Drop the proxy signature type** (about −90 lines).`) is no part of the point.
  if (!rest || /[.?!]$/.test(head) || rest.startsWith('(')) return head.replace(/[:.]$/, '')
  const label = head.endsWith(':') || (lead[2] ?? '').startsWith(':')
  return `${head.replace(/:$/, '')}${label ? ':' : ''} ${rest}`.replace(/[:.]$/, '')
}

/** The lines a reply reads: no quoted drafts, code or commands to run. */
function prose(text: string): string {
  const lines = text.split('\n')
  const fenced = code(lines)
  return lines.filter((l, i) => !fenced[i] && !/^\s*(>|!)/.test(l)).join('\n')
}

/** A command line: `! cmd`, in a code span or not, as the owner's Writing rule puts a command on its own line. */
const COMMAND = /^\s*(`*)!\s+(.+?)\1\s*$/

/**
 * The item as the owner reads it, Markdown, indentation and paragraphs kept, without its fences (drafts, code) or its
 * commands; and its commands, on a line of their own or in a fence (`! codex mcp login notion-readonly`).
 */
function said(text: string): { text: string; commands: string[] } {
  const lines = text.split('\n')
  const fenced = code(lines)
  const commands = lines.flatMap(l => COMMAND.exec(l)?.[2]?.trim() ?? [])
  const kept = lines.filter((l, i) => !fenced[i] && !COMMAND.test(l))
  const indent = Math.min(...kept.slice(1).filter(l => l.trim()).map(INDENT))
  const body = kept.map((l, i) => (i === 0 ? l.trim() : l.slice(Math.min(indent, INDENT(l))).trimEnd()))
  return { text: body.join('\n').replace(/\n{3,}/g, '\n\n').trim(), commands }
}

/** A decision, and each quoted reply it offers, as quoted, with the option it is. */
function decision(text: string, n: number): Decision & { quoted: Map<string, string> } {
  // Code marks around a quote (`` `"go"` (recommended) ``) neither offer nor recommend anything.
  const body = prose(text).replace(/`/g, '')
  const options: string[] = []
  // A bold title ends its sentence too (`**Deploy.** "go: deploy" or "hold"`, Kei's Labs card 2026-10-29 had no chips).
  for (const sentence of body.split(/(?<=[.?!](?:\*\*)?)\s+|\n/)) {
    if (!OFFERS.test(sentence)) continue
    let after = 0 // where the last offered reply ended
    for (const m of sentence.matchAll(QUOTES)) {
      const option = bare(m[1] ?? '')
      const before = sentence.slice(after, m.index)
      const rest = sentence.slice(m.index + m[0].length)
      // A reply is a quote the sentence offers: right after an offer, after another reply (`"x" or "y"`), opening its
      // line, or before `(recommended)` or `or "y"`; a quoted name elsewhere (`Service Quotas (EC2, "All Standard …")`) is not.
      // `"Realized PnL" and "Unrealized PnL" (recommended)` names a pair; a placeholder (`<time>`) is no reply to send.
      // A clause saying when to act names its replies; it offers none (`Before you say "a" or "b": log in`).
      if (after === 0 && WHEN.test(before)) continue
      const offered =
        LEAD.test(before) ||
        (after > 0 && JOIN.test(before)) ||
        (after === 0 && BULLET.test(before) && /^\s*([:(—–-]|$)/.test(rest)) ||
        (after === 0 && !before.trim() && /^\s*\.?$/.test(rest)) ||
        (!/\band\s*$/i.test(before) && /^\s*(\((?:[^()]*\s)?recommend\w*\b|,?\s*or\s*["“])/i.test(rest))
      if (!offered) continue
      after = m.index + m[0].length
      if (option && option.length <= MAX_REPLY && !/<[^<>]+>/.test(option) && !options.includes(option)) options.push(option)
    }
  }
  const raw = [...options]
  // `"obs-follow 1", "2" or "3"`: the short forms take the first one's words.
  const stem = /^(.+\s)\d+$/.exec(options[0] ?? '')?.[1]
  if (stem) options.forEach((o, i) => /^\d+$/.test(o) && (options[i] = stem + o))
  // What is quoted, `"2"`, and the option it is, `obs-follow 2`. Only a quoted reply is a chip: a decision offering none
  // is answered in words, as one recommending what it never quotes (`I recommend it.`) stars nothing.
  const quotes = raw.map((r, i): [string, string] => [r, options[i]!])
  const rec = RECOMMEND.exec(body)
  const named = bare(rec?.[1] ?? rec?.[2] ?? rec?.[3] ?? '').toLowerCase()
  const recommended = named ? (options.find(o => o.toLowerCase() === named) ?? options.find(o => o.toLowerCase().endsWith(` ${named}`))) : undefined
  const shown = options.slice(0, MAX_OPTIONS)
  const quoted = new Map(quotes.filter(([, o]) => shown.includes(o)))
  // The point without the replies it offers (`Keep the demo: "keep" (recommended) or "drop"` is `Keep the demo`).
  const point = title(text)
  const first = Math.min(...[...quoted.keys()].map(q => point.search(new RegExp(`["“]${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["”]`))).filter(i => i > 0))
  const short = Number.isFinite(first) ? point.slice(0, first).replace(/[\s,:;]*(\b(reply|replies|say|answer)\b\s*)?$/i, '').replace(/[:.]$/, '') : ''
  const opens = [...text.matchAll(/`+[^`]*`+/g)].flatMap(m => OPEN.exec(m[0])?.[1] ?? [])
  return { n, title: short || point, options: shown, recommended, quoted, opens: opens.length ? opens : undefined }
}

/** The message's `🔴 Needs you` items, each with its decision. */
const asked = byText((answer: string) => {
  const found = blocks(answer)
    .flatMap(items)
    .filter(t => bare(t.text.join('\n')))
  // The message's own numbers where every item has one and none repeats, so `🔴2` names what it shows as 2.
  const own = found.map(t => t.own)
  const mine = own.every(n => n !== undefined) && new Set(own).size === own.length
  return found.map((t, i) => ({ at: t.at, text: t.text, ...decision(t.text.join('\n'), mine ? t.own! : i + 1) }))
})

/** A reply granting a permission (`go: restart live hype_fade`, `Kei's go: KB2P live`): a press of its own chip is the owner's go
 * (owner, 2026-10-27), but `★ all` never picks one and a typed prompt never carries one. */
export const grant = (reply: string): boolean => /\bgo\b/i.test(reply)

/** The line opening each decision that offers a grant, which a ` Your go ` badge marks (owner, 2026-10-27). */
export function goes(answer: string): Set<number> {
  return new Set(asked(answer).flatMap(d => (d.options.some(grant) ? [d.at[0]!] : [])))
}

/** The decisions of the message's `🔴 Needs you` blocks, numbered as the message numbers them, else from 1 in order. */
export function needsYou(answer: string): Decision[] {
  return asked(answer).map(({ n, title, options, recommended, opens }) => ({ n, title, options, recommended, opens }))
}

/** The decisions as `needsYou` reads them, each with its whole item, its commands to copy and its lines in the message, by number: the session file's. */
export const itemsSaid = byText((answer: string): Map<number, Decision & { text: string; commands: string[]; at: number[] }> =>
  new Map(asked(answer).map(({ n, title, text, at, options, recommended, opens }) => [n, { n, title, options, recommended, opens, at, ...said(text.join('\n')) }])))

/** Each `🔴 Needs you` block's first and last line of text in the message, by line index. */
export function needsSpans(answer: string): [number, number][] {
  const lines = answer.split('\n')
  return blocks(answer).map(b => [b.at[0]!, b.at.findLast(i => lines[i]!.trim()) ?? b.at[0]!])
}

/** Whether the message says nothing waits on the owner: a line `Needs you: nothing.`, 🔴 and bold or not; `nothing new` is not that. */
export function nothingNeeded(answer: string): boolean {
  const lines = answer.split('\n')
  const fenced = code(lines)
  return lines.some((l, i) => !fenced[i] && /^(?!\s*>)\W*Needs you\W*(nothing|none)\W*$/iu.test(l))
}

/** Per line of the message, each reply quoted on it, or a reply fence holds, that the band offers, by its quoted text: its chip. */
export function offers(answer: string): Offers {
  const out = new Map<number, Map<string, Chip>>()
  for (const d of asked(answer))
    d.at.forEach((line, k) => {
      // The quotes on the line as the decision reads them: marks gone, as `bare` leaves a reply.
      const said = new Set([...(d.text[k] ?? '').matchAll(QUOTES)].map(m => bare(m[1] ?? '')))
      for (const [q, option] of d.quoted)
        if (said.has(q)) out.set(line, (out.get(line) ?? new Map()).set(q, { chip: option, n: d.n, title: d.title, recommended: option === d.recommended }))
    })
  return out
}

/** Each paragraph, bullet and quoted line of the message, as the terminal shows it, longest first cut. */
export function quotable(answer: string): string[] {
  const lines = answer.split('\n')
  const fenced = code(lines)
  const out: string[] = []
  for (const [i, line] of lines.entries()) {
    if (fenced[i] || /^\s*\|/.test(line)) continue
    const unquoted = line.replace(/^\s*>\s?/, '')
    const text = bare((needsMark(unquoted) ?? unquoted).replace(ITEM, '').replace(/^#+\s/, ''))
    if (text.length >= 12 && !out.includes(text)) out.push(text)
  }
  return out
}
