// Shell calls in the transcript. The engine folds a run of them into one `Ran 2 shell commands` line, which
// hides what ran and even a failure; this draws each call as its description and command, and a failed one
// with the tail of its output and its exit code. ctrl+o still shows every call in full.

import type { On, ToolGroupCall } from 'claude-code'

import { strip } from './blocks'

// A tail line that names the failure, drawn in the error color so it stands out from the run's chatter.
const FAILS = /^(FAILED|ERROR|Error:|error:|E +)/
/** Output lines kept from a failed call: the tail holds the failure. */
const TAIL = 3
/** Characters kept of one of them: it wraps, so its reason shows, but a minified line stays a few rows. */
const LINE_MAX = 240
/** A run longer than this shows its calls from the first failed or running one, at least the last `SHOWN`. */
const RUN_MAX = 8
const SHOWN = 3

type Failure = { tail: string[]; hidden: number; label: string }
type CallRow = { kind: 'call'; description: string; command: string; failure?: Failure; interrupted?: true }
type Row = CallRow | { kind: 'more'; count: number }

// Escape sequences and control characters go; a tab becomes spaces.
const clean = (text: string): string => strip(text).replace(/\t/g, '  ')
// A rule or a banner (`==== short test summary info ====`): mostly drawing characters, it says nothing.
const isRule = (line: string): boolean => {
  const ink = line.replace(/\s/g, '')
  return ink.replace(/[=\-_─━*~#+]/g, '').length * 2 < ink.length
}

/** A failed call's output: the engine's `Error: Exit code N` line becomes the label, the last lines the tail. */
export function failure(output: unknown): Failure {
  const text = typeof output === 'string' ? output : ''
  const code = /^(?:Error: )?Exit code (\d+)\n?/.exec(text)
  const lines = clean(code ? text.slice(code[0].length) : text.replace(/^Error: /, ''))
    .split('\n')
    .map(l => l.trimEnd())
  while (lines.length && !lines.at(-1)) lines.pop()
  const tail = lines.filter(l => l && !isRule(l)).slice(-TAIL)
  const cut = tail.map(l => (l.length > LINE_MAX ? `${l.slice(0, LINE_MAX - 1)}…` : l))
  return { tail: cut, hidden: lines.length - tail.length, label: code ? `Exit code ${code[1]}` : 'failed' }
}

function row(call: ToolGroupCall, home: string): CallRow {
  const input = (call.input ?? {}) as { command?: unknown; description?: unknown }
  // The home directory as `~`, so a narrow row keeps the command's verb rather than the path to it.
  const command = clean(String(input.command ?? '')).trim()
  const short = home ? command.split(`${home}/`).join('~/') : command
  const [first = '', ...rest] = short.split('\n')
  const out: CallRow = {
    kind: 'call',
    description: clean(String(input.description ?? '')).trim(),
    command: rest.length ? `${first} …` : first,
  }
  if (call.isInterrupted) out.interrupted = true
  else if (call.isErrored) out.failure = failure(call.output)
  return out
}

/** The rows of a run of shell calls, in the order they ran; a long run counts the calls that succeeded before it shows. */
export function bashRows(calls: readonly ToolGroupCall[], home = ''): Row[] {
  const open = calls.findIndex(c => c.isErrored || c.isInterrupted || c.isRunning)
  const start = calls.length <= RUN_MAX ? 0 : Math.min(calls.length - SHOWN, open < 0 ? Infinity : open)
  const shown = calls.slice(start).map(c => row(c, home))
  return start ? [{ kind: 'more', count: start }, ...shown] : shown
}

export function tools(on: On): void {
  // A run of shell calls alone; any other row the group holds (a recalled memory, a hook's time) keeps the stock line.
  // A failed run is drawn even so: the engine's isCallsOnly is false for a failure and another row alike, and the
  // failure is what must show.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const { calls, isExpanded, isCallsOnly } = e.props
    const failed = calls.some(c => c.isErrored || c.isInterrupted)
    if (isExpanded || !calls.length || calls.some(c => c.tool !== 'Bash') || !(isCallsOnly || failed)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const line = (r: Row, i: number) => {
      if (r.kind === 'more') return <Text key={`more${i}`} color="inactive">{`+${r.count} earlier succeeded`}</Text>
      const what = r.description || r.command
      // Quieter than the reply's own text: only a failure's exit code is colored.
      const head = (
        <Text key={`call${i}`} wrap="truncate-end" color="inactive">
          {what}
          {r.description && r.command ? <Text color="subtle">{` · ${r.command}`}</Text> : null}
          {r.interrupted ? <Text color="warning">{'  interrupted'}</Text> : null}
        </Text>
      )
      if (!r.failure) return head
      // How it ended leads, then the lines it ended on.
      const { tail, hidden, label } = r.failure
      return (
        <Box key={`call${i}`} flexDirection="column">
          {head}
          <Text wrap="truncate-end">
            <Text color="subtle">{'⎿ '}</Text>
            <Text color="error" bold>
              {label}
            </Text>
            {hidden ? <Text color="subtle">{` · +${hidden} lines`}</Text> : null}
          </Text>
          <Box flexDirection="column" marginLeft={2}>
            {tail.map((text, j) => (
              <Text key={`out${j}`} color={FAILS.test(text) ? 'error' : 'subtle'}>
                {text}
              </Text>
            ))}
          </Box>
        </Box>
      )
    }
    // Placed as the stock line is: a row under the reply's text, indented to it.
    return (
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        {bashRows(calls, (await $.env.get('HOME')) ?? '').map(line)}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
