// A reply's mount and the engine's drawing beneath it, shared by the transcript tests.
import type { On } from 'claude-code'

export const message = (text: string, columns: number) =>
  ({
    plugin: 'agent-tooling',
    component: 'AssistantMessage',
    surface: 'terminal',
    viewport: { columns, rows: 50, isFullscreen: true },
    props: { text, isFirstOfReply: true },
  }) as const

// The design's own example: figures right-aligned under their header, the widest text column wrapping first.
export const STRANDS = `| Strand | Files | Lines | Done when |
|---|---|---|---|
| A reply | render/blocks.ts, table.ts | 330 | fixtures pass at 60/100/200 |
| B charts | views/mermaid.py, chart.ts | 1,380 | PNG matches golden |`

/** The engine's drawing beneath the plugin: what a message it passes on shows. */
export function engine(on: On): void {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}
