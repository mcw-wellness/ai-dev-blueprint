"""What the harness does in a run before its screen is checked: wheel scrolls, clicks, pointer moves and keys, each
checked as it goes."""

from capture import BAND, PICKED, TEXT, Capture
from checks import check_band
from term import Pty


def pick(p: Pty, c: Capture, what: str, chip: str, picked: str, after: int) -> bool:
    """Clicks `chip`, found at or below row `after`, and checks that `picked` then shows; whether it did."""
    y, x = c.find(chip, after)
    if not c.check(f"{what} shown", y >= 0):
        return False
    p.click(y, x + 2)
    return c.check(f"{what} picks", p.read(lambda _: c.find(picked)[0] >= 0))


def scrolled(p: Pty, c: Capture) -> None:
    """At the bottom the reply shows its block, so the band is its title alone; scrolled up past it, its rows return."""
    # Under load the band can still show its rows when the screen first goes quiet, and folds a redraw later.
    alone = p.read(lambda _: not c.rows())
    c.check("band title alone while the reply shows its block", alone)
    if c.check(
        "band rows once the block scrolls away",
        p.scroll(True, lambda _: c.rows() and c.find("Draft:", c.band())[0] > 0),
    ):
        check_band(c)


def hide(p: Pty, c: Capture) -> None:
    """Picks by a band chip and by a reply chip, never completing the block, so nothing is sent; then `hide`."""
    scrolled(p, c)
    pick(p, c, "band chip", "[ ★ keep ]", "[ ✓ keep ]", c.band())
    c.check("a pick shows send", c.find("[ send 1 of 4 ]")[0] >= 0)
    c.check("block scrolled back", p.scroll(False, lambda _: not c.rows()))
    y, x = c.find("[ drop ]")
    if c.check("reply chip in the reply", 0 <= y < c.band()):
        p.click(y, x + 2)
        again = p.read(lambda _: c.find("[ ✓ drop ]")[0] >= 0)
        c.check("a reply chip in the reply picks its reply instead", again)
    c.check("a pick sends nothing while a decision is open", c.band() >= 0)
    y = c.band()
    text, xs = c.row(y)
    if not c.check("band's hide shown", y >= 0 and text.rstrip().endswith("hide")):
        return
    p.click(y, xs[text.rfind("hide")])
    c.check("band gone after one click", p.read(lambda shown: not BAND.search(shown)))
    for columns in (c.columns - 4, c.columns):
        drawn = len(p.raw)
        p.size(columns)
        p.read(lambda shown: True)
        c.check(f"redrawn at {columns} columns", len(p.raw) > drawn)


def hover(p: Pty, c: Capture) -> None:
    """A draft's `copy` and a reply's chip in the reply, then, scrolled up, a band chip: under the pointer the engine
    reverses brackets and label, the label written swapped so it shows the picked fill; at rest once it leaves."""
    for what, needle, part in (
        ("draft copy", "[ copy ]", "copy"),
        ("reply chip", "[ ★ reloaded ]", "★ reloaded"),
        ("band chip", "[ later ]", "later"),
    ):
        band = what == "band chip"
        if band:
            c.check("band rows for hover", p.scroll(True, lambda _: c.rows()))
        y, x = c.find(needle, c.band() if band else 0)
        # The reply's own chips sit above the band, which shows the same words.
        if not c.check(f"{what} shown", y >= 0 and band == (y > c.band())):
            continue
        at = p.hover(lambda: c.find(needle, c.band() if band else 0))
        if c.check(f"{what} lights", at is not None):
            y, x = at or (y, x)
            c.styled(f"hovered {what} bracket", needle, y, "[", reverse=True)
            label = f"hovered {what} label"
            c.styled(label, needle, y, part, fg=PICKED, bg=TEXT, reverse=True)
        p.point(y, 0)
        rest = p.read(lambda _: not c.screen.buffer[y][x].reverse)
        c.check(f"{what} at rest once the pointer leaves", rest)


def grant(p: Pty, c: Capture) -> None:
    """Decision 4 recommends a grant: the prompt's ghost text, the answer Tab takes from it and `★ all` all leave it
    out, and nothing is sent while it stays open. The whole transcript is on screen, so the band is its title."""

    def prompt() -> str:
        return next((s[2:] for s in reversed(c.text()) if s.startswith("❯")), "")

    picks = "re 🔴1: reloaded; 🔴2: keep"
    ghost = p.read(lambda _: prompt() == picks)
    c.check("ghost text leaves the grant out", ghost, prompt())
    if pick(p, c, "★ all", "[ ★ all ]", "[ ✓ keep ]", c.band()):
        unpicked = c.find("[ ★ go: restart paper ]")[0] >= 0
        c.check("★ all leaves the grant unpicked", unpicked)
        c.check("★ all sends nothing", c.find("[ send 2 of 4 ]", c.band())[0] > 0)
    # A key typed after Tab follows the answer Tab took; over ghost text it would replace it.
    p.keys("\tx")
    took = p.read(lambda _: prompt() == f"{picks}x")
    c.check("Tab takes the answer without the grant", took, prompt())
    asked = [s for s in c.text()[: c.band()] if s.startswith("❯")]
    c.check("nothing sent", asked == ["❯ blocked?", "❯ now?", "❯ status?"], str(asked))
