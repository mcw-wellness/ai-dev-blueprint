// A chart in Terminal.app, which draws no pictures: one row naming the diagram. The pointer entering it asks the
// plugin for Quick Look, a click for Preview (Almir, 2026-11-08); chart.tsx's `viewers` hook runs them.
import type { ClientModule } from 'claude-code'

type Props = { file: string; alt: string }

const DiagramRow: ClientModule<Props, boolean> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState(true)
    surface.onPointer(e => {
      if (e.type === 'enter') surface.post({ act: 'peek', file: props.file })
      if (e.type === 'up' && e.button === 'left') surface.post({ act: 'open', file: props.file })
    })
  }
  return (
    <Box>
      <Text color="suggestion" bold>{'◇ diagram '}</Text>
      <Text>{props.alt}</Text>
      <Text dimColor>{'  · hover: Quick Look · click: Preview'}</Text>
    </Box>
  )
}

export default DiagramRow
