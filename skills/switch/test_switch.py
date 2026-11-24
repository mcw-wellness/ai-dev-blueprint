import tempfile
import unittest
from pathlib import Path

import switch


class FindSession(unittest.TestCase):
    def test_walks_up_to_the_claude_process_with_a_session_file(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "300.json").write_text('{"pid": 300, "sessionId": "s1", "cwd": "/work"}')
            parents = {100: 200, 200: 300, 300: 1}
            comms = {100: "/bin/zsh", 200: "bash", 300: "claude"}
            s = switch.find_session(100, parents.get, comms.get, Path(d))
            self.assertEqual((s["sessionId"], s["cwd"]), ("s1", "/work"))

    def test_no_claude_above_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(SystemExit):
                switch.find_session(100, {100: 1}.get, {100: "zsh"}.get, Path(d))


class Command(unittest.TestCase):
    def test_opens_the_session_in_its_directory_with_the_target_launcher(self):
        self.assertEqual(switch.shell_command("/work dir", ["claude-almir", "--resume", "s1"]),
                         "cd '/work dir' && claude-almir --resume s1")


if __name__ == "__main__":
    unittest.main()
