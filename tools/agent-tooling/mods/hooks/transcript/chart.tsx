// A reply's mermaid fences drawn as pictures on the terminal by Mermaid itself in a headless shell
// (charts/mermaid.py), for message.tsx's reply hook. A drawing never waits on the process: a fence
// not drawn yet shows as the engine draws it, the picture replacing it once mermaid.py wrote it.

import type { Elements, EngineInterface, On, RenderElement } from 'claude-code'

import type { Chart } from './blocks'

const SCRIPT = 'charts/mermaid.py'
const DRAIN_MS = 500

export const SECTION = {
  id: 'agent-tooling:charts',
  text: 'Charts: under its takeaway sentence, a ```mermaid xychart-beta fence for a series of 5+ points or a breakdown of 4+ parts (a `line`, not a `bar`, for values below zero), a gantt fence for 3+ overlapping strands, a flowchart for a dependency or flow of 4+ steps, at most about 12 nodes (split a bigger plan by phase): each node `id["Title<br>detail, ~time"]`, its first line drawn bold; `:::done`, `:::running`, `:::blocked`, `:::next` or `:::you` colors it; `{}` with a word or two for a check or decision, `([ ])` for the end, `subgraph` for a phase; under a table, each bar or node named with its row\'s first words, so one maps to the other; the terminal draws it. A risk the reader must not miss goes in a `> [!WARNING]` block (`[!CAUTION]` for loss of money or data), unless a decision offering a `go:` reply already carries it: the terminal badges those itself; no other alert kinds.',
  scope: 'session',
} as const

type Drawn = { file: string; columns: number; rows: number; alt: string; generation: number } | { error: string } | 'pending'

/**
 * The palette mermaid.py draws on the terminal's background in: `dark` for a dark theme (a custom one named dark too,
 * as Kei's `custom:kei-dark-1`), or for `auto` where
 * COLORFGBG says the terminal is dark (the engine's own fallback: its probe of the terminal is not open to a plugin);
 * `light` otherwise, as on the owner's light terminal. Set at session start and when /config changes the theme.
 */
type Palette = 'light' | 'dark'
let palette: Palette = 'light'

/**
 * Terminal.app draws no pictures (no kitty graphics): there a chart is a row whose hover opens it in Quick Look and
 * whose click opens it in Preview (Almir, 2026-11-08), drawn light on a solid page into a cache that outlives the
 * session. Set at session start from TERM_PROGRAM.
 */
let viewer = false
const VIEWER_DIR = 'Library/Caches/agent-tooling/diagrams'

export async function readPalette($: EngineInterface): Promise<void> {
  // An engine with no /config rows (a test's) leaves it light.
  const rows = await $.config.list().catch(() => [])
  const theme = String(rows.find(row => row.key === 'theme')?.value ?? '')
  const bg = Number((await $.env.get('COLORFGBG'))?.split(';').at(-1) || NaN)
  const now = /(^|[:-])dark/.test(theme) || (theme === 'auto' && (bg <= 6 || bg === 8)) ? 'dark' : 'light'
  if (now === palette) return
  palette = now
  $.ui.invalidate('ui.render')
}

// Per palette, fence and width: its picture, the drawing under way, or why it cannot be drawn. A reload starts afresh.
const drawn = new Map<string, Drawn>()
let made = 0 // pictures drawn, naming each file

/** The fence drawn by mermaid.py into this session's temporary folder, or why not. */
async function attempt($: EngineInterface, body: string, columns: number, colors: Palette): Promise<Exclude<Drawn, 'pending'>> {
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/$/, '')
  const home = (await $.env.get('HOME')) ?? ''
  const file = viewer
    ? `${home}/${VIEWER_DIR}/${await $.session.id()}/${made++}-${columns}.png`
    : `${tmp}/agent-tooling-${await $.session.id()}/reply/${made++}-${columns}.png`
  const style = viewer ? ['light', 'solid'] : [colors]
  try {
    const ran = await $.process.run(['uv', 'run', '--quiet', `${$.plugin.root}/${SCRIPT}`, file, String(columns), ...style], {
      timeoutMs: 60_000,
      stdin: body,
    })
    const said = ran.stderr.trim().split('\n').at(-1)
    // A new file each time, but a reload restarts the count: the generation tells the terminal to read it again.
    return ran.exitCode === 0 ? { ...JSON.parse(ran.stdout), generation: await $.clock.now() } : { error: said || `exit ${ran.exitCode}` }
  } catch (error) {
    return { error: String(error) }
  }
}

/** The fence drawn, a failure but Mermaid's refusal (a cold `uv` timing out) tried once more; then every reply drawn again. */
async function draw($: EngineInterface, key: string, body: string, columns: number, colors: Palette): Promise<void> {
  let result = await attempt($, body, columns, colors)
  if ('error' in result && !result.error.startsWith('mermaid:')) result = await attempt($, body, columns, colors)
  drawn.set(key, result)
  $.ui.invalidate('ui.render')
}

// Each fence and width's drawing under way, so a second asker waits for the same one.
const drawing = new Map<string, Promise<void>>()
// Drawings asked for and not yet started.
const asked: { key: string; body: string; columns: number; colors: Palette; done: () => void }[] = []

/**
 * Starts what renders asked to draw, on a timer `session.start` sets: the engine cancels a render, and every process
 * its context started, when the message changes under it (text streaming after the fence). Nothing a render calls can
 * start the timer (the engine refuses a kept `$`, and a clock.after through one never fires); each tick costs about a
 * millisecond, so it ticks at a pace that adds little to a drawing's seconds.
 */
export async function drawer($: EngineInterface): Promise<void> {
  viewer = (await $.env.get('TERM_PROGRAM')) === 'Apple_Terminal'
  $.clock.every(DRAIN_MS, () => drain($))
  await readPalette($) // before a reply draws, so none draws in the wrong palette
}

function drain($: EngineInterface): void {
  for (const a of asked.splice(0)) void draw($, a.key, a.body, a.columns, a.colors).finally(a.done)
}

const keyOf = (p: Chart, columns: number) => `${palette}\n${columns}\n${p.body}`

function start(p: Chart, columns: number): Promise<void> {
  const key = keyOf(p, columns)
  let run = drawing.get(key)
  if (!run) {
    drawn.set(key, 'pending')
    run = new Promise<void>(done => asked.push({ key, body: p.body, columns, colors: palette, done }))
    drawing.set(key, run)
  }
  return run
}

/**
 * Off fullscreen the engine prints a reply's rows once and never redraws those scrolled away, so a chart still
 * drawing would stay as its source above its picture (owner, 2026-10-27): there the reply waits for its pictures.
 */
export async function ready(p: Chart, columns: number): Promise<void> {
  const d = drawn.get(keyOf(p, columns))
  if (d === undefined || d === 'pending') await start(p, columns)
}

/**
 * A chart fence as the terminal shows it at `columns`: its picture once drawn; until then its source under a dim
 * `drawing chart…`, or under why it cannot be drawn. Drawing starts only once the fence shows (`onScreen` not null),
 * so a long transcript never starts a process per chart above the screen.
 */
export function chart(el: Elements['terminal'], p: Chart, columns: number, onScreen: unknown): RenderElement {
  const { Box, Markdown, Text, Image, Client } = el
  const d = drawn.get(keyOf(p, columns))
  if (d === undefined && onScreen !== null) void start(p, columns)
  if (d === undefined || d === 'pending' || 'error' in d) {
    return (
      <Box flexDirection="column">
        {d === undefined || d === 'pending' ? <Text dimColor>drawing chart…</Text> : <Text color="warning">{`⚠ chart: ${d.error}`}</Text>}
        <Markdown text={p.text} />
      </Box>
    )
  }
  if (viewer) return <Client key={`diagram:${d.file}`} module="./diagram-client.tsx" props={{ file: d.file, alt: d.alt }} />
  const source = { file: d.file, format: 'png', generation: d.generation } as const
  return <Image source={source} columns={d.columns} rows={d.rows} alt={d.alt} />
}

let peeked = { file: '', at: 0 }
const RAISE_QL = 'ObjC.import("AppKit"); var a = $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.apple.quicklook.qlmanage"); if (a.count) a.objectAtIndex(0).activateWithOptions(3)'

/** What a diagram row posts: Quick Look on hover, Preview on click, for a picture of our own cache only. */
export function viewers(on: On): void {
  on('ui.message', async ($, e, next) => {
    const data = e.data as { act?: unknown; file?: unknown } | null
    const home = (await $.env.get('HOME')) ?? ''
    const file = typeof data?.file === 'string' ? data.file : ''
    if (!file.startsWith(`${home}/${VIEWER_DIR}/`) || !file.endsWith('.png') || file.includes('..')) return next(e)
    if (data?.act === 'open') {
      const ran = await $.process.run(['open', '-a', 'Preview', file]).catch((x: unknown) => ({ exitCode: 1, stderr: String(x) }))
      if (ran.exitCode !== 0) $.ui.toast(`Preview did not open: ${ran.stderr.trim()}`)
      return {}
    }
    if (data?.act === 'peek') {
      const now = await $.clock.now()
      // Quick Look takes the focus, and coming back the pointer enters the row again: one peek per file per 3 s.
      if (peeked.file === file && now - peeked.at < 3_000) return {}
      peeked = { file, at: now }
      // One Quick Look at a time; detached, since it stays open until closed. Started from a script it
      // can open behind Terminal, so once its window is up it is raised through AppKit (no permission dialog).
      await $.process.run(['/bin/sh', '-c', `pkill -x qlmanage ; qlmanage -p "$1" >/dev/null 2>&1 & ( sleep 0.6 ; osascript -l JavaScript -e '${RAISE_QL}' >/dev/null 2>&1 ) &`, 'sh', file])
      return {}
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
