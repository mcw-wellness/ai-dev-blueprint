"""The terminal the E2E harness drives: a pty running `claude`, its screen as pyte keeps it, clicks, pointer moves and
wheel scrolls."""

import fcntl
import os
import re
import select
import struct
import termios
import time
from collections.abc import Callable
from dataclasses import dataclass, field

import pyte

TIMEOUT_S = 60
QUIET_S = 1.5
# Run before `claude`: the pty as the new session's controlling terminal, as in a real tab, so the plugin finds the tab
# to title and the kernel signals resizes. (`ai-usage run`, the `claude` on this Mac's PATH, sets it; the binary does not.)
CTTY = ["perl", "-e", f"ioctl STDIN,{termios.TIOCSCTTY},0 or die;exec @ARGV", "--"]
# One kitty graphics command (APC); pyte knows none, so they go around it.
APC = re.compile(rb"\x1b_[^\x1b]*\x1b\\")


class Screen(pyte.Screen):
    """pyte's screen, plus the scroll up and down (CSI S, T) the engine scrolls its fullscreen transcript by."""

    def scroll(self, count: int, step: Callable[[], None], at: int) -> None:
        y, self.cursor.y = self.cursor.y, at
        for _ in range(count or 1):
            step()
        self.cursor.y = y

    def scroll_up(self, count: int = 1, *_: object) -> None:
        self.scroll(count, self.index, (self.margins or (0, self.lines - 1))[1])

    def scroll_down(self, count: int = 1, *_: object) -> None:
        self.scroll(count, self.reverse_index, (self.margins or (0, 0))[0])


class Stream(pyte.ByteStream):
    csi = {**pyte.ByteStream.csi, "S": "scroll_up", "T": "scroll_down"}


@dataclass
class Pty:
    """A running `claude`: its screen, fed from the pty until a condition holds on a quiet screen."""

    master: int
    pid: int
    screen: Screen
    raw: bytearray = field(default_factory=bytearray)
    held: bytes = b""

    def __post_init__(self) -> None:
        self.stream = Stream(self.screen)

    def read(self, done: Callable[[str], bool], timeout: float = TIMEOUT_S) -> bool:
        """Whether `done` held before the timeout or the pty closed."""
        start = last = time.monotonic()
        while time.monotonic() - start < timeout:
            if select.select([self.master], [], [], 0.25)[0]:
                try:
                    data = os.read(self.master, 1 << 16)
                except OSError:
                    return False
                self.raw += data
                # A graphics command split across reads, or a read ending in its ESC, waits.
                held = self.held + data
                cut = held.rfind(b"\x1b_")
                open_ = cut >= 0 and held.find(b"\x1b\\", cut) < 0
                tail = (
                    held[cut:]
                    if open_
                    else held[-1:]
                    if held.endswith(b"\x1b")
                    else b""
                )
                self.stream.feed(APC.sub(b"", held[: len(held) - len(tail)]))
                self.held, last = tail, time.monotonic()
            elif time.monotonic() - last > QUIET_S and done(
                "\n".join(self.screen.display)
            ):
                return True
        return False

    def size(self, columns: int) -> None:
        rows = self.screen.lines
        fcntl.ioctl(
            self.master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0)
        )
        self.screen.resize(rows, columns)

    def click(self, y: int, x: int) -> None:
        """A left click on a cell, as an SGR mouse report."""
        for end in "Mm":
            os.write(self.master, f"\x1b[<0;{x + 1};{y + 1}{end}".encode())

    def keys(self, typed: str) -> None:
        """Keys typed at the prompt, never Enter, so nothing is sent."""
        if "\r" in typed or "\n" in typed:
            raise ValueError(f"would send the prompt: {typed!r}")
        os.write(self.master, typed.encode())

    def point(self, y: int, x: int) -> None:
        """The pointer onto a cell, no button held, as an SGR motion report."""
        os.write(self.master, f"\x1b[<35;{x + 1};{y + 1}M".encode())

    def hover(self, where: Callable[[], tuple[int, int]]) -> tuple[int, int] | None:
        """The pointer onto the cell `where` finds until the engine reverses it, found again each try: a reply still
        laying out under load (a chart's picture replacing its fence) moves a chip after it was found."""
        start = time.monotonic()
        while time.monotonic() - start < TIMEOUT_S:
            y, x = where()
            if y >= 0:
                self.point(y, x)
                if self.read(lambda _: self.screen.buffer[y][x].reverse, 3):
                    return y, x
            else:
                self.read(lambda _: where()[0] >= 0, 3)
        return None

    def scroll(self, up: bool, done: Callable[[str], bool]) -> bool:
        """Wheel events over the transcript, five at a time, until `done` holds."""
        for _ in range(20):
            os.write(self.master, f"\x1b[<{64 if up else 65};2;2M".encode() * 5)
            if self.read(done, 3):
                return True
        return False
