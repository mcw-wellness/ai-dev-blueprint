// Whether the reply the Reply band answers shows its `🔴 Needs you` block, and its drafts, whole on screen: while it does,
// the band leaves those rows to the reply (owner, 2026-10-27). The engine reports which rows of a message the viewport
// shows (`onScreen`), not where a block lies among them, so a block's rows are counted from the source: each line wrapped
// at the column, a run of blank lines one row. Tables and frames draw taller than their source, so its start is counted
// from the message's first row and its end back from its last: an error keeps the rows a little longer, never drops them early.
import { cells } from '../transcript/blocks'
import { drafts } from './draft'
import { needsSpans } from './parse'

/** The rows of a message the viewport shows, as the engine reports them (`e.props.onScreen`). */
type OnScreen = { first: number; last: number; of: number }
/** What the reply shows whole of what the band would repeat: its Needs-you block, and every one of its drafts. */
type InView = { needs: boolean; drafts: boolean }

// Per transcript message drawing the band's block (its render's requestId and its text, should two blocks of one API
// message share an id), its text and what it shows; one record per message, so two replies of the same text never take
// turns at one. A reload starts afresh: the replies' redraw reports.
const shown = new Map<string, { text: string; view: InView }>()

/** The rows `lines` take at `width` cells. */
function rows(lines: readonly string[], width: number): number {
  let n = 0
  lines.forEach((line, k) => {
    if (line.trim()) n += Math.max(1, Math.ceil(cells(line) / Math.max(1, width)))
    else if (k === 0 || lines[k - 1]!.trim()) n += 1
  })
  return n
}

/** Whether lines `from` to `to` are whole on screen, the message drawn `width` cells wide. */
function whole(lines: readonly string[], [from, to]: [number, number], s: OnScreen, width: number): boolean {
  const start = rows(lines.slice(0, from), width)
  const end = s.of - 1 - rows(lines.slice(to + 1), width)
  return start >= s.first && end <= s.last
}

/** What the messages drawing `block` show of it: a part any of them shows whole; nothing where none reported. */
export function shownIn(block: string): InView | undefined {
  const views = [...shown.values()].filter(s => block.includes(s.text)).map(s => s.view)
  return views.length ? { needs: views.some(v => v.needs), drafts: views.some(v => v.drafts) } : undefined
}

/**
 * Records what message `site`, of text `text`, shows of the band's `block` (none when it holds none, or `onScreen` is
 * absent, as off fullscreen); true when what the band draws changes, so it is drawn again.
 */
export function report(site: string, text: string, block: string, onScreen: OnScreen | null | undefined, width: number): boolean {
  const before = shownIn(block)
  const key = `${site}\n${text}`
  shown.delete(key)
  // Records of an earlier block are no longer read, nor this message's own as it streamed in.
  for (const [k, s] of shown) if (!block.includes(s.text) || (k.startsWith(`${site}\n`) && text.startsWith(s.text))) shown.delete(k)
  if (block.includes(text) && onScreen !== undefined) {
    const lines = text.trimEnd().split('\n')
    const needs = needsSpans(text)
    const seen = (span: [number, number]) => onScreen !== null && whole(lines, span, onScreen, width)
    const fences = drafts(text).map(d => d.at)
    shown.set(key, { text, view: { needs: needs.length > 0 && needs.every(seen), drafts: fences.length > 0 && fences.every(seen) } })
  }
  const after = shownIn(block)
  return !!before?.needs !== !!after?.needs || !!before?.drafts !== !!after?.drafts
}
