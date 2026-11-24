// The session file: what only this plugin knows of a session (the tab's glyph and name, the turn's notification, the
// Reply band's decisions) as `~/.runtime/claude-sessions/<sessionId>.json`, for a host that shows the sessions elsewhere
// (the phone). Written whenever the tab is painted and the content changed, removed when the session ends; the plugin is
// its one writer (mods/README.md, Session file).

import type { EngineInterface } from 'claude-code'

import { drafts } from './reply/draft'
import { grant, itemsSaid } from './reply/parse'
import { current, open } from './reply/state'

/** What the tab shows and what the last turn notified, as status.ts paints them. */
export type Tab = { name: string; glyph: string; notice: string }

const file = {
  want: undefined as { dir: string; id: string; text: string } | undefined, // the content asked for last, without updatedAt
  wrote: undefined as string | undefined,
  saving: undefined as Promise<void> | undefined,
  ended: new Set<string>(), // sessions whose file is removed: a paint still in flight writes none again
}

/** Where the files go; the e2e run's sessions write beside it (AGENT_TOOLING_SESSION_DIR), not where the host reads the owner's. */
async function dirOf($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  return (await $.env.get('AGENT_TOOLING_SESSION_DIR')) || (home ? `${home}/.runtime/claude-sessions` : undefined)
}

/** The session's file as the tab and the band stand now; one write at a time, the newest content last. */
export async function saveSession($: EngineInterface, tab: Tab): Promise<void> {
  const [id, dir, a] = await Promise.all([$.session.id(), dirOf($), current($)])
  if (!dir || file.ended.has(id)) return
  // Each open decision read again from its message: a reload keeps the band's decisions as an older parser read them.
  const said = a ? itemsSaid(a.block) : undefined
  const fences = a ? drafts(a.block) : []
  const decisions = (a?.session === id ? open(a) : []).map(d => {
    const item = said?.get(d.n) ?? { ...d, text: d.title, commands: [], at: [] }
    return {
      n: d.n,
      title: item.title,
      text: item.text,
      commands: item.commands,
      // The draft fences in the item, as the band copies them: a message for someone else, which `text` leaves out.
      drafts: fences.filter(f => item.at.includes(f.at[0])).map(f => f.body),
      options: item.options.map(text => ({ text, recommended: text === item.recommended, grant: grant(text) })),
      answered: a!.sent,
    }
  })
  file.want = { dir, id, text: JSON.stringify({ version: 1, sessionId: id, ...tab, decisions }) }
  if (!file.saving && pending()) file.saving = flush($)
  await file.saving
}

const pending = (): boolean => file.want !== undefined && file.want.text !== file.wrote && !file.ended.has(file.want.id)

/** Writes until the newest content is written; it lets the writer go in the step that finds nothing pending, so a save after that starts its own. */
async function flush($: EngineInterface): Promise<void> {
  try {
    while (pending()) {
      const { dir, id, text } = file.want!
      const at = new Date(await $.clock.now()).toISOString().replace(/\.\d+Z$/, 'Z')
      const stdin = `${text.slice(0, -1)},"updatedAt":"${at}"}\n`
      const { exitCode, stderr } = await $.process.run(['/bin/sh', `${$.plugin.root}/hooks/save.sh`, dir, `${id}.json`], { stdin })
      if (exitCode !== 0) throw new Error(stderr.trim() || `save.sh exited ${exitCode}`)
      file.wrote = text
    }
  } catch (error) {
    $.ui.log(`session file: ${error}`)
  } finally {
    file.saving = undefined
  }
}

/** A session `/resume` returns to writes its file again. */
export async function resumeSession($: EngineInterface): Promise<void> {
  file.ended.delete(await $.session.id())
}

/** Removes the ended session's file, once a write in flight has landed. */
export async function endSession($: EngineInterface, id: string): Promise<void> {
  file.ended.add(id)
  await file.saving
  const dir = await dirOf($)
  if (dir) await $.process.run(['rm', '-f', `${dir}/${id}.json`])
  file.wrote = undefined
}
