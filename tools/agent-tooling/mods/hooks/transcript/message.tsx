import type { On } from 'claude-code'

import type { Chip, Opener, Segment, Span } from './blocks'
import { cells, inline, leadOf, plain, segments } from './blocks'
import { BUTTONS } from '../reply/band'
import { copyChip, openChip, replyChip } from '../reply/chip'
import { bandBlock, pickedIn } from '../reply/state'
import { byText, goes, needsSpans, offers } from '../reply/parse'
import { report } from '../reply/view'
import { SECTION, chart, ready } from './chart'
import { linked } from './refs'
import { WIDEST, layout } from './table'

// The bullet column (`⏺ `) left of a reply's text.
const GUTTER = 2
// The engine's own marks right of the band's tree (its `[-]`), which bodyColumns leaves out.
const BAND_MARKS = 5
// A box's round border and one column of padding, both sides.
const FRAME = 4
// A draft's header: its ` Draft ` label, the gap and its `[ copy ]` chip.
const DRAFT_HEADER = cells(' Draft ') + 1 + cells('[ copy ]')

/** The cells a markdown body's widest line takes drawn, its marks gone. */
const widest = (md: string): number => Math.max(0, ...md.split('\n').map(l => cells(plain(inline(l)))))
/**
 * A box as wide as what it holds, never wider than `room`: a short draft or alert in a narrow frame, a long one at the
 * transcript's width, wrapped there (owner, 2026-10-27: "these boxes for this tiny content").
 */
const fit = (room: number, content: number): number => Math.min(room, content + FRAME)

// Kei prefers Claude Code's own boxed tables (2026-10-29): the fitted tables draw only with AGENT_TOOLING_TABLES=1.
// Read at the first reply drawn; an engine that does not answer (a unit test's) keeps them on, so their tests still run.
let ownTables: boolean | undefined

/** A reply as drawn: its pull requests linked (the band reads it as written), its segments, and them without charts once asked. */
const drawing = byText((source: string) => {
  const text = linked(source)
  const cut = (charts: boolean) => segments(text, charts, offers(source), goes(source), ownTables ?? true)
  let noCharts: Segment[] | undefined
  return { text, parts: cut(true), noCharts: () => (noCharts ??= cut(false)) }
})

// The transcript column's width as the band last measured it: narrower than the terminal when the engine docks something beside it.
let column: number | undefined

/**
 * Draws a reply block's tables fitted to the transcript, its leading verdict in its color, its chart fences as
 * pictures, its GitHub alerts as boxes in their color, its drafts framed and its top-level headings over a rule; the rest
 * stays the engine's.
 */
export function render(on: On): void {
  // The band is drawn in the transcript's column; a change of that width redraws the replies sized to it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const measured = e.props.bodyColumns + BAND_MARKS
    if (e.surface === 'terminal' && measured !== column) {
      column = measured
      void $.clock.after(0, () => $.ui.invalidate('ui.render'))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary) return next(e)
    ownTables ??= (await $.env.get('AGENT_TOOLING_TABLES').catch(() => '1')) === '1'
    // Its replies the Reply band offers are drawn and pressed as its chips.
    const drawn = drawing(e.props.text)
    const text = drawn.text
    // tmux passes a picture only as bytes, and only with passthrough on: there the engine draws chart fences.
    const parts = drawn.parts.some(p => p.kind === 'chart') && (await $.env.get('TMUX')) ? drawn.noCharts() : drawn.parts
    const room = (column ?? e.viewport?.columns ?? 100) - GUTTER
    // Where it shows the Reply band's block or drafts whole, the band leaves those rows to it: drawn again on a change.
    const block = parts.some(p => p.kind === 'draft') || needsSpans(e.props.text).length ? await bandBlock($) : undefined
    const onScreen = e.viewport?.isFullscreen === false ? undefined : e.props.onScreen
    if (block !== undefined && report(e.requestId, e.props.text, block, onScreen, room)) void $.clock.after(0, () => $.ui.invalidate('ui.render'))
    // A reply opening with Kei's TL;DR heart is drawn here even when it is plain markdown, without the engine's ⏺: the
    // heart already marks where it starts (Kei, 2026-10-29).
    const hasLead = e.props.isFirstOfReply && leadOf(e.props.text.trimStart().split('\n', 1)[0] ?? '') !== ''
    // Any other plain reply is the engine's, told it isn't a reply's first block so it leaves out the ⏺ too (Kei,
    // 2026-10-29: "i find it ugly").
    if (!hasLead && parts.every(p => p.kind === 'markdown'))
      return next(text === e.props.text && !e.props.isFirstOfReply ? e : { ...e, props: { ...e.props, text, isFirstOfReply: false } })
    const el = $.ui.resolve(e)
    const { Box, Button, Link, Markdown, Text } = el
    // Replies picked in this block while it is the latest: drawn picked here as in the band.
    const picked = await pickedIn($, e.props.text)
    // One column spare at the right of a chart, as the engine's text keeps.
    const chartColumns = (p: { indent: number }) => room - p.indent - 1
    if (e.viewport?.isFullscreen === false)
      await Promise.all(parts.flatMap(p => (p.kind === 'chart' ? [ready(p, chartColumns(p))] : [])))
    const spans = (line: Span[]) =>
      line.map(s => {
        const text = (
          <Text
            color={s.color}
            backgroundColor={s.bg}
            weight={s.bold ? 'bold' : undefined}
            italic={s.italic}
            strikethrough={s.strike}
          >
            {s.text}
          </Text>
        )
        return s.href ? <Link href={s.href}>{text}</Link> : text
      })
    // A bold label on a theme color: ` Needs you `, and ` Your go ` on a decision offering a grant (owner, 2026-10-27).
    // Bold words in the color, no fill: Kei found the filled blocks ugly and button-like (2026-10-29).
    const badge = (label: string, color: string) => (
      <Text color={color} weight="bold">
        {label}
      </Text>
    )
    const yourGo = (p: { go?: true }) =>
      p.go && (
        <Box flexShrink={0} marginRight={1}>
          {badge('Your go', 'warning')}
        </Box>
      )
    // A line holding chips: each word and chip one item of a wrapping row, since a Button is no part of a Text.
    const flow = (parts: (Span | Chip | Opener)[], key: string) => (
      <Box flexDirection="row" flexWrap="wrap" flexGrow={1} flexShrink={1}>
        {parts.flatMap((s, k) =>
          'open' in s
            ? [openChip(el, `${key}:${k}`, s.open, $)]
            : 'chip' in s
            ? [replyChip(el, $, s, `${key}:${k}`, e.props.text, picked.get(s.n) === s.chip)]
            : spans(s.text.split(/(?<= )/).map(w => ({ ...s, text: w }))),
        )}
      </Box>
    )
    // The engine's bullet and indent go with its drawing, so this tree draws them as it does.
    return (
      <Box flexDirection="row" marginTop={1}>
        <Box flexShrink={0} width={GUTTER}>
          <Text color="text"> </Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {parts.map((p, i) => {
            // Blocks keep the engine's blank line between them, but a list resumes after text nested in its item.
            const prev = parts[i - 1]
            // and what follows a Needs you mark stays under it.
            const usual = i > 0 && prev?.kind !== 'needs' && !(p.kind === 'markdown' && prev?.kind === 'markdown' && prev.indent > 0)
            // A line with chips keeps the source's blank lines around it: it is one line of a paragraph or list.
            const gap = Number(p.kind === 'offer' ? i > 0 && p.gap : prev?.kind === 'offer' ? prev.after : usual)
            if (p.kind === 'offer')
              return (
                <Box flexDirection="row" marginTop={gap} marginLeft={p.indent}>
                  {p.marker && (
                    <Box flexShrink={0}>
                      <Text>{p.marker}</Text>
                    </Box>
                  )}
                  {yourGo(p)}
                  {flow(p.parts, `offer${i}`)}
                </Box>
              )
            if (p.kind === 'markdown')
              return (
                <Box marginTop={gap} marginLeft={p.indent}>
                  <Markdown text={p.text} />
                </Box>
              )
            if (p.kind === 'chart')
              return (
                <Box marginTop={gap} marginLeft={p.indent}>
                  {chart(el, p, chartColumns(p), e.props.onScreen)}
                </Box>
              )
            if (p.kind === 'heading')
              return (
                <Box flexDirection="column" marginTop={gap}>
                  <Markdown text={p.text} />
                  <Text color="subtle">{'─'.repeat(Math.min(room, WIDEST))}</Text>
                </Box>
              )
            if (p.kind === 'alert')
              return (
                <Box
                  flexDirection="column"
                  marginTop={gap}
                  width={fit(room, cells(` ${p.label} `) + 1 + widest(p.body))}
                  borderStyle="round"
                  borderColor={p.color}
                  paddingX={1}
                >
                  <Box flexDirection="row">
                    <Box flexShrink={0} marginRight={1}>
                      <Text color={p.color} weight="bold">
                        {p.label}
                      </Text>
                    </Box>
                    <Box flexGrow={1} flexShrink={1}>
                      <Markdown text={p.body} />
                    </Box>
                  </Box>
                </Box>
              )
            // A message the owner sends: drawn as it will paste, framed as one message, beside its label the Reply band's
            // copy chip, pressable here too.
            if (p.kind === 'draft')
              return (
                <Box
                  flexDirection="column"
                  marginTop={gap}
                  marginLeft={p.indent}
                  width={fit(room - p.indent, Math.max(DRAFT_HEADER, widest(p.body)))}
                  borderStyle="round"
                  borderColor="suggestion"
                  paddingX={1}
                >
                  <Box columnGap={1}>
                    <Text color="suggestion" weight="bold">
                      {'Draft'}
                    </Text>
                    {copyChip(el, `frame${i}:copy`, p.body, $)}
                  </Box>
                  <Markdown text={p.body} />
                </Box>
              )
            // Done, a blocker and the owner's turn as bold words on their role's color, seen at a glance (owner, 2026-10-27);
            // Needs you in the crimson the Reply band marks the same decisions with.
            if (p.kind === 'verdict')
              return (
                <Text>
                  {p.verdict.lead ? spans(p.verdict.lead) : null}
                  <Text color={p.verdict.role} weight="bold">
                    {p.verdict.word}
                  </Text>
                  {spans(p.verdict.rest)}
                </Text>
              )
            if (p.kind === 'needs') {
              const needs = badge('Needs you', 'error')
              const plain = p.rest.filter((s): s is Span => !('chip' in s) && !('open' in s))
              return plain.length === p.rest.length && !p.go ? (
                <Box marginTop={gap}>
                  <Text>
                    {needs}
                    {spans(plain)}
                  </Text>
                </Box>
              ) : (
                <Box flexDirection="row" marginTop={gap}>
                  <Box flexShrink={0} marginRight={p.go ? 1 : 0}>{needs}</Box>
                  {yourGo(p)}
                  {flow(p.rest, `needs${i}`)}
                </Box>
              )
            }
            return (
              <Box flexDirection="column" marginTop={gap} marginLeft={p.table.indent}>
                {layout(p.table, room - p.table.indent).map(line => (
                  <Text wrap="truncate-end">{line.length ? spans(line) : ' '}</Text>
                ))}
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // The lines that ask for charts and buttons, only where a terminal draws them; fixed text, so they stay cached.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    return e.surfaces.includes('terminal') ? { sections: [...result.sections, SECTION, BUTTONS] } : result
  }).catch(($, e, next) => next(e))
}
