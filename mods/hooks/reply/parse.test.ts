import { expect, test } from 'claude-code/testing'

import { NEEDS } from '../fixtures/needs'
import { itemsSaid, needsYou, nothingNeeded, offers, quotable } from './parse'
import { BOLD_RED, NUMBERED, QUALIFIED, QUOTA } from '../fixtures/blocks'

test('a bold title ending in a full stop, then its quoted replies, offers them', () => {
  const asked = needsYou('🔴 **Needs you:**\n1. **Cap.** "25" (recommended) or "50"\n2. **Deploy.** "go: deploy paper hype_fade" or "hold"')
  expect(asked[1]).toMatchObject({ title: 'Deploy', options: ['go: deploy paper hype_fade', 'hold'] })
})

test('only a reply the agent quotes and offers is a chip; the rest is answered in words', () => {
  const asked = needsYou('🔴 **Needs you:**\n1. **Decision B** now has a concrete design: LOG.html becomes your one page.\n2. **Codex sign-in** is still to redo.')
  expect(asked.map(d => d.options)).toEqual([[], []])
  // A recommendation never quoted stars nothing; a quoted label, a placeholder or a pair named together is no reply.
  expect(needsYou('🔴 **Needs you:** raise the quota? I recommend it.')[0]).toMatchObject({ options: [], recommended: undefined })
  expect(needsYou('🔴 **Needs you:** the extension offers only "Allow all sites" or "Block all sites"; which?')[0]?.options).toEqual([])
  expect(needsYou('🔴 **Needs you:** Reply "move control at <time>" or "not now".')[0]?.options).toEqual(['not now'])
  const pair = '🔴 **Needs you:** keep "Realized PnL" and "Unrealized PnL change" (recommended): reply "rename: PnL" or "keep".'
  expect(needsYou(pair)[0]?.options).toEqual(['rename: PnL', 'keep'])
})

test('a 🔴 line introducing items that each offer replies leaves each a decision, numbered as the message numbers it', () => {
  const two = '🔴 **Needs you:** two decisions.\n2. **Port take?** "port take" (recommended) or "keep take".\n3. **Shadow?** "stop the shadow" or "native shadow" (recommended).'
  expect(needsYou(two).map(d => [d.n, d.title, d.options, d.recommended])).toEqual([
    [2, 'Port take?', ['port take', 'keep take'], 'port take'],
    [3, 'Shadow?', ['stop the shadow', 'native shadow'], 'native shadow'],
  ])
  // Replies a blank line below the question still answer it; the point drops the replies its chips show.
  const below = '🔴 **Needs you:** may the checks refresh the host bundle on London?\n\nReplies: "go: refresh London" or "keep the hold" (recommended).'
  expect(needsYou(below)[0]?.options).toEqual(['go: refresh London', 'keep the hold'])
  expect(needsYou('🔴 **Needs you:** Keep the demo: "keep" (recommended) or "drop".')[0]?.title).toBe('Keep the demo')
  expect(needsYou('🔴 **Needs you (optional):**\n1. **A?** Reply "a".\n2. **B?** Reply "b".').map(d => d.title)).toEqual(['A?', 'B?'])
})

// The owner's 2026-10-27 block (obs-simplify): options as bullets, and a recommendation named in an aside.
test('a bullet opening with its quoted reply offers it; an aside recommending one recommends it', () => {
  const block = `🔴 **Needs you:**

1. **Take-leg panels for native make_take.** Reply "build make_take panels when #995 lands" (recommended) or "not now".
2. **Python-only Grafana code once the last Python Polymarket instance stops.**
   - "delete Python code" (recommended): less code, and old Python runs show only generic panels.
   - "keep Python code": old Python runs stay fully viewable, and the dead code stays.
3. **Tardis meter journal read:** Reply "leave it" (the fixer recommends this) or "fix the journal read".`
  expect(needsYou(block).map(d => [d.options, d.recommended])).toEqual([
    [['build make_take panels when #995 lands', 'not now'], 'build make_take panels when #995 lands'],
    [['delete Python code', 'keep Python code'], 'delete Python code'],
    [['leave it', 'fix the journal read'], 'leave it'],
  ])
})

test('a reply advised against is never the recommended one', () => {
  const [d] = needsYou(`🔴 **Needs you:**\n1. **Fix the branch.** Reply "force-push" (not recommended) or "rebase" (recommended).`)
  expect(d?.recommended).toBe('rebase')
  for (const aside of ["(I wouldn't recommend this)", '(don’t recommend)', '(never recommended)'])
    expect(needsYou(`🔴 **Needs you:**\n1. **Fix the branch.** Reply "force-push" ${aside} or "rebase".`)[0]?.recommended).toBeUndefined()
  const [quoted] = needsYou(`🔴 **Needs you:**\n1. **The SSM failure.**\n   - "permission denied" from SSM, twice.\n   Reply "retry" or "skip".`)
  expect(quoted?.options).toEqual(['retry', 'skip'])
})

// The owner's 2026-10-27 block (rust-taking): the recommended reply was 79 characters and drew no chip.
test('a long quoted reply is still a chip', () => {
  const [d] = needsYou(
    `🔴 **Needs you:**\n1. **The journal grant is blocked.** Reply "exception: infra.aws#2866 may ride a testing Release through the London/Dublin hold" (recommended), "lift the hold: I'll merge infra.aws#2842", or "wait until the cutover".`,
  )
  expect(d?.recommended).toBe('exception: infra.aws#2866 may ride a testing Release through the London/Dublin hold')
  expect(d?.options).toHaveLength(3)
})

// Real blocks (10-25, 10-23): a message or a quota name quoted after a colon is no reply.
test('a quote after a colon is a reply only after a reply word or an `or …:` clause', () => {
  const tried = '🔴 **Needs you:** the Swift tests run nowhere.\n- Hosted jobs are refused. I tried one at 19:19Z: "recent account payments have failed".'
  expect(needsYou(tried).map(d => d.options)).toEqual([[]])
  expect([...offers(tried)]).toEqual([])
  const quota = '🔴 **Needs you:** five decisions:\n- **D5:** this needs an on-demand quota increase: "Running On-Demand Standard instances" (L-1216C47A).'
  expect(needsYou(quota).map(d => d.options)).toEqual([[]])
  expect(needsYou('🔴 **Needs you:** "Running On-Demand" (L-1216C47A) needs an increase: reply "ok".')[0]?.options).toEqual(['ok'])
  expect(needsYou('🔴 **Needs you:** which size: "5 shares" or "1 share"?')[0]?.options).toEqual(['5 shares', '1 share'])
  expect(needsYou('🔴 **Needs you:** Replies: "keep" or "drop".')[0]?.options).toEqual(['keep', 'drop'])
  expect(needsYou('🔴 **Needs you:** block the sites. Or accept the risk: "accept G-7".')[0]?.options).toEqual(['accept G-7'])
})

// The owner's 10-26 block: decisions numbered as bold paragraphs, as AGENTS Writing numbers them.
test('decisions numbered in bold paragraphs are each a decision; a section numbered afresh after them is not', () => {
  const block = `🔴 **Needs you:**

**1. Send the email.** Address it to support@polymarket.com.

**2. Decide whether to keep "colocated in London" in the email.** It could get a geoblock review. Reply \`"drop London"\` (recommended) or \`"keep London"\`.

> Hi Polymarket team,`
  expect(needsYou(block)).toEqual([
    { n: 1, title: 'Send the email', options: [], recommended: undefined },
    { n: 2, title: 'Decide whether to keep "colocated in London" in the email', options: ['drop London', 'keep London'], recommended: 'drop London' },
  ])
  const report = '🔴 **Needs you:**\n1. **Approve #38.**\n2. **Send Kei the reply.**\n\n**1. ro02 weekdays: ready**\n- **Name check:** fine.'
  expect(needsYou(report).map(d => d.title)).toEqual(['Approve #38', 'Send Kei the reply'])
})

test('a quoted reply on a line of its own is a reply', () => {
  for (const line of ['`"go: restart live hype_fade"`', '"go: restart live hype_fade"', '"go: restart live hype_fade".'])
    expect(needsYou(`🔴 **Needs you:**\n1. **Go.** It stops B3.\n   ${line}`)[0]?.options).toEqual(['go: restart live hype_fade'])
  expect(needsYou('🔴 **Needs you:** restart it. It stops B3. "go: restart"')[0]?.options).toEqual(['go: restart'])
})

test('an example in a ~~~ fence asks nothing, as in a ``` one; `Needs you: nothing.` says nothing is needed', () => {
  for (const fence of ['```', '~~~']) expect(needsYou(`Done. The format:\n\n${fence}\n🔴 **Needs you:**\n1. **Merge?** "go" or "wait"\n${fence}`)).toEqual([])
  for (const none of ['🔴 **Needs you:** nothing.', 'Needs you: nothing.', '**🔴 Needs you:** **None.**']) expect(nothingNeeded(`Done.\n\n${none}`)).toBe(true)
  for (const some of ['🔴 **Needs you:** nothing new; O-31 is still open.', '> Needs you: nothing.', '```\nNeeds you: nothing.\n```', 'Done.'])
    expect(nothingNeeded(some)).toBe(false)
})

// The owner's 2026-10-27 screenshot: two drafts, each one reply, under one decision.
test('two or more draft fences under a numbered decision are its quoted replies; a lone fence stays a draft', () => {
  const glue = (fences: string) => `🔴 **Needs you:**\n1. **Ship?** Reply "ship" or "wait".\n2. **Where glue goes.** Recommended: \`fair/\`.\n${fences}`
  const both = glue('```draft\nglue in fair/\n```\n\n```draft\nglue in interface/\n```')
  expect(needsYou(both).map(d => [d.n, d.title, d.options])).toEqual([
    [1, 'Ship?', ['ship', 'wait']],
    [2, 'Where glue goes', ['glue in fair/', 'glue in interface/']],
  ])
  // Each chip on its fence's text line, where the reply draws it.
  expect([...offers(both).keys()]).toEqual([1, 4, 8])
  // A block that is one decision, its 🔴 line saying what is needed over a numbered item, reads them too.
  const one = '🔴 **Needs you:** one call:\n1. **Where glue goes.**\n```draft\nin fair/\n```\n```draft\nin interface/\n```'
  expect(needsYou(one).map(d => d.options)).toEqual([['in fair/', 'in interface/']])
})

test('the shared Needs-you cases: each message asks as many decisions as notify_status.py, which runs the same file, counts', () => {
  for (const c of NEEDS) expect([c.case, needsYou(c.message).length]).toEqual([c.case, c.decisions])
})

const INLINE = `🔴 **Needs you:** still open. Reply "obs-follow 1", "2" or "3" to decide whether research Grafana follows testing. I recommend 1.`

const STEPS = `🔴 **Needs you:** restart mm-live onto the new release. On the control page:
1. Click **Stop**, then "Stop live". Positions hold to settlement.
2. Once it shows Stopped, click **Start**.

Then tell me "started".`

const RULE = `🔴 **Needs you:**
1. **Raise the spot quota?** "yes, to 256" (recommended) or "no"`

test('a bold 🔴 line parses as a plain one: each item a decision, quotes in code marks offered', () => {
  const want = [
    { n: 1, title: 'Remove Closable?', options: ['drop Closable', 'keep Closable'], recommended: 'drop Closable' },
    {
      n: 2,
      title: "G-7: in Claude in Chrome's site permissions, block app.slack.com and www.notion.so",
      options: ['accept G-7'],
      recommended: undefined,
    },
    { n: 3, title: 'Restructure the skills (14 to 9, flat skills/)?', options: ['go skills', 'no'], recommended: 'go skills' },
    { n: 4, title: 'Cockpit charts: run the command below, then /cockpit, and tell me how it looks', options: [], recommended: undefined },
  ]
  expect(needsYou(BOLD_RED)).toEqual(want)
  for (const red of ['🔴 **Needs you:**', '🔴 Needs you:']) expect(needsYou(BOLD_RED.replace('**🔴 Needs you:**', red))).toEqual(want)
})

test('a 🔴 Needs you mark opens a line; one in a sentence or a quoted draft asks nothing', () => {
  const asks = (mark: string) => needsYou(`${mark}\n1. **Merge?** "yes" (recommended) or "no"`).map(d => d.title)
  for (const mark of ['🔴 **Needs you**:', '🔴 Needs you (2):', '## 🔴 Needs you']) expect(asks(mark)).toEqual(['Merge?'])
  expect(needsYou('No 🔴 Needs you items remain; "yes" (recommended) was taken.')).toEqual([])
  expect(needsYou('Drafted for Kei:\n\n> 🔴 **Needs you:** approve? "yes" (recommended) or "no"')).toEqual([])
  // On a list item the mark asks too, and its block is that item's own lines, not its siblings'.
  const listed = '- Merged #12.\n- 🔴 **Needs you:** **Stop mm-live.** Reply "go" or "keep".\n  It holds no position.\n- Then tell me "started".'
  expect(needsYou(listed)).toEqual([{ n: 1, title: 'Stop mm-live', options: ['go', 'keep'], recommended: undefined }])
  expect(needsYou('Steps:\n  2. 🔴 Needs you: rotate the key.').map(d => d.title)).toEqual(['Rotate the key'])
  for (const under of ['+ 🔴 Needs you: rotate the key.', '- Deploy.\n  🔴 Needs you: rotate the key.'])
    expect(needsYou(`${under}\n- Then tell me "started".`).map(d => d.options)).toEqual([[]])
  expect(needsYou('- Deploy.\n  🔴 Needs you: rotate the key.\n  Reply "go" or "keep".').map(d => d.options)).toEqual([['go', 'keep']])
  // A mark saying nothing is needed asks nothing; the tab stays as it was.
  for (const none of ['nothing.', 'nothing new.', '**None.**']) expect(needsYou(`🔴 **Needs you:** ${none}`)).toEqual([])
  expect(needsYou('🔴 **Needs you:** none of this blocks; reply "a" or "b".').map(d => d.options)).toEqual([['a', 'b']])
})

test('numbered decisions take their point, offered replies and recommendation', () => {
  expect(needsYou(NUMBERED)).toEqual([
    { n: 1, title: 'Live d5 maximum position: 1 or 5 shares?', options: ['5', '1'], recommended: '5' },
    {
      n: 2,
      title: 'DIFF-15: at the position cap, should native count a dust remainder as already gone?',
      options: ['yes', 'no'],
      recommended: 'yes',
    },
    { n: 3, title: "Codex's Notion sign-in is still to redo", options: [], recommended: undefined },
  ])
  expect(needsYou(RULE)[0]).toEqual({ n: 1, title: 'Raise the spot quota?', options: ['yes, to 256', 'no'], recommended: 'yes, to 256' })
  // A short sentence takes the next as its point, but never one that offers the replies its chips show.
  const reload = '🔴 **Needs you:**\n1. **Reload the renderer:** run `/reload-plugins`. "reloaded" (recommended) or "later".'
  expect(needsYou(reload)[0]?.title).toBe('Reload the renderer: run /reload-plugins')
})

test('free-form blocks: quoted replies, a recommendation by its short form, steps as one action answered in words', () => {
  const [obs] = needsYou(INLINE)
  expect(obs?.options).toEqual(['obs-follow 1', 'obs-follow 2', 'obs-follow 3'])
  expect(obs?.recommended).toBe('obs-follow 1')
  // The 🔴 line says what is needed: its steps are one action; a button's quoted label is no reply.
  expect(needsYou(STEPS)).toEqual([
    { n: 1, title: 'Restart mm-live onto the new release', options: [], recommended: undefined },
  ])
  expect(needsYou('All done, nothing needs you.')).toEqual([])
  // An example in a fence asks nothing; a reply named exactly wins over one it ends.
  expect(needsYou('```\n🔴 **Needs you:** "yes" (recommended)\n```')).toEqual([])
  expect(needsYou('🔴 **Needs you:** Reply "do not proceed" or "proceed". I recommend proceed.')[0]?.recommended).toBe('proceed')
})

test('a 🔴 line that only qualifies its list leaves each item a decision', () => {
  // A bold lead followed by an aside is the point without it.
  expect(needsYou(QUALIFIED).map(d => d.title)).toEqual([
    'Keep the old size targets or restate them?',
    'Drop the proxy signature type',
    'Bigger structural options: paper as its own process, about −940 lines',
  ])
  // `(recommended, the honest bar)` recommends as `(recommended)` does.
  expect(needsYou(QUALIFIED)[0]?.recommended).toBe('restate the targets')
  expect(needsYou(QUALIFIED).map(d => [d.n, d.options])).toEqual([
    [1, ['restate the targets', 'keep the old targets']],
    [2, ['drop type 1', 'keep type 1']],
    [3, ['look at both', 'not now']],
  ])
})

test('a quoted name the block does not offer as a reply is no reply, nor what it offers to do', () => {
  expect(needsYou(QUOTA).map(d => d.options)).toEqual([[]])
})

test('quotable lines are what the terminal shows, without code', () => {
  expect(quotable(NUMBERED)).toEqual([
    'Native matches Python on every row but two.',
    'Live d5 maximum position: 1 or 5 shares? At 1 share it can never place an order. Reply "5" (recommended) or "1".',
    'DIFF-15: at the position cap, should native count a dust remainder as already gone? Reply "yes" (recommended) or "no".',
    "Codex's Notion sign-in is still to redo:",
    'Remaining: about 7 hours.',
  ])
})

// The owner's host-arch block (2026-10-28): the phone showed item 1 as "Right before you" with a "research" chip.
const HOST_ARCH = `🔴 **Needs you:**
1. **Right before you say "research":** log in to AWS SSO. If the login lapses mid-run, Control reads fail and the deploy script stops.
   \`! aws sso login --sso-session vvs-sso\`
2. **If you want step 4 the same day:** give the signal by about 12:55Z. Later than that, step 4 waits for its next allowed window.
3. **Review infra.aws#2922 and #2923.** They're ready and unmerged, for tomorrow's go.
4. **Restart Docker Desktop and the DisplayLink driver.** Together they hold about 25 GB, which caused today's push stalls; restarting them doesn't touch trading.
5. **Tomorrow, after the meeting:** say "research" (or "deploy"), merge infra.aws#2842 about 1.5 minutes in, Approve the G5 live Start about 7.5 minutes in, and approve the org run for #2645. It waits on the prod environment; I'll send the link.`

test('a reply named in a clause saying when to act is no chip of that item; "x" (or "y") offers both', () => {
  const [login, , , , tomorrow] = needsYou(HOST_ARCH)
  expect(login).toMatchObject({ n: 1, title: 'Right before you say "research": log in to AWS SSO', options: [] })
  expect(tomorrow).toMatchObject({ n: 5, title: 'Tomorrow, after the meeting', options: ['research', 'deploy'] })
})

test("the session file's item is the whole item, its command apart to copy", () => {
  expect(itemsSaid(HOST_ARCH).get(1)).toMatchObject({
    text: '**Right before you say "research":** log in to AWS SSO. If the login lapses mid-run, Control reads fail and the deploy script stops.',
    commands: ['aws sso login --sso-session vvs-sso'],
  })
  expect(itemsSaid('🔴 **Needs you:** restart it.\n! sudo launchctl kickstart -k system/x').get(1)).toMatchObject({ text: 'restart it.', commands: ['sudo launchctl kickstart -k system/x'] })
  // A command in a fence is a command too; a nested list and a paragraph keep their shape.
  expect(itemsSaid(NUMBERED).get(3)).toMatchObject({ text: "**Codex's Notion sign-in** is still to redo:", commands: ['codex mcp login notion-readonly'] })
  expect(itemsSaid('🔴 **Needs you:**\n1. **Pick one.**\n   - "a": fast\n   - "b": safe\n\n   Both keep the data.').get(1)?.text).toBe(
    '**Pick one.**\n- "a": fast\n- "b": safe\n\nBoth keep the data.',
  )
})

test('a clause saying when to act offers none of the replies it names, however many', () => {
  expect(needsYou('🔴 **Needs you:**\n1. **Before you say "research" or "deploy":** log in to AWS SSO.')[0]).toMatchObject({
    title: 'Before you say "research" or "deploy": log in to AWS SSO',
    options: [],
  })
})

// The owner's host-arch block (2026-10-29, live acceptance 3): replies alone on their line, in code spans, drew no chip,
// so the phone showed the grant as code text with no button.
const HOST_ARCH_GRANT = `🔴 **Needs you:**
1. **Make London a native host (step 5)?** It restarts live g5-live and its shadow again (~17-20 s without orders), so the earliest is after the pilot and Kei's A/B test (after 05:45Z). It needs your per-instance go.
   \`"go: restart live poly-btc-g5-live for step 5 after the pilot"\` or \`"step 5 later"\``

test('a line of quoted replies alone offers each of them, a grant among them', () => {
  expect(needsYou(HOST_ARCH_GRANT)[0]).toMatchObject({
    title: 'Make London a native host (step 5)?',
    options: ['go: restart live poly-btc-g5-live for step 5 after the pilot', 'step 5 later'],
  })
  expect(needsYou('🔴 **Needs you:** which size?\n"5 shares" (recommended) or "1 share"')[0]).toMatchObject({ options: ['5 shares', '1 share'], recommended: '5 shares' })
  // A sentence that opens with quoted names and goes on names them; it offers nothing.
  expect(needsYou('🔴 **Needs you:** pick the sites.\n"Allow all sites" or "Block all sites" are the only settings.')[0]?.options).toEqual([])
  // A long list of quoted names followed by prose fails fast (review a70f3a7a713d: 28 names took over 3 s).
  const names = Array.from({ length: 40 }, (_, i) => `"site ${i}"`).join(', ')
  const start = performance.now()
  expect(needsYou(`🔴 **Needs you:** pick one.\n${names} are the sites.`)[0]?.options).toEqual([])
  expect(performance.now() - start).toBeLessThan(200)
})
