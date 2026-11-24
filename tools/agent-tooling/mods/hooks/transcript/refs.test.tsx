import { expect, test } from 'claude-code/testing'

import { linked } from './refs'

const GH = 'https://github.com'
const message = (text: string) =>
  ({
    plugin: 'agent-tooling',
    component: 'AssistantMessage',
    surface: 'terminal',
    viewport: { columns: 100, rows: 50, isFullscreen: true },
    props: { text, isFirstOfReply: true },
  }) as const

test('a pull request named by its repository links to it, each number of a chain to its own', () => {
  expect(linked('Merged te#1770-#1774 and pe#1056/#1062.')).toBe(
    `Merged [te#1770](${GH}/vvs-capital/trading.executors/issues/1770)-[#1774](${GH}/vvs-capital/trading.executors/issues/1774)` +
      ` and [pe#1056](${GH}/vvs-capital/trading.polymarket-executor/issues/1056)/[#1062](${GH}/vvs-capital/trading.polymarket-executor/issues/1062).`,
  )
  expect(linked('(infra.aws#899, agent-tooling#186, octo/cat#3)')).toBe(
    `([infra.aws#899](${GH}/vvs-capital/infra.aws/issues/899), [agent-tooling#186](${GH}/wendelinwemhoener/agent-tooling/issues/186),` +
      ` [octo/cat#3](${GH}/octo/cat/issues/3))`,
  )
})

test('code, links, URLs, quoted replies, fences and bare numbers keep their text', () => {
  const kept = [
    '`pe#1071` in code',
    '[pe#1071](https://example.com/x) already a link',
    'see https://github.com/a/b/pull/1#issuecomment-2 and <https://x.y/te#3>',
    'reply "merge pe#1071" or "wait"',
    'reply “merge pe#1071” or “wait”',
    '[see pe#1 here][r]',
    '```draft\nShipped te#1774\n```',
    'type#1, #1071, step#2',
  ]
  for (const md of kept) expect(linked(md)).toBe(md)
})

test('a reference is a link in a table, and in prose the engine draws', async ($, on) => {
  // The engine's drawing beneath the plugin: it draws the prose it is passed.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })
  const href = `${GH}/vvs-capital/trading.polymarket-executor/issues/1071`
  const table = await $.ui.mount(message('| State | Step |\n|---|---|\n| Running | Ranges (pe#1071) |'))
  expect((await table.find({ type: 'Link' }))?.props).toMatchObject({ href })
  const prose = await $.ui.mount(message('Remaining: dominated by pe#1071 CI.'))
  expect((await prose.find({ type: 'Text' }))?.text).toBe(`Remaining: dominated by [pe#1071](${href}) CI.`)
})
