import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import bgwatch as bw

HERE = Path(__file__).parent


def rules(**kw):
    base = dict(done=None, fail=None, stall_s=900, max_s=None)
    base.update(kw)
    return bw.Rules(**base)


class Verdict(unittest.TestCase):
    def test_fail_line_wins_over_done_line(self):
        r = rules(done="ALL DONE", fail="Traceback")
        self.assertEqual(bw.verdict(r, "x\nTraceback (most recent)\nALL DONE\n", True, 0, 0)[0], "FAILED")

    def test_done_line(self):
        r = rules(done="ALL DONE", fail="Traceback")
        v = bw.verdict(r, "step 1\nALL DONE in 3s\n", True, 0, 0)
        self.assertEqual(v, ("DONE", "ALL DONE in 3s"))

    def test_running_and_progressing_is_no_verdict(self):
        self.assertIsNone(bw.verdict(rules(done="ok"), "step 1\n", True, 10, 100))

    def test_process_gone_without_done_or_fail_line(self):
        self.assertEqual(bw.verdict(rules(done="ok"), "step 1\n", False, 0, 0)[0], "GONE")

    def test_process_gone_after_done_line_is_done(self):
        self.assertEqual(bw.verdict(rules(done="ok"), "ok\n", False, 0, 0)[0], "DONE")

    def test_no_done_pattern_and_process_exited_is_ended(self):
        # Without a done pattern, exit is the only signal; it can't tell success from failure.
        self.assertEqual(bw.verdict(rules(), "anything\n", False, 0, 0)[0], "ENDED")

    def test_stuck_after_stall_limit(self):
        self.assertEqual(bw.verdict(rules(stall_s=900), "", True, 900, 900)[0], "STUCK")
        self.assertIsNone(bw.verdict(rules(stall_s=900), "", True, 899, 899))

    def test_too_long_after_hard_limit(self):
        self.assertEqual(bw.verdict(rules(max_s=3600), "", True, 0, 3600)[0], "TOO_LONG")

    def test_fail_line_reported_is_the_matching_line(self):
        v = bw.verdict(rules(fail="Error"), "a\nAPI Error: overloaded\nb\n", True, 0, 0)
        self.assertEqual(v, ("FAILED", "API Error: overloaded"))


class Fingerprint(unittest.TestCase):
    def test_same_content_same_fingerprint_even_if_rewritten(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "log")
            p.write_text("same\n")
            a = bw.fingerprint(p)
            p.write_text("same\n")  # touched, mtime changed, content not
            self.assertEqual(a, bw.fingerprint(p))
            p.write_text("same\nmore\n")
            self.assertNotEqual(a, bw.fingerprint(p))

    def test_missing_log_is_empty(self):
        self.assertEqual(bw.read_text(Path("/nonexistent/bgwatch.log")), "")


class EndToEnd(unittest.TestCase):
    def run_watch(self, script, *args):
        with tempfile.TemporaryDirectory() as d:
            log = Path(d, "job.log")
            job = subprocess.Popen(["/bin/sh", "-c", script], stdout=log.open("w"), stderr=subprocess.STDOUT)
            out = subprocess.run([sys.executable, str(HERE / "bgwatch.py"), "--pid", str(job.pid),
                                  "--log", str(log), "--poll-s", "0.1", *args],
                                 capture_output=True, text=True, timeout=20)
            job.kill()
            job.wait()
            return out

    def test_done(self):
        out = self.run_watch("echo working; sleep 0.3; echo FINISHED; sleep 5", "--done", "FINISHED")
        self.assertEqual(out.returncode, 0)
        self.assertTrue(out.stdout.startswith("DONE"), out.stdout)

    def test_failed(self):
        out = self.run_watch("echo boom: Traceback; sleep 5", "--done", "FINISHED", "--fail", "Traceback")
        self.assertEqual(out.returncode, 1)
        self.assertTrue(out.stdout.startswith("FAILED"), out.stdout)

    def test_gone(self):
        out = self.run_watch("echo working; exit 3", "--done", "FINISHED")
        self.assertEqual(out.returncode, 2)
        self.assertTrue(out.stdout.startswith("GONE"), out.stdout)

    def test_stuck(self):
        out = self.run_watch("echo working; sleep 10", "--done", "FINISHED", "--stall-min", "0.01")
        self.assertEqual(out.returncode, 3)
        self.assertTrue(out.stdout.startswith("STUCK"), out.stdout)

    def test_too_long(self):
        out = self.run_watch("while true; do echo tick; sleep 0.1; done", "--done", "FINISHED",
                             "--max-min", "0.01")
        self.assertEqual(out.returncode, 4)
        self.assertTrue(out.stdout.startswith("TOO_LONG"), out.stdout)

    def test_needs_pid_or_log(self):
        out = subprocess.run([sys.executable, str(HERE / "bgwatch.py")], capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)


if __name__ == "__main__":
    unittest.main()
