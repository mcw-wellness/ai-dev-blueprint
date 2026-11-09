"""A screen the E2E harness captured: its text, where a needle shows, the checks failed on it, and the light theme's
colors the checks expect."""

import re
from dataclasses import dataclass, field

import pyte

# The light theme's colors, as the engine drew them in a capture.
SUCCESS, CLAUDE, ERROR, MERGED = "2c7a39", "d77757", "ab2b3f", "8700ff"
INVERSE = "ffffff"  # a badge's text on its role's background
PERMISSION, WARNING, SUBTLE = "5769f7", "966c1e", "afafaf"
TINT, TEXT = "f0f0f0", "000000"  # chips' rest fill (light userMessageBackground), words
PICKED = "b4d5ff"  # a picked chip's fill (light `selectionBg`)
INACTIVE = "666666"
ALERTS = {
    "Note": PERMISSION,
    "Tip": SUCCESS,
    "Important": MERGED,
    "Warning": WARNING,
    "Caution": ERROR,
}
# A kitty Unicode placeholder: the cells a picture covers.
PLACEHOLDER = "\U0010eeee"
BAND = re.compile(r"Needs you  \d+ decision")


@dataclass
class Capture:
    name: str
    columns: int
    screen: pyte.Screen
    raw: bytes
    failures: list[str] = field(default_factory=list)

    def row(self, y: int) -> tuple[str, list[int]]:
        """Row `y`'s text and each character's column (a wide character takes two)."""
        line = self.screen.buffer[y]
        cells = [(x, line[x].data) for x in range(self.columns) if line[x].data]
        return "".join(d for _, d in cells), [x for x, d in cells for _ in d]

    def text(self) -> list[str]:
        return [self.row(y)[0].rstrip() for y in range(self.screen.lines)]

    def find(self, needle: str, after: int = 0) -> tuple[int, int]:
        """Row and column of `needle`'s first match at or below row `after`, or (-1, -1)."""
        for y in range(max(after, 0), self.screen.lines):
            text, xs = self.row(y)
            if (i := text.find(needle)) >= 0:
                return y, xs[i]
        return -1, -1

    def band(self) -> int:
        """The Reply band's title row, or -1."""
        return next((y for y, s in enumerate(self.text()) if BAND.search(s)), -1)

    def rows(self) -> bool:
        """Whether the band shows its decision rows, not its title alone."""
        return 0 <= self.band() < self.find("Reload the renderer", self.band())[0]

    def check(self, what: str, ok: bool, detail: str = "") -> bool:
        if not ok:
            self.failures.append(f"{self.name}: {what}" + f" ({detail})" * bool(detail))
        return ok

    def styled(
        self,
        what: str,
        needle: str,
        after: int = 0,
        part: str = "",
        blank: bool = False,
        **want: object,
    ) -> int:
        """Checks that `needle` shows, each cell of it (or of `part` in it) with the attributes `want` names
        (`fg`, `bg`, `bold`), blank cells only with `blank`; its row, or -1."""
        y, x = self.find(needle, after)
        if not self.check(what, y >= 0, f"no {needle!r}"):
            return -1
        x += needle.find(part) if part else 0
        for i in range(len(part or needle)):
            c = self.screen.buffer[y][x + i]
            got = {k: getattr(c, k) for k in want}
            if (blank or c.data.strip()) and got != want:
                self.check(what, False, f"{needle!r} at {y}:{x + i} has {got}")
                break
        return y
