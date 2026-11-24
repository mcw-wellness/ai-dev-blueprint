"""save.sh, the session file's writer: a new file appears whole by a rename in its directory (mode 700, the file 600),
never by writing over the old one in place, and leaves no temporary file behind."""

import stat
import subprocess
from pathlib import Path

SAVE = Path(__file__).with_name("save.sh")


def save(directory: Path, name: str, text: str) -> None:
    subprocess.run(
        ["/bin/sh", SAVE, directory, name], input=text, text=True, check=True
    )


def test_replaces_by_rename_with_private_modes(tmp_path: Path) -> None:
    directory = tmp_path / "claude-sessions"
    save(directory, "s1.json", '{"glyph":""}\n')
    target = directory / "s1.json"
    before = target.stat().st_ino
    with (
        target.open() as held
    ):  # a reader that opened the old file keeps reading it whole
        save(directory, "s1.json", '{"glyph":"🔴"}\n')
        assert held.read() == '{"glyph":""}\n'
    assert target.read_text() == '{"glyph":"🔴"}\n'
    assert target.stat().st_ino != before  # a rename, not a write in place
    assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert [p.name for p in directory.iterdir()] == ["s1.json"]
