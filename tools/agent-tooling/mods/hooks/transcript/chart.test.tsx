import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { segments } from './blocks'
import { SECTION } from './chart'

const NOW = 1_793_000_000_000
const SESSION = 's1'
const XY = 'xychart-beta\n  title "p95"\n  x-axis [a, b]\n  line [1, 2]'
const FENCE = '```mermaid\n' + XY + '\n```'
const REPLY = `Latency halved after the pinning change.\n\n${FENCE}\n\nNext: roll it to prod.`

// What mermaid.py prints for a drawn fence: the picture, the cells it fills, its answer in one line.
const DRAWN = { file: '/tmp/agent-tooling-s1/reply/0-97.png', columns: 97, rows: 20, alt: 'p95: 1 at a to 2 at b' }

type Out = { exitCode: number; stdout: string; stderr: string }

/** `out`: what mermaid.py prints, or one answer per run in turn, the last for every run after. */
async function engine($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], env: Record<string, string> = {}, out: Out | Out[] = { exitCode: 0, stdout: JSON.stringify(DRAWN), stderr: '' }) {
  const clock = mock.clock(on, { now: NOW })
  const runs: { argv: string[]; stdin?: string }[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: SESSION }))
  on('session.messages', () => ({ value: [] }))
  on('env.get', (_, e) => ({ value: { TMPDIR: '/tmp/', ...env }[e.name] }))
  // The person's theme, `env.theme` (light when absent), and `/config` changing it.
  let theme = env.theme ?? 'light'
  const row = () => ({ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'engine', tier: 'core' }, isLocked: false }) as const
  on('config.list', () => ({ value: [row()] }))
  on('config.set', (_, e) => {
    theme = String(e.value)
    return { value: e.value }
  })
  on('process.run', (_, e) => {
    const drawing = e.argv.some(a => a.endsWith('mermaid.py'))
    if (drawing) runs.push({ argv: [...e.argv], stdin: e.init?.stdin })
    const outs = [out].flat()
    const said = outs[Math.min(runs.length, outs.length) - 1]!
    return { value: { ...(drawing ? said : { exitCode: 1, stdout: '', stderr: '' }), isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: false }) // starts the drawer
  return { clock, runs }
}

const message = (surface: 'terminal' | 'desktop', columns: number, text = REPLY, props: { isSummary?: true; onScreen?: null } = {}) =>
  ({
    plugin: 'agent-tooling',
    surface,
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true, ...props },
    viewport: { columns, rows: 50 },
  }) as const

test('segments: a closed mermaid fence of any diagram is a chart, with the prose around it kept as markdown', () => {
  expect(segments(REPLY)).toEqual([
    { kind: 'markdown', text: 'Latency halved after the pinning change.', indent: 0 },
    { kind: 'chart', text: FENCE, body: XY, indent: 0 },
    { kind: 'markdown', text: 'Next: roll it to prod.', indent: 0 },
  ])
  const gantt = '~~~~ mermaid\n%% plan\ngantt\n  a :done, 2026-10-26, 1d\n~~~~'
  expect(segments(gantt)).toEqual([{ kind: 'chart', text: gantt, body: '%% plan\ngantt\n  a :done, 2026-10-26, 1d', indent: 0 }])
  const flow = '```mermaid\nflowchart LR\n  a --> b\n```'
  expect(segments(flow)).toEqual([{ kind: 'chart', text: flow, body: 'flowchart LR\n  a --> b', indent: 0 }])
  // In tmux the hook asks for none: the fence stays markdown.
  expect(segments(REPLY, false)).toEqual([{ kind: 'markdown', text: REPLY, indent: 0 }])
})

test('segments: other languages, empty, unclosed or quoted fences, reference links and lazily numbered lists stay markdown', () => {
  for (const text of [
    '```mermaid\n%% only a comment\n```',
    '```python\nxychart-beta\n```',
    '```mermaid\nxychart-beta\n  line [1, 2]', // still streaming, or never closed
    '```mermaid\ngantt\n~~~',
    '```mermaid\n```',
    '````markdown\n```mermaid\nxychart-beta\n  line [1, 2]\n```\n````', // a chart quoted in another fence
    `See [the run][r].\n\n${FENCE}\n\n[r]: https://example.com`, // the definition serves the whole block
    `1. first\n\n   ${FENCE.replaceAll('\n', '\n   ')}\n\n1. second`, // split off, the list would restart
  ])
    expect(segments(text)).toEqual([{ kind: 'markdown', text, indent: 0 }])
})

test('a chart reply on the terminal shows the fence while mermaid.py draws it, then the picture in its place', async ($, on) => {
  const { clock, runs } = await engine($, on)
  const ui = await $.ui.mount(message('terminal', 100))
  expect(await ui.find({ type: 'Text', text: 'drawing chart…' })).toBeDefined()
  await clock.advance(500) // the drawer's next tick
  expect(runs).toHaveLength(1)
  const [argv] = runs.map(r => r.argv)
  expect(argv!.slice(0, 3)).toEqual(['uv', 'run', '--quiet'])
  expect(argv![3]?.endsWith('/charts/mermaid.py')).toBe(true)
  // Drawn to the reply's columns, the gutter and a spare column off, into this session's folder; the fence's body on stdin.
  expect(argv!.slice(4)).toEqual(['/tmp/agent-tooling-s1/reply/0-97.png', '97', 'light'])
  expect(runs[0]!.stdin).toBe(XY)
  const image = await ui.find({ type: 'Image' })
  expect(image?.props).toMatchObject({ source: { file: DRAWN.file, format: 'png', generation: NOW + 500 }, columns: 97, rows: 20, alt: DRAWN.alt })
  // The prose around it is the engine's markdown, its source characters unchanged; the fence is gone.
  // No ⏺ before the reply (Kei, 2026-10-29).
  expect(await ui.find({ type: 'Text', text: '⏺' })).toBeUndefined()
  const md = await ui.findAll({ type: 'Markdown' })
  expect(md.map(m => m.text)).toEqual(['Latency halved after the pinning change.', 'Next: roll it to prod.'])
  await ui.unmount()
  // Drawn once per fence and width: a second showing reads the picture already drawn.
  const again = await $.ui.mount(message('terminal', 100))
  await clock.advance(500)
  expect(runs).toHaveLength(1)
  expect(await again.find({ type: 'Image' })).toBeDefined()
})

test('off fullscreen the reply waits for its picture: rows printed once never show the fence', async ($, on) => {
  // The owner, 2026-10-27: `drawing chart…` and the fence stayed above the picture in the classic renderer.
  const { clock, runs } = await engine($, on)
  const classic = message('terminal', 100)
  const mounting = $.ui.mount({ ...classic, viewport: { ...classic.viewport, isFullscreen: false } })
  await clock.advance(500) // the drawer starts it, apart from the render that waits on it
  const ui = await mounting
  expect(runs).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: 'drawing chart…' })).toBeUndefined()
  expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({ alt: DRAWN.alt })
})

// A dark theme, or auto in a terminal COLORFGBG calls dark (the engine's own fallback), draws in the dark palette.
for (const [env, palette] of [
  [{ theme: 'dark-daltonized' }, 'dark'],
  [{ theme: 'auto', COLORFGBG: '15;0' }, 'dark'],
  [{ theme: 'auto' }, 'light'],
  [{ theme: 'auto', COLORFGBG: '0;15' }, 'light'],
] as const) {
  test(`${JSON.stringify(env)} draws in the ${palette} palette`, async ($, on) => {
    const { clock, runs } = await engine($, on, env)
    const ui = await $.ui.mount(message('terminal', 100))
    await clock.advance(500)
    expect(runs.map(r => r.argv[6])).toEqual([palette])
    await ui.unmount()
  })
}

test('a theme changed in /config draws the chart again in its palette', async ($, on) => {
  const { clock, runs } = await engine($, on)
  const ui = await $.ui.mount(message('terminal', 100))
  await clock.advance(500)
  await $.config.set({ key: 'theme', value: 'dark', previous: 'light', provider: { plugin: 'engine', tier: 'core' }, origin: { kind: 'composer' } })
  await clock.advance(500)
  expect(runs.map(r => r.argv[6])).toEqual(['light', 'dark'])
  await ui.unmount()
})

test('each width draws its own picture: 60, 100 and 200 columns', async ($, on) => {
  const { clock, runs } = await engine($, on)
  for (const columns of [60, 100, 200]) {
    const ui = await $.ui.mount(message('terminal', columns))
    await clock.advance(500)
    await ui.unmount()
  }
  // mermaid.py caps a chart's width by its kind; the hook hands it the room the reply has.
  expect(runs.map(r => r.argv[5])).toEqual(['57', '97', '197'])
})

test('a fence mermaid.py cannot draw says why above its source', async ($, on) => {
  const { clock } = await engine($, on, {}, { exitCode: 1, stdout: '', stderr: 'Traceback…\nseries of 3 and 2 values\n' })
  const ui = await $.ui.mount(message('terminal', 100))
  await clock.advance(500)
  expect(await ui.find({ type: 'Text', text: '⚠ chart: series of 3 and 2 values' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: FENCE })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
})

test('a failure but Mermaid’s refusal is tried once more at once, so even a reply printed once shows the picture', async ($, on) => {
  const timedOut = { exitCode: 1, stdout: '', stderr: 'error: request timed out\n' }
  const refused = { exitCode: 1, stdout: '', stderr: 'mermaid: Parse error on line 2\n' }
  const { clock, runs } = await engine($, on, {}, [timedOut, { exitCode: 0, stdout: JSON.stringify(DRAWN), stderr: '' }, refused, timedOut])
  // A cold `uv` times out once; the second try draws it before the reply prints off fullscreen.
  const classic = message('terminal', 100)
  const mounting = $.ui.mount({ ...classic, viewport: { ...classic.viewport, isFullscreen: false } })
  await clock.advance(500)
  expect((await (await mounting).find({ type: 'Image' }))?.props).toMatchObject({ alt: DRAWN.alt })
  expect(runs).toHaveLength(2)
  // Mermaid's refusal stands at once; any failure after a second try stands too. Neither is drawn again.
  for (const columns of [60, 60, 70, 70]) {
    await (await $.ui.mount(message('terminal', columns))).unmount()
    await clock.advance(500)
  }
  expect(runs.map(r => r.argv[5])).toEqual(['97', '97', '57', '67', '67'])
})

test('the desktop, tmux, a summary and a reply without a chart are drawn as the engine draws them', async ($, on) => {
  // Stands for the engine's own drawing, beneath the plugin.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const { clock, runs } = await engine($, on, { TMUX: '/tmp/tmux-501/default,1,0' })
  const cases = [message('desktop', 100), message('terminal', 100), message('terminal', 100, REPLY, { isSummary: true }), message('terminal', 100, 'No chart here.')]
  for (const m of cases) {
    const ui = await $.ui.mount(m)
    await clock.advance(500)
    expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['engine'] })
    await ui.unmount()
  }
  expect(runs).toHaveLength(0)
})

test('a chart scrolled out of view is not drawn until it shows', async ($, on) => {
  const { clock, runs } = await engine($, on)
  await $.ui.mount(message('terminal', 100, REPLY, { onScreen: null }))
  await clock.advance(500)
  expect(runs).toHaveLength(0)
})

test('the system prompt asks for charts only where a terminal draws them', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' as const }] }))
  const input = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', tools: [], outputStyle: null, traits: [] }
  const ids = async (surfaces: ('terminal' | 'desktop')[]) => (await $.prompt.compose({ ...input, surfaces })).sections.map(s => s.id)
  expect(await ids(['terminal', 'desktop'])).toContain(SECTION.id)
  expect(await ids(['desktop'])).not.toContain(SECTION.id)
})
