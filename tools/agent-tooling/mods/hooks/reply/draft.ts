// A reply's drafts, the messages the owner sends (a ```` ```draft ```` fence), and the copy that puts one on his
// clipboard as rich text with a plain-text fallback: Slack takes the HTML, a terminal the text.
import type { EngineInterface } from 'claude-code'

import { host } from '../host'
import type { Segment, Span } from '../transcript/blocks'
import { FENCE, ITEM, closes, graphemes, inline, plain, segments } from '../transcript/blocks'
import { byText, offers } from './parse'

/** Each draft fence the transcript frames, in order; fences a decision offers as its replies are chips, not drafts. */
export const drafts = byText((answer: string): Extract<Segment, { kind: 'draft' }>[] =>
  segments(answer, true, offers(answer)).flatMap(s => (s.kind === 'draft' ? [s] : [])),
)

const QUOTE = /^ *> ?(.*)$/
const HEADING = /^ *#{1,6} +(.*)$/

/** A draft's blocks: paragraphs (their lines kept apart, as a Slack message keeps them), list items, quotes, code. */
type Block =
  | { kind: 'para' | 'quote'; lines: string[] }
  | { kind: 'item'; depth: number; ordered: boolean; text: string }
  | { kind: 'code'; text: string }

function parse(md: string): Block[] {
  const out: Block[] = []
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = FENCE.exec(line)?.[1]
    const item = ITEM.exec(line)
    const quote = QUOTE.exec(line)
    const last = out.at(-1)
    if (fence) {
      let end = i + 1
      while (end < lines.length && !closes(lines[end]!, fence)) end++
      out.push({ kind: 'code', text: lines.slice(i + 1, end).join('\n') })
      i = end
    } else if (!line.trim()) out.push({ kind: 'para', lines: [] })
    else if (item) out.push({ kind: 'item', depth: item[1]!.length, ordered: /^\s*\d/.test(line), text: line.slice(item[0].length) })
    else if (quote) last?.kind === 'quote' ? last.lines.push(quote[1]!) : out.push({ kind: 'quote', lines: [quote[1]!] })
    // A line indented under a list item continues it.
    else if (last?.kind === 'item' && /^ /.test(line)) last.text += `\n${line.trim()}`
    else if (last?.kind === 'para') last.lines.push(line.replace(HEADING, '**$1**').trim())
    else out.push({ kind: 'para', lines: [line.replace(HEADING, '**$1**').trim()] })
  }
  return out.filter(b => b.kind !== 'para' || b.lines.length)
}

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function span(s: Span): string {
  let h = escape(s.text)
  if (s.code) h = `<code>${h}</code>`
  if (s.italic) h = `<i>${h}</i>`
  if (s.bold) h = `<b>${h}</b>`
  if (s.strike) h = `<s>${h}</s>`
  return s.href ? `<a href="${escape(s.href)}">${h}</a>` : h
}

const rich = (text: string): string => text.split('\n').map(l => inline(l).map(span).join('')).join('<br>')

/** The text a paste without HTML shows: marks gone, a link's target after its text. */
const bare = (text: string): string =>
  text
    .split('\n')
    .map(l => inline(l).map(s => (s.href && s.href !== s.text ? `${s.text} (${s.href})` : s.text)).join(''))
    .join('\n')

/** The draft as HTML: `<b>`, `<i>`, `<code>`, `<pre>`, links, nested lists, quotes, paragraphs. */
export function html(md: string): string {
  let out = ''
  // The open lists, innermost last: each one's depth and tag.
  const open: { depth: number; tag: string }[] = []
  const close = (depth: number) => {
    while (open.length && open.at(-1)!.depth >= depth) out += `</li></${open.pop()!.tag}>`
  }
  for (const b of parse(md)) {
    if (b.kind !== 'item') close(0)
    if (b.kind === 'para') out += `<p>${rich(b.lines.join('\n'))}</p>`
    if (b.kind === 'quote') out += `<blockquote>${rich(b.lines.join('\n'))}</blockquote>`
    if (b.kind === 'code') out += `<pre>${escape(b.text)}</pre>`
    if (b.kind !== 'item') continue
    // A sibling closes the item before it; a deeper item opens a list inside it, as does one of the other kind.
    const tag = b.ordered ? 'ol' : 'ul'
    close(b.depth + 1)
    if (open.at(-1)?.depth === b.depth && open.at(-1)?.tag !== tag) close(b.depth)
    if (open.at(-1)?.depth === b.depth) out += '</li>'
    else {
      open.push({ depth: b.depth, tag })
      out += `<${tag}>`
    }
    out += `<li>${rich(b.text)}`
  }
  close(0)
  return `<meta charset="utf-8">${out}`
}

/** The draft as plain text: blocks a blank line apart but items of one list, their marks kept, code as written. */
export function text(md: string): string {
  const numbers: number[] = []
  let out = ''
  let after: Block['kind'] | undefined
  for (const b of parse(md)) {
    out += after === undefined ? '' : after === 'item' && b.kind === 'item' ? '\n' : '\n\n'
    after = b.kind
    if (b.kind === 'code') out += b.text
    if (b.kind === 'para' || b.kind === 'quote') out += bare(b.lines.map(l => (b.kind === 'quote' ? `> ${l}` : l)).join('\n'))
    if (b.kind !== 'item') {
      numbers.length = 0
      continue
    }
    numbers.length = b.depth + 1
    numbers[b.depth] = b.ordered ? (numbers[b.depth] ?? 0) + 1 : 0
    const mark = b.ordered ? `${numbers[b.depth]}.` : '-'
    out += `${' '.repeat(b.depth)}${mark} ${bare(b.text).replace(/\n/g, `\n${' '.repeat(b.depth + mark.length + 1)}`)}`
  }
  return out
}

/** A draft's first line as the terminal shows it, link targets left out: the point of its row in the band. */
export function firstLine(md: string): string {
  const b = parse(md)[0]
  const source = !b ? '' : 'lines' in b ? (b.lines[0] ?? '') : b.text
  return plain(inline(source.split('\n')[0] ?? ''))
}

// Sets the general pasteboard's HTML and plain text, as Slack and a terminal each take one.
const SCRIPT = `ObjC.import('AppKit')
function run(argv) {
  const board = $.NSPasteboard.generalPasteboard
  board.clearContents
  board.setStringForType($(argv[0]), $.NSPasteboardTypeHTML)
  board.setStringForType($(argv[1]), $.NSPasteboardTypeString)
}`

/** The command that copies a draft: `osascript` running the script above on its HTML and plain text. */
export const copyArgv = (md: string): string[] => ['osascript', '-l', 'JavaScript', '-e', SCRIPT, html(md), text(md)]

/** A button's toast: what it did, and the first 40 characters of the first line it did it with (owner, 2026-10-27). */
function told($: EngineInterface, done: string, md: string): void {
  const first = firstLine(md)
  const cut = graphemes(first)
  $.ui.toast(`${done}: ${cut.length > 40 ? `${cut.slice(0, 40).join('')}…` : first}`)
}

/**
 * Puts the draft on the clipboard as rich text with its plain-text fallback, and says so; any number of times. Off a
 * Mac it is the draft verbatim, through the engine's own copy (wl-copy or xclip where there is one, else OSC 52, which
 * reaches the desktop's clipboard over ssh and through tmux): Kei writes Slack messages in Slack's own markup
 * (`*bold*`), which the Markdown-to-text fallback would strip.
 */
export async function copyDraft($: EngineInterface, md: string): Promise<void> {
  if (!(await host($)).isMac) {
    const copied = await $.ui.copy({ text: md })
    if (copied.isCopied) told($, 'Copied', md)
    else $.ui.toast(`Draft not copied: ${copied.reason}`)
    return
  }
  const ran = await $.process.run(copyArgv(md)).catch((e: unknown) => ({ exitCode: 1, stderr: String(e) }))
  if (ran.exitCode === 0) told($, 'Copied as rich text', md)
  else $.ui.toast(`Draft not copied: ${ran.stderr.trim() || `osascript exited ${ran.exitCode}`}`)
}
