import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { drawer, readPalette, viewers } from './transcript/chart'
import { render } from './transcript/message'
import { reply } from './reply/band'
import { ghost, replyAnswer, replyStart, replySubmit } from './reply/state'
import { tools } from './transcript/tools'
import { endSession, resumeSession } from './session'
import { calling, findTerminal, hint, markLoaded, notify, paintStatus, paintTab, permitting, rename, setBackground, setTurn, switchTab } from './status'
import { latest, refresh } from './thread'

const POLL_MS = 60_000
// Change a tag when its value's type changes: it declines what an earlier version stored.
const named = atom({ plugin: 'agent-tooling', key: 'named' } as const, false, { shape: 'named-1' })

/** Offers `/rename <thread>` once, when the session has a thread and was never renamed; not over the band's ghost reply. */
async function offerRename($: EngineInterface): Promise<void> {
  if ((await read($, named)) || (await ghost($))) return
  const snap = await latest($)
  const thread = snap && 'value' in snap.timeline ? snap.timeline.value.plan.thread : null
  if (!thread) return
  const { isShown } = await $.prompt.suggest({ text: `/rename ${thread.name}` })
  if (isShown) await update($, named, () => true)
}

/** A fresh snapshot, then the hint and status line from it; polled always, since the hint always shows. */
async function tick($: EngineInterface): Promise<void> {
  $.ui.invalidate('ui.render') // the band's ages
  await refresh($)
  await paintStatus($)
  await offerRename($)
}

async function switched($: EngineInterface): Promise<void> {
  await resumeSession($)
  await switchTab($)
  await replyStart($)
}

export const register: Register = on => {
  render(on) // first, so its width probe runs outside the band
  reply(on)
  tools(on)
  hint(on)
  viewers(on)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await markLoaded($)
    void paintStatus($) // a reload clears its marker at once
    // board --status is cached a minute across sessions; the timeline library took 1.5 s on a 315 MB transcript (2026-10-28).
    $.clock.every(POLL_MS, () => tick($))
    await replyStart($)
    await drawer($)
    if (e.isInteractive && e.surface === 'terminal') await findTerminal($)
    return result
  })

  // The session file goes with its session: at an exit, a `/clear` or a `/resume` to another.
  on('session.end', async ($, e, next) => {
    await endSession($, e.sessionId)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The band's decisions changed (a reply, a dismissed row, a send): the tab and the session file follow.
  on('state.set', { plugin: 'agent-tooling', key: 'asked' }, async ($, e, next) => {
    const result = await next(e)
    void paintTab($)
    return result
  }).catch(($, e, next) => next(e))

  // A theme picked in /config draws the charts in its palette.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    await readPalette($)
    return result
  })

  // `/clear` and `/resume` switch the session within the process, once every hook on that ran: the tab and the band
  // follow the session switched to.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source !== 'startup') void $.clock.after(0, () => switched($))
    return result
  }).catch(($, e, next) => next(e))

  // The owner's own prompts put the Reply band away; a failure here never holds one up.
  on('prompt.submit', async ($, e, next) => {
    const typed = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!typed || e.command || e.isMeta || !e.text.trim()) return next(e)
    const text = await replySubmit($, e.text)
    return next(text === e.text ? e : { ...e, text })
  }).catch(($, e, next) => next(e))

  // `/rename` fires no hook of its own: retitle the tab at once, and never offer it again.
  on('command.run', { command: 'rename' }, async ($, e, next) => {
    const result = await next(e)
    await update($, named, () => true)
    await rename($)
    return result
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      void setTurn($, 'working')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A turn's end sets the tab at once: ❌ on an API error, 🔴 when its answer leaves decisions open, ✓ when it says the
  // session can close; an answer that is done or asks the owner notifies him.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      if (e.reason === 'answer') await replyAnswer($, e.answer)
      void setTurn($, e.reason === 'error' ? 'failed' : 'ended', e.answer)
      if (e.reason === 'answer') void notify($, e.answer)
    }
    return result
  }).catch(($, e, next) => next(e))

  // The main loop stopping is the one place the engine reports the background work it left running: the tab says ◐ on.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (e.agent_id === undefined) void setBackground($, e.background_tasks ?? [])
    return result
  }).catch(($, e, next) => next(e))

  // A question the turn asks, or a permission prompt, waits on the owner: 🔴 until the call ends, then ◐ again.
  on('tool.call', ($, e, next) => calling($, e, () => next(e))).catch(($, e, next) => next(e))
  on('classic.PermissionRequest', ($, e, next) => permitting($, e, () => next(e))).catch(($, e, next) => next(e))
}
