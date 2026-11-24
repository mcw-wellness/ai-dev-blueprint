import { expect, test } from 'claude-code/testing'

import { BAND, session } from '../fixtures/band'
import { copyArgv, drafts, firstLine, html, text } from './draft'
import { needsYou } from './parse'

// A reply as the writing skill asks for one: a decision, and the message the owner sends in a draft fence.
const REPLY = `Done. The note for #updates is below.

🔴 **Needs you:**
1. **Post the note?** "posted" (recommended) or "later".

\`\`\`draft
**Renderer:** tables fit the column ([#86](https://github.com/x/y/pull/86)).

- Charts draw as pictures
  - in kitty only
- \`/cockpit\` shows <every> thread & its plan
1. first
2. second

> quoted line
\`\`\`

Not a draft:

\`\`\`
echo hi
\`\`\``

const BODY = REPLY.split('```draft\n')[1]!.split('\n```')[0]!

test('a reply’s drafts are its closed draft fences, in order; other fences and an unclosed one are none', () => {
  const bodies = (answer: string) => drafts(answer).map(d => d.body)
  expect(bodies(REPLY)).toEqual([BODY])
  expect(bodies('```draft\nA\n```\n\n```draft\nB\n```')).toEqual(['A', 'B'])
  expect(bodies('```\nA\n```\n\n```draft\nB')).toEqual([])
  // Fences in a row under a numbered decision are its replies (`parse.ts`); one fence, one holding two lines, or fences
  // under no numbered decision are messages to send.
  const glue = (fences: string) => `🔴 **Needs you:**\n1. **Ship?** Reply "ship" or "wait".\n2. **Where glue goes.**\n${fences}`
  expect(bodies(glue('```draft\nin fair/\n```\n\n```draft\nin interface/\n```'))).toEqual([])
  expect(bodies(glue('```draft\nin fair/\n```'))).toEqual(['in fair/'])
  expect(bodies(glue('```draft\nglue\nin fair/\n```\n```draft\nin interface/\n```'))).toHaveLength(2)
  expect(bodies('🔴 **Needs you:** send these.\n```draft\nA\n```\n```draft\nB\n```')).toEqual(['A', 'B'])
  expect(firstLine(BODY)).toBe('Renderer: tables fit the column (#86).')
})

test('the HTML pastes as formatted: bold, links, code, nested lists, quotes, all text escaped', () => {
  expect(html(BODY)).toBe(
    '<meta charset="utf-8">' +
      '<p><b>Renderer:</b> tables fit the column (<a href="https://github.com/x/y/pull/86">#86</a>).</p>' +
      '<ul><li>Charts draw as pictures<ul><li>in kitty only</li></ul></li>' +
      '<li><code>/cockpit</code> shows &lt;every&gt; thread &amp; its plan</li></ul>' +
      '<ol><li>first</li><li>second</li></ol>' +
      '<blockquote>quoted line</blockquote>',
  )
  // A paragraph's lines stay lines, as a Slack message keeps them; code stays as written.
  expect(html('Hi Kei,\nthe release is out.\n\n```\na < b\n```')).toBe('<meta charset="utf-8"><p>Hi Kei,<br>the release is out.</p><pre>a &lt; b</pre>')
  // Only a bare fence closes one, as in the transcript: a fence line with an info string inside a block is code.
  expect(html('```\n```js\nx\n```\nafter')).toBe('<meta charset="utf-8"><pre>```js\nx</pre><p>after</p>')
})

test('the plain-text fallback drops the marks, keeps list marks and a link’s target', () => {
  expect(text(BODY)).toBe(
    [
      'Renderer: tables fit the column (#86 (https://github.com/x/y/pull/86)).',
      '',
      '- Charts draw as pictures',
      '  - in kitty only',
      '- /cockpit shows <every> thread & its plan',
      '1. first',
      '2. second',
      '',
      '> quoted line',
    ].join('\n'),
  )
})

test('the copy is one osascript call setting the HTML and the plain text, never through a shell', () => {
  const argv = copyArgv(BODY)
  expect(argv.slice(0, 4)).toEqual(['osascript', '-l', 'JavaScript', '-e'])
  expect(argv[4]).toContain('$.NSPasteboard.generalPasteboard')
  expect(argv[4]).toContain('setStringForType($(argv[0]), $.NSPasteboardTypeHTML)')
  expect(argv[4]).toContain('setStringForType($(argv[1]), $.NSPasteboardTypeString)')
  expect(argv.slice(5)).toEqual([html(BODY), text(BODY)])
})

test('a draft is a band row after the decisions: its copy chip copies it again on every press', async ($, on) => {
  const { ran, toasts } = await session($, on, REPLY)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /1 decision · 1 draft/ })).toBeDefined()
  expect((await ui.find({ key: 'draft1' }))?.text).toMatch(/^ 2  Draft: Renderer: tables fit the column \(#86\)\.\s*copy\s*dismiss$/)
  const copy = await ui.find({ key: 'draft1:copy' })
  expect(copy?.props).toMatchObject({ label: 'copy' })
  // The same tint as a reply chip.
  expect((copy?.children as { props: Record<string, unknown> }[])[0]?.props).toMatchObject({ backgroundColor: 'userMessageBackground' })
  await ui.press({ key: 'draft1:copy' })
  await ui.press({ key: 'draft1:copy' })
  expect(ran).toEqual([copyArgv(BODY), copyArgv(BODY)])
  expect(toasts).toEqual(Array(2).fill('Copied as rich text: Renderer: tables fit the column (#86).'))
  await ui.unmount()
})

test('drafts alone raise the band, numbered from 1; a failed copy says why', async ($, on) => {
  const answer = 'Done. Two drafts.\n\n```draft\nFirst.\n```\n\n```draft\nSecond.\n```'
  const { ran, toasts } = await session($, on, answer, 1)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /^\s+2 drafts$/ })).toBeDefined()
  await ui.press({ key: 'draft2:copy' })
  expect(ran).toEqual([copyArgv('Second.')])
  expect(toasts).toEqual(['Draft not copied: no pasteboard'])
  await ui.unmount()
})

test('a page to open is an open chip in its band row; a press opens it, a window the toast need not announce; only links and pages open', async ($, on) => {
  const answer = '🔴 **Needs you:**\n4. **Data platform redesign.** Open the page with `! open ~/specs/redesign.html`.'
  const { ran, toasts } = await session($, on, answer)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'd4:open0' })
  expect([ran, toasts]).toEqual([[['open', '/Users/o/specs/redesign.html']], []])
  await ui.unmount()
  expect(needsYou('🔴 **Needs you:** see `open https://example.com/a`; not `open run.command`.')[0]?.opens).toEqual(['https://example.com/a'])
})

test('a local page with an anchor is an open chip; a press hands its file URL, anchor kept, to the default browser', async ($, on) => {
  const answer = '🔴 **Needs you:**\n1. **Layout.** Read `! open ~/specs/layout.html#target`.'
  const { ran } = await session($, on, answer)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'd1:open0' })
  expect(ran.map(argv => [argv[0], argv.at(-1)])).toEqual([['osascript', 'file:///Users/o/specs/layout.html#target']])
  await ui.unmount()
})

test('on Linux a copy is the draft verbatim (Slack markup kept) through the engine’s own copy, which reaches the laptop over ssh and tmux', async ($, on) => {
  const answer = 'Send this:\n\n```draft\nHi *Wendelin*, it runs.\n```'
  const { ran, toasts, copied } = await session($, on, answer, 0, 'Linux')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'draft1:copy' })
  expect([ran, copied, toasts]).toEqual([[], ['Hi *Wendelin*, it runs.'], [expect.stringMatching(/^Copied: Hi/)]])
  await ui.unmount()
})

test('on a Linux desktop a page opens with xdg-open, an anchored file as its file URL; over ssh, with no desktop, a toast says so', async ($, on) => {
  const answer = '🔴 **Needs you:**\n1. **Layout.** Read `! open ~/specs/layout.html#target`.'
  const desk = await session($, on, answer, 0, 'Linux', { WAYLAND_DISPLAY: 'wayland-0' })
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'd1:open0' })
  expect(desk.ran).toEqual([['xdg-open', 'file:///Users/o/specs/layout.html#target']])
  await ui.unmount()
})

test('over ssh, with no desktop, the open chip opens nothing and says so', async ($, on) => {
  const answer = '🔴 **Needs you:**\n1. **Layout.** Read `! open ~/specs/layout.html`.'
  const box = await session($, on, answer, 0, 'Linux')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'd1:open0' })
  expect([box.ran, box.toasts]).toEqual([[], ['No desktop here to open it on: ~/specs/layout.html']])
  await ui.unmount()
})
