import type { ToolGroupCall } from 'claude-code'
import type { TestBody } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

import { bashRows, failure } from './tools'

// Calls as the engine handed them to a ToolGroup on 2026-10-26 (2.1.310), outputs trimmed.
const call = (description: string, command: string, more: Partial<ToolGroupCall> = {}): ToolGroupCall => ({
  tool: 'Bash',
  input: { command, description },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: { stdout: 'ok', stderr: '', interrupted: false },
  ...more,
})
const PYTEST = [
  'Error: Exit code 1',
  '.................F......                                                 [100%]',
  '\u001b[31m================== FAILURES ==================\u001b[0m',
  'E       AssertionError: row of 77 columns overflows the 76-column pane',
  '',
  'test_fail.py:7: AssertionError',
  '=========== short test summary info ===========',
  'FAILED test_fail.py::test_fold_width[17] - AssertionError: row of 77 columns overflows the 76-col...',
  '1 failed, 23 passed in 0.01s',
  '',
].join('\n')
const LOG = call('Show the last three commits', 'git -C /Users/me/agent-tooling log --oneline -3')
const WIDTH = call('Run the width tests', 'uvx --quiet pytest -q test_fail.py', { isErrored: true, output: PYTEST })
const REFUSED = call('Stop the capture', 'pkill -f capture', {
  isErrored: true,
  output: 'Error: PreToolUse:Bash hook error: Blocked by the shell guard: stop a process by its PID',
})

test("a failed call keeps its output's tail but rules and banners, counts the rest and says its exit code", () => {
  expect(failure(PYTEST)).toEqual({
    tail: [
      'test_fail.py:7: AssertionError',
      'FAILED test_fail.py::test_fold_width[17] - AssertionError: row of 77 columns overflows the 76-col...',
      '1 failed, 23 passed in 0.01s',
    ],
    hidden: 5,
    label: 'Exit code 1',
  })
  // Escapes are stripped; a minified line is cut, since the rows it wraps to are the transcript's.
  expect(failure('Error: Exit code 3\n\u001b[1mboom\u001b[0m\u0007')).toEqual({ tail: ['boom'], hidden: 0, label: 'Exit code 3' })
  expect(failure(`Exit code 1\n${'x'.repeat(1000)}`).tail[0]).toHaveLength(240)
  // A refusal has no exit code: its own words are the tail.
  expect(failure(REFUSED.output)).toEqual({
    tail: ['PreToolUse:Bash hook error: Blocked by the shell guard: stop a process by its PID'],
    hidden: 0,
    label: 'failed',
  })
})

test('a long run shows, in order, its calls from the first failed or running one and at least the last three', () => {
  const ok = (n: number) => call(`Step ${n}`, `step ${n}`)
  const shown = (calls: ToolGroupCall[]) => bashRows(calls).map(r => (r.kind === 'more' ? `+${r.count}` : r.description))
  const running = { ...ok(8), isRunning: true, output: undefined }
  const oks = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ok(from + i))
  expect(shown([...oks(1, 4), WIDTH, ...oks(6, 9)])).toEqual(['+4', 'Run the width tests', 'Step 6', 'Step 7', 'Step 8', 'Step 9'])
  expect(shown([...oks(1, 4), running, ...oks(9, 12)])).toEqual(['+4', 'Step 8', 'Step 9', 'Step 10', 'Step 11', 'Step 12'])
  expect(shown(oks(1, 9))).toEqual(['+6', 'Step 7', 'Step 8', 'Step 9'])
  expect(shown(oks(1, 8))).toHaveLength(8) // eight rows fit: no count
  // A heredoc reads as its first line; a call without a description as its command.
  const [heredoc] = bashRows([call('', "python3 - <<'EOF'\nprint(1)\nEOF")])
  expect(heredoc).toEqual({ kind: 'call', description: '', command: "python3 - <<'EOF' …" })
})

// Drawn: the stock line beneath stands for the engine's own.
const STOCK = 'Ran 2 shell commands'
const GROUP = { plugin: 'agent-tooling', surface: 'terminal', component: 'ToolGroup' } as const
const props = (calls: ToolGroupCall[], more: { isExpanded?: boolean; isCallsOnly?: boolean } = {}) => ({
  calls,
  isActive: false,
  isExpanded: false,
  isCallsOnly: !calls.some(c => c.isErrored),
  ...more,
})
function stock(on: Parameters<TestBody>[1]) {
  on('env.get', () => ({ value: '/Users/me' }))
  on('ui.render', { component: 'ToolGroup' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{STOCK}</Text>
  })
}

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
/** Each drawn line (a Text not inside a Text) with its whole text and how it wraps. */
function lines(node: unknown, out: { text: string; wrap: unknown; color: unknown }[] = []) {
  const n = node as Node
  const text = (m: unknown): string => (typeof m === 'string' ? m : ((m as Node).children ?? []).map(text).join(''))
  if (n?.type === 'Text') out.push({ text: text(n), wrap: n.props?.wrap, color: n.props?.color })
  else for (const c of n?.children ?? []) lines(c, out)
  return out
}

for (const columns of [60, 100, 200]) {
  test(`at ${columns} columns: each call a line, a failure its exit code and tail; a row is cut at the edge, output wraps`, async ($, on) => {
    stock(on)
    const viewport = { columns, rows: 40, isFullscreen: true }
    const ui = await $.ui.mount({ ...GROUP, viewport, props: props([LOG, WIDTH]) })
    const drawn = lines(await ui.drawn())
    expect(drawn.map(l => l.text)).toEqual([
      'Show the last three commits · git -C ~/agent-tooling log --oneline -3', // the home as ~
      'Run the width tests · uvx --quiet pytest -q test_fail.py',
      '⎿ Exit code 1 · +5 lines',
      'test_fail.py:7: AssertionError',
      'FAILED test_fail.py::test_fold_width[17] - AssertionError: row of 77 columns overflows the 76-col...',
      '1 failed, 23 passed in 0.01s',
    ])
    expect(await ui.find({ type: 'Text', text: /^Exit code 1$/ })).toMatchObject({ props: { color: 'error' } })
    // The line that names the failure is in the error color; the rest of the tail stays quiet.
    expect(await ui.find({ type: 'Text', text: /^FAILED test_fail/ })).toMatchObject({ props: { color: 'error' } })
    expect(await ui.find({ type: 'Text', text: /^1 failed/ })).toMatchObject({ props: { color: 'subtle' } })
    // A call's row and the exit code's are cut at the transcript's edge; output wraps, so the reason shows whole.
    for (const l of drawn.slice(0, 3)) expect(l.wrap).toBe('truncate-end')
    expect(await ui.find({ text: STOCK })).toBeUndefined()
    await ui.unmount()
  })
}

test('the stock line stays for ctrl+o, a run with other tools, and a group holding other rows', async ($, on) => {
  stock(on)
  const READ: ToolGroupCall = { ...LOG, tool: 'Read', input: { file_path: '/x' } }
  for (const p of [props([LOG], { isExpanded: true }), props([LOG, READ]), props([LOG], { isCallsOnly: false })]) {
    const ui = await $.ui.mount({ ...GROUP, props: p })
    expect(await ui.find({ text: STOCK })).toBeDefined()
    await ui.unmount()
  }
  // On the desktop too: the rows are Text and Box alone.
  const ui = await $.ui.mount({ ...GROUP, surface: 'desktop', props: props([LOG, REFUSED]) })
  expect(await ui.find({ text: 'failed' })).toBeDefined()
  await ui.unmount()
})
