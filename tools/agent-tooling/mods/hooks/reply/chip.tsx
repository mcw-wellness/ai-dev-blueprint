// A chip: a reply, copy or open button, drawn the same in the band and in the reply above it.
import type { Elements, EngineInterface, RenderElement } from 'claude-code'

import { host } from '../host'
import { copyDraft } from './draft'
import { press } from './state'
import type { Chip } from '../transcript/blocks'

/**
 * A reply's chip, the same in the band and in the reply above it: `[ option ]` on the chips' tint, the recommended one
 * `[ ★ option ]` bold on green, a picked one `[ ✓ option ]` filled. A press picks it for its decision, a second takes
 * it back; once every decision of the block has a pick, they go to the agent as one prompt. `source`: the reply a chip
 * drawn in the transcript stands in; in an earlier reply than the latest a press puts its answer, by the decision's
 * point, in the prompt.
 */
export function replyChip(
  el: Pick<Elements['terminal'], 'Box' | 'Button' | 'Text'>,
  $: EngineInterface,
  c: Chip,
  key: string,
  source?: string,
  picked = false,
): RenderElement {
  return chip(el, key, label(c, picked), picked ? 'picked' : c.recommended ? 'recommended' : 'rest', () => void press($, c, source))
}

/** A chip's words: `✓` once picked, `★` when recommended. */
export const label = (c: Pick<Chip, 'chip' | 'recommended'>, picked: boolean): string => (picked ? `✓ ${c.chip}` : c.recommended ? `★ ${c.chip}` : c.chip)

// A chip reads as a button, in soft fills that never outshine the crimson Needs you badge (owner, 2026-10-27): at rest
// the theme's neutral message gray, the recommended one pale green and starred, a picked one bold on the selection's
// pale blue and ticked; each reads in light and dark. Under the pointer the engine reverses the whole Button, so a
// label's hover colors are written swapped: it shows the theme's text on the fill a press leads to, the picked blue,
// or the rest gray on a picked chip (owner, 2026-10-27: "hover should also have an effect on the part of the button
// with text").
const TINT = 'userMessageBackground'
const PICKED = 'selectionBg'
const LOOKS = {
  rest: { backgroundColor: TINT, bold: false, hover: { color: PICKED, backgroundColor: 'text' } },
  recommended: { backgroundColor: 'diffAddedDimmed', bold: true, hover: { color: PICKED, backgroundColor: 'text' } },
  picked: { backgroundColor: PICKED, bold: true, hover: { color: TINT, backgroundColor: 'text' } },
} as const

/**
 * A chip: `[ label ]`, no hotkey, since a digit typed into an empty prompt would press it. Its keyed Box is its hover
 * scope, so the pointer anywhere on it, brackets included, lights the label; a keyed scope, unlike a named group,
 * never lights a chip of another message that reuses the key.
 */
export function chip(el: Pick<Elements['terminal'], 'Box' | 'Button' | 'Text'>, key: string, text: string, look: keyof typeof LOOKS, onPress: () => void): RenderElement {
  const { Box, Button, Text } = el
  const { backgroundColor, bold, hover } = LOOKS[look]
  return (
    <Box key={`${key}:hover`}>
      <Button key={key} onPress={onPress}>
        <Text color="text" backgroundColor={backgroundColor} bold={bold} hover={hover}>
          {text}
        </Text>
      </Button>
    </Box>
  )
}

/** A chip that only copies: the draft's `copy`. */
export function copyChip(el: Pick<Elements['terminal'], 'Box' | 'Button' | 'Text'>, key: string, body: string, $: EngineInterface): RenderElement {
  return chip(el, key, 'copy', 'rest', () => void copyDraft($, body))
}

/** A chip that opens a page or link the reply names, in the default app, and says so. */
export function openChip(el: Pick<Elements['terminal'], 'Box' | 'Button' | 'Text'>, key: string, target: string, $: EngineInterface): RenderElement {
  return chip(el, key, 'open', 'rest', () => void openPage($, target))
}

// The URL in argv to the app that opens https links, as a link opened there.
const TO_BROWSER = `use framework "AppKit"
use scripting additions
on run argv
	set browser to current application's NSWorkspace's sharedWorkspace()'s URLForApplicationToOpenURL:(current application's NSURL's URLWithString:"https:")
	tell application id ((current application's NSBundle's bundleWithURL:browser)'s bundleIdentifier() as text) to open location (item 1 of argv)
end run`

async function openPage($: EngineInterface, target: string): Promise<void> {
  const path = target.replace(/^~(?=\/)/, (await $.env.get('HOME')) ?? '~')
  const { isMac, hasDisplay } = await host($)
  if (!isMac) {
    // Linux: xdg-open keeps a file URL's `#target`. Over ssh (vvs-box) there is no desktop to open it on.
    if (!hasDisplay) return void $.ui.toast(`No desktop here to open it on: ${target}`)
    const url = path.startsWith('/') && path.includes('#') ? `file://${encodeURI(path)}` : path
    const ran = await $.process.run(['xdg-open', url]).catch((e: unknown) => ({ exitCode: 1, stderr: String(e) }))
    if (ran.exitCode !== 0) $.ui.toast(`Not opened: ${ran.stderr.trim() || `xdg-open exited ${ran.exitCode}`}`)
    return
  }
  // `open` drops a file URL's `#target` (LaunchServices, measured 2026-10-27): an anchored page goes to the default browser itself.
  const argv = path.startsWith('/') && path.includes('#') ? ['osascript', '-e', TO_BROWSER, `file://${encodeURI(path)}`] : ['open', path]
  const ran = await $.process.run(argv).catch((e: unknown) => ({ exitCode: 1, stderr: String(e) }))
  if (ran.exitCode !== 0) $.ui.toast(`Not opened: ${ran.stderr.trim() || `open exited ${ran.exitCode}`}`)
}
