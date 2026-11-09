// The machine the session runs on, for what differs between Wendelin's Mac and Kei's Linux machines (a desktop
// with Ghostty, and vvs-box reached over ssh inside herdr and tmux): the clipboard and opening a page.

import type { EngineInterface } from 'claude-code'

export type Host = { isMac: boolean; hasDisplay: boolean }

/** `uname`, and whether a desktop (X11 or Wayland) is around; read on each press, which is rare. */
export async function host($: EngineInterface): Promise<Host> {
  const [uname, display, wayland] = await Promise.all([
    $.process.run(['uname', '-s']).then(r => r.stdout.trim()).catch(() => ''),
    $.env.get('DISPLAY').catch(() => undefined),
    $.env.get('WAYLAND_DISPLAY').catch(() => undefined),
  ])
  const isMac = uname === 'Darwin'
  return { isMac, hasDisplay: isMac || !!display || !!wayland }
}
