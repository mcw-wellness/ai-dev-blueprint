// The Reply band's state: the latest reply's decisions, what the owner picked, and the answer that goes to the agent.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionMessage } from 'claude-code'

import type { Asked, Decision } from '../../types'
import { grant, needsYou, nothingNeeded } from './parse'
import type { Chip } from '../transcript/blocks'

// Change the tag when `Asked` changes: it declines what an earlier version stored.
const asked = atom({ plugin: 'agent-tooling', key: 'asked' } as const, null, { shape: 'asked-4' })

/** Every recommended reply as one answer (`re 🔴1: 5; 🔴2: yes`), or nothing when none is recommended. */
export function recommended(decisions: readonly Decision[]): string | undefined {
  const picked = decisions.flatMap(d => (d.recommended ? [[d.n, d.recommended] as [number, string]] : []))
  return picked.length ? picksText(picked) : undefined
}

/**
 * The message's decisions, each keeping when it was first asked, and its pick, if an earlier message asked it too. An
 * answer asking nothing (an explanation, a background agent's report) leaves a block still unanswered up, unless it says
 * nothing needs the owner.
 */
async function record($: EngineInterface, text: string, at: number | undefined): Promise<void> {
  const was = await read($, asked)
  const parsed = needsYou(text)
  const session = await $.session.id()
  if (!parsed.length && !nothingNeeded(text) && was?.session === session && !was.sent && open(was).length) {
    await update($, asked, v => v && { ...v, answer: text })
    return
  }
  const before = was?.decisions ?? []
  const decisions = parsed.map(d => ({ ...d, askedAt: before.find(b => b.title === d.title)?.askedAt ?? at }))
  const kept = was?.session === session && !was.sent ? was.picks : []
  const picks = kept.flatMap(([n, o]): [number, string][] => {
    const title = before.find(d => d.n === n)?.title
    const d = decisions.find(d => d.title === title && d.options.includes(o))
    return d ? [[d.n, o]] : []
  })
  await update($, asked, () => ({ decisions, answer: text, block: text, dismissed: false, sent: false, session, picks, dropped: [] }))
  // The box takes a suggestion only once the turn has ended.
  if (decisions.length) $.clock.after(250, () => void suggest($))
}

/** Offers the band's answer as the prompt's ghost text. */
async function suggest($: EngineInterface): Promise<void> {
  const text = await ghost($)
  if (text) await $.prompt.suggest({ text })
}

/**
 * A decision of an earlier reply answered by its point (`re "Reload the renderer": later`): its number would be read
 * against the latest reply's.
 */
export function answerNamed(title: string, reply: string): string {
  // The point without the replies it offers (`Grafana: Reply "obs-follow 1", "2"` is `Grafana`).
  const point = title.replace(/[\s,:;]*(\b(reply|replies|say|answer)\b\s*)?["“].*$/i, '').replace(/[:.]$/, '')
  return `re "${point || title}": ${reply}`
}

/** The prompt answering picked replies by decision number: `re 🔴1: a; 🔴2: b`. */
const picksText = (picks: readonly [number, string][]): string =>
  `re ${[...picks]
    .sort(([a], [b]) => a - b)
    .map(([n, r]) => `🔴${n}: ${r}`)
    .join('; ')}`

/**
 * Picks replies to the latest block's decisions, merged in the state's own update so quick presses never lose one; a
 * reply already picked is taken back. The pick that leaves no open decision offering replies unpicked answers them
 * all; one answered in words is typed, alone or with the picks. `keep`: a pick
 * stays (`★ all` picks only unpicked decisions). Once answered, a press only puts its answer in the prompt.
 */
export async function pick($: EngineInterface, chosen: [number, string][], keep = false): Promise<void> {
  let text: string | undefined
  let fill = false
  await update($, asked, v => {
    if (!v) return v
    if (v.sent) {
      ;[text, fill] = [picksText(chosen), true]
      return v
    }
    const picks = new Map(v.picks)
    for (const [n, o] of chosen) {
      if (!keep && picks.get(n) === o) picks.delete(n)
      else if (!keep || !picks.has(n)) picks.set(n, o)
    }
    const next = { ...v, dismissed: false, picks: [...picks] }
    if (!picks.size || open(v).some(d => d.options.length && !picks.has(d.n))) return next
    return answer(next, t => (text = t))
  })
  await deliver($, text, fill)
}

/** `send n of m`: answers what is picked now, read from the state so a second press sends nothing. */
export async function send($: EngineInterface): Promise<void> {
  let text: string | undefined
  await update($, asked, v => (v && !v.sent && v.picks.length ? answer(v, t => (text = t)) : v))
  await deliver($, text, false)
}

/** The block answered by its picks, sent. */
function answer(v: Asked, out: (text: string) => void): Asked {
  out(picksText(v.picks))
  return { ...v, sent: true, dismissed: true }
}

async function deliver($: EngineInterface, text: string | undefined, toPrompt: boolean): Promise<void> {
  if (text && toPrompt) await prefill($, text)
  else if (text) await $.prompt.submit({ text, asUser: true }).catch(failed($, 'Not sent'))
  else await suggest($)
}

/** The decisions the owner has not dismissed. */
export const open = (v: Asked): Asked['decisions'] => v.decisions.filter(d => !v.dropped.includes(`d${d.n}`))

/** Puts an answer in the prompt for the owner to finish and send, before what he had typed there, which stays; once. */
async function prefill($: EngineInterface, text: string): Promise<void> {
  await $.prompt
    .read()
    .then(({ text: typed }) => $.prompt.fill({ text: typed.startsWith(text) ? typed : typed.trim() ? `${text}\n\n${typed}` : text }))
    .catch(failed($, 'Not in the prompt'))
}

/** A toast only where a press failed: what a press does shows on screen (owner, 2026-10-27), except a copy. */
export function failed($: EngineInterface, what: string): (e: unknown) => void {
  return e => void $.ui.toast(`${what}: ${e instanceof Error ? e.message : String(e)}`)
}

/** Dismisses a row of the band: it goes with any pick on it, sending nothing. */
export async function drop($: EngineInterface, key: string): Promise<void> {
  await update($, asked, v => v && { ...v, dropped: [...v.dropped, key], picks: v.picks.filter(([n]) => `d${n}` !== key) })
}

/** Whether `source` is the reply the band's decisions come from; an explanation since leaves it so. */
const latest = (a: Asked | null, source: string): boolean => a?.block.includes(source) ?? false

/** The band's state as it stands. Only this module reads the atom: the engine's hooks loader refuses a `read` of one defined in another file. */
export async function current($: EngineInterface): Promise<Asked | null> {
  return read($, asked)
}

/** Puts the band away, its decisions still open. */
export async function putAway($: EngineInterface): Promise<void> {
  await update($, asked, v => v && { ...v, dismissed: true })
}

/**
 * A chip's press: in the latest reply (or the band, `source` absent) it picks its reply; in an earlier one it puts its
 * answer, by the decision's point, in the prompt.
 */
export async function press($: EngineInterface, c: Chip, source?: string): Promise<void> {
  if (source === undefined || latest(await read($, asked), source)) await pick($, [[c.n, c.chip]])
  else await prefill($, answerNamed(c.title, c.chip))
}

/** The replies picked, or sent, in `source`'s block while it is the latest, by decision number: what the reply draws as picked. */
export async function pickedIn($: EngineInterface, source: string): Promise<Map<number, string>> {
  const a = await read($, asked)
  return new Map(a && latest(a, source) ? a.picks : [])
}

/** The reply the band's decisions and drafts come from, while it shows: the reply drawing them leaves it its header alone. */
export async function bandBlock($: EngineInterface): Promise<string | undefined> {
  const a = await read($, asked)
  return a && !a.dismissed ? a.block : undefined
}

/** Whether the last answer left decisions for the owner open; hiding the band leaves them open. */
export async function openDecisions($: EngineInterface): Promise<boolean> {
  const a = await read($, asked)
  return a ? open(a).length > 0 : false
}

/**
 * The answer the prompt offers as its ghost text while the band is up: each open decision's pick, else its ★ unless that
 * is a grant, which Tab and Enter would send as the owner's go unpressed.
 */
export async function ghost($: EngineInterface): Promise<string | undefined> {
  const a = await read($, asked)
  if (!a || a.dismissed || a.sent) return undefined
  const picks = new Map(a.picks)
  const chosen = open(a).flatMap((d): [number, string][] => {
    const o = picks.get(d.n) ?? (d.recommended && !grant(d.recommended) ? d.recommended : undefined)
    return o ? [[d.n, o]] : []
  })
  return chosen.length ? picksText(chosen) : undefined
}

/** The last message, when the agent wrote it: one the owner answered since asks nothing. */
function lastAnswer(messages: readonly SessionMessage[]): string {
  const last = messages.findLast(m => m.text.trim())
  return last?.role === 'assistant' ? last.text : ''
}

/** A session's band: a resumed one shows the block its last message left open, when it was asked unknown; a reload keeps it. */
export async function replyStart($: EngineInterface): Promise<void> {
  if ((await read($, asked))?.session !== (await $.session.id())) await record($, lastAnswer(await $.session.messages()), undefined)
}

/**
 * The owner's own prompt, as it goes: it answers the block, carrying the replies picked in the band up, unless it
 * already is an answer (`re 🔴1: …`), but never a grant, which goes only as text he sent; explaining keeps the band.
 */
export async function replySubmit($: EngineInterface, text: string): Promise<string> {
  if (/^explain 🔴\d/i.test(text)) return text
  let out = text
  await update($, asked, v => {
    if (!v || v.sent) return v
    const carried = v.picks.filter(([, o]) => !grant(o))
    if (carried.length && !v.dismissed && !/^re /i.test(text)) out = `${picksText(carried)}\n\n${text}`
    return { ...v, sent: true, dismissed: true }
  })
  return out
}

/** A turn's final answer: its decisions become the band. */
export async function replyAnswer($: EngineInterface, answer: string): Promise<void> {
  if (answer.trim()) await record($, answer, await $.clock.now())
}
