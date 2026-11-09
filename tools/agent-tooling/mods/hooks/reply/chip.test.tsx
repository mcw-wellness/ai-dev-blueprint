import { expect, test } from 'claude-code/testing'
import type { FoundElement } from 'claude-code/testing'

import { BAND, session } from '../fixtures/band'

const REPLY = `Three decisions and a note.

🔴 **Needs you:**
1. **Ship it?** "yes" (recommended) or "no".
2. **Keep the demo?** "keep" (recommended) or "drop".
3. **The demo page.** Open it with \`! open ~/specs/demo.html\`.

\`\`\`draft
The demo ships.
\`\`\``

test('every chip is its own hover scope, softer than the crimson badge: hovered, its label shows the fill a press leads to', async ($, on) => {
  await session($, on, REPLY)
  const ui = await $.ui.mount(BAND)
  // A pick leaves decision 2 open, so nothing is sent: the session refuses a send.
  await ui.press({ key: 'd1:no' })
  const chips = ['d1:yes', 'd1:no', 'd2:drop', 'd3:open0', 'draft1:copy']
  const scopes = await Promise.all(chips.map(key => ui.find({ key: `${key}:hover` })))
  const lit = scopes.map(box => {
    const button = (box?.children as FoundElement[] | undefined)?.[0]
    // Children are drawn elements, whose `hover` sits beside their props.
    const label = (button?.children as (FoundElement & { hover?: unknown })[] | undefined)?.[0]
    return [box?.type, button?.props.key, label?.props.backgroundColor, label?.hover]
  })
  // Hover colors are written swapped, since the engine reverses a Button under the pointer.
  const toPicked = { color: 'selectionBg', backgroundColor: 'text' }
  expect(lit).toEqual([
    ['Box', 'd1:yes', 'diffAddedDimmed', toPicked],
    ['Box', 'd1:no', 'selectionBg', { color: 'userMessageBackground', backgroundColor: 'text' }],
    ['Box', 'd2:drop', 'userMessageBackground', toPicked],
    ['Box', 'd3:open0', 'userMessageBackground', toPicked],
    ['Box', 'draft1:copy', 'userMessageBackground', toPicked],
  ])
  // No chip in the badge's saturated colors.
  expect(scopes.map(box => JSON.stringify(box))).not.toContainEqual(expect.stringMatching(/"(suggestion|error|inverseText)"/))
  await ui.unmount()
})
