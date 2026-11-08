import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import auto_continue as ac

T0 = datetime(2026, 11, 8, 22, 0, tzinfo=timezone.utc)


def error_entry(text="API Error: Connection lost mid-response.", error="server_error",
                uuid="e1", at=T0):
    return {"type": "assistant", "uuid": uuid, "isApiErrorMessage": True, "error": error,
            "timestamp": at.isoformat().replace("+00:00", "Z"),
            "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}


def reply_entry(uuid="ok1", at=T0):
    return {"type": "assistant", "uuid": uuid, "timestamp": at.isoformat().replace("+00:00", "Z"),
            "message": {"role": "assistant", "content": [{"type": "text", "text": "Done."}]}}


def user_entry(text="continue", uuid="u1", at=T0):
    return {"type": "user", "uuid": uuid, "timestamp": at.isoformat().replace("+00:00", "Z"),
            "message": {"role": "user", "content": text}}


def minutes(n):
    return timedelta(minutes=n)


class BackoffTest(unittest.TestCase):

    def test_server_error_is_not_retried_before_five_minutes(self):
        state, actions = ac.decide(error_entry(), None, T0 + minutes(4))
        self.assertEqual(actions, [])

    def test_server_error_is_retried_after_five_minutes(self):
        state, actions = ac.decide(error_entry(), None, T0 + minutes(5))
        self.assertEqual(actions, ["send"])

    def test_second_retry_waits_ten_minutes_after_the_first(self):
        state, _ = ac.decide(error_entry(), None, T0 + minutes(5))
        state, too_early = ac.decide(error_entry(uuid="e2"), state, T0 + minutes(14))
        state, due = ac.decide(error_entry(uuid="e2"), state, T0 + minutes(15))
        self.assertEqual((too_early, due), ([], ["send"]))

    def test_a_failed_retry_does_not_restart_the_schedule(self):
        state, _ = ac.decide(error_entry(uuid="e1"), None, T0 + minutes(5))
        state, _ = ac.decide(user_entry(), state, T0 + minutes(6))
        state, actions = ac.decide(error_entry(uuid="e2", at=T0 + minutes(7)), state, T0 + minutes(12))
        self.assertEqual(actions, [])

    def test_after_seven_retries_it_announces_hourly_retries(self):
        sends = [5, 15, 30, 60, 90, 150, 210]
        state = None
        actions = []
        for i, m in enumerate(sends):
            state, actions = ac.decide(error_entry(uuid=f"e{i}"), state, T0 + minutes(m))
        self.assertEqual(actions, ["send", "notify:hourly"])

    def test_hourly_retries_continue_after_the_backoff(self):
        state = None
        for i, m in enumerate([5, 15, 30, 60, 90, 150, 210]):
            state, _ = ac.decide(error_entry(uuid=f"e{i}"), state, T0 + minutes(m))
        state, actions = ac.decide(error_entry(uuid="e8"), state, T0 + minutes(270))
        self.assertEqual(actions, ["send"])

    def test_gives_up_twelve_hours_after_the_first_error(self):
        state, _ = ac.decide(error_entry(), None, T0 + minutes(5))
        state, actions = ac.decide(error_entry(uuid="e9"), state, T0 + minutes(12 * 60))
        self.assertEqual(actions, ["notify:giveup"])

    def test_nothing_happens_after_giving_up(self):
        state, _ = ac.decide(error_entry(), None, T0 + minutes(5))
        state, _ = ac.decide(error_entry(uuid="e9"), state, T0 + minutes(12 * 60))
        state, actions = ac.decide(error_entry(uuid="e9"), state, T0 + minutes(13 * 60))
        self.assertEqual(actions, [])

    def test_a_successful_reply_clears_the_schedule(self):
        state, _ = ac.decide(error_entry(), None, T0 + minutes(5))
        state, actions = ac.decide(reply_entry(), state, T0 + minutes(6))
        self.assertEqual((state, actions), (None, []))

    def test_a_turn_in_progress_keeps_the_schedule(self):
        state, _ = ac.decide(error_entry(), None, T0 + minutes(5))
        kept, actions = ac.decide(user_entry(), state, T0 + minutes(6))
        self.assertEqual((kept, actions), (state, []))

    def test_an_error_older_than_twelve_hours_when_first_seen_is_ignored(self):
        state, actions = ac.decide(error_entry(), None, T0 + minutes(13 * 60))
        self.assertEqual(actions, [])


class OtherErrorsTest(unittest.TestCase):

    def test_session_limit_continues_once_two_minutes_after_the_reset(self):
        entry = error_entry("You've hit your session limit · resets 11:40pm (UTC)", "rate_limit")
        state, before = ac.decide(entry, None, T0 + minutes(100))
        state, at_reset = ac.decide(entry, state, T0 + minutes(102))
        state, after = ac.decide(entry, state, T0 + minutes(110))
        self.assertEqual((before, at_reset, after), ([], ["send"], []))

    def test_weekly_limit_days_away_asks_for_a_profile_instead_of_waiting(self):
        entry = error_entry("You've hit your weekly limit · resets Nov 12 at 1am (UTC)", "rate_limit")
        state, actions = ac.decide(entry, None, T0 + minutes(1))
        self.assertEqual(actions, ["quota"])

    def test_out_of_credits_asks_for_a_profile_once(self):
        entry = error_entry("You're out of usage credits. /model to switch models.", "rate_limit")
        state, first = ac.decide(entry, None, T0 + minutes(1))
        state, second = ac.decide(entry, state, T0 + minutes(2))
        self.assertEqual((first, second), (["quota"], []))

    def test_expired_login_notifies_once_and_never_types(self):
        entry = error_entry("Login expired · Please run /login", "authentication_failed")
        state, first = ac.decide(entry, None, T0 + minutes(1))
        state, second = ac.decide(entry, state, T0 + minutes(60))
        self.assertEqual((first, second), (["notify:error"], []))


class ResetParsingTest(unittest.TestCase):

    def test_time_only_reset_is_the_next_occurrence_in_its_zone(self):
        at = ac.parse_reset("You've hit your session limit · resets 8:40am (Europe/Vienna)",
                            datetime(2026, 11, 8, 22, 0, tzinfo=timezone.utc))
        self.assertEqual(at, datetime(2026, 11, 9, 7, 40, tzinfo=timezone.utc))

    def test_dated_reset_uses_the_given_day(self):
        at = ac.parse_reset("You've hit your weekly limit · resets Nov 12 at 1am (Europe/Vienna)",
                            datetime(2026, 11, 8, 22, 0, tzinfo=timezone.utc))
        self.assertEqual(at, datetime(2026, 11, 12, 0, 0, tzinfo=timezone.utc))

    def test_message_without_a_reset_has_none(self):
        self.assertIsNone(ac.parse_reset("You're out of usage credits.", T0))

    def test_reset_in_the_same_minute_as_the_error_is_now_not_tomorrow(self):
        at = ac.parse_reset("resets 10pm (UTC)", datetime(2026, 11, 8, 22, 0, 30, tzinfo=timezone.utc))
        self.assertEqual(at, datetime(2026, 11, 8, 22, 0, tzinfo=timezone.utc))

    def test_unknown_time_zone_has_no_reset(self):
        self.assertIsNone(ac.parse_reset("resets 8am (Mars/Olympus)", T0))


class ForegroundTest(unittest.TestCase):

    def test_claude_in_the_foreground_gets_its_tty(self):
        self.assertEqual(ac.tty_from_ps("S+   ttys007 claude"), "/dev/ttys007")

    def test_suspended_claude_gets_no_tty(self):
        self.assertEqual(ac.tty_from_ps("T    ttys007 claude"), "")

    def test_a_reused_pid_running_something_else_gets_no_tty(self):
        self.assertEqual(ac.tty_from_ps("S+   ttys007 vim"), "")


class TranscriptTest(unittest.TestCase):

    def write(self, entries):
        f = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
        for e in entries:
            f.write(json.dumps(e) + "\n")
        f.close()
        self.addCleanup(os.unlink, f.name)
        return Path(f.name)

    def test_last_turn_entry_skips_bookkeeping_lines(self):
        path = self.write([user_entry(), error_entry(),
                           {"type": "system", "subtype": "turn_duration"}, {"type": "cost-state"}])
        self.assertEqual(ac.last_turn_entry(path)["uuid"], "e1")

    def test_last_turn_entry_skips_subagent_lines(self):
        side = dict(reply_entry(uuid="side"), isSidechain=True)
        path = self.write([error_entry(), side])
        self.assertEqual(ac.last_turn_entry(path)["uuid"], "e1")

    def test_last_turn_entry_skips_lines_that_are_not_objects(self):
        path = self.write([error_entry(), None, []])
        self.assertEqual(ac.last_turn_entry(path)["uuid"], "e1")

    def test_text_of_tolerates_null_text_blocks(self):
        entry = {"message": {"content": [{"type": "text", "text": None}, {"type": "text", "text": "x"}]}}
        self.assertEqual(ac.text_of(entry), " x")


class TickTest(unittest.TestCase):
    """One minute of the daemon over a fake profile directory, with the side effects recorded."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.profile = self.root / ".claude-test"
        (self.profile / "sessions").mkdir(parents=True)
        (self.profile / "projects" / "-tmp-proj").mkdir(parents=True)
        self.state_path = self.root / "state.json"
        self.sent, self.notes = [], []
        self.effects = ac.Effects(
            send=lambda tty, text: self.sent.append((tty, text)) or True,
            notify=lambda title, body: self.notes.append(title),
            quota=lambda: "quota table",
            clipboard=lambda text: None,
            tty_of=lambda pid: "/dev/ttys042",
            alive=lambda pid: pid == 4242)

    def add_session(self, pid, sid, entries):
        (self.profile / "sessions" / f"{pid}.json").write_text(json.dumps(
            {"pid": pid, "sessionId": sid, "cwd": "/tmp/proj", "kind": "interactive"}))
        lines = "".join(json.dumps(e) + "\n" for e in entries)
        (self.profile / "projects" / "-tmp-proj" / f"{sid}.jsonl").write_text(lines)

    def tick(self, now):
        ac.tick([self.profile], self.state_path, now, self.effects)

    def test_types_continue_into_the_tab_of_a_live_errored_session(self):
        self.add_session(4242, "s1", [user_entry(), error_entry()])
        self.tick(T0 + minutes(5))
        self.assertEqual(self.sent, [("/dev/ttys042", "continue")])

    def test_leaves_dead_sessions_alone(self):
        self.add_session(999, "s1", [user_entry(), error_entry()])
        self.tick(T0 + minutes(5))
        self.assertEqual(self.sent, [])

    def test_schedule_survives_between_ticks(self):
        self.add_session(4242, "s1", [user_entry(), error_entry()])
        self.tick(T0 + minutes(5))
        self.tick(T0 + minutes(6))
        self.assertEqual(len(self.sent), 1)

    def test_a_crash_in_one_session_keeps_the_backoff_of_the_ones_before_it(self):
        self.add_session(4242, "s1", [user_entry(), error_entry()])
        self.add_session(4243, "s2", [user_entry(), error_entry(uuid="e2")])
        self.effects = self.effects._replace(alive=lambda pid: pid in (4242, 4243))
        sent_before = self.effects.send

        def send(tty, text):
            if len(self.sent) == 1:
                raise RuntimeError("boom")
            return sent_before(tty, text)
        self.effects = self.effects._replace(send=send)
        with self.assertRaises(RuntimeError):
            self.tick(T0 + minutes(5))
        self.assertEqual(len(json.loads(self.state_path.read_text())), 1)

    def test_a_tab_that_cannot_be_typed_into_is_reported(self):
        self.effects = self.effects._replace(send=lambda tty, text: False)
        self.add_session(4242, "s1", [user_entry(), error_entry()])
        self.tick(T0 + minutes(5))
        self.assertEqual(self.notes, ["auto-continue: could not type into Terminal"])


class ResumeInTest(unittest.TestCase):

    def test_copies_the_transcript_into_the_target_profile(self):
        root = Path(tempfile.mkdtemp())
        src = root / ".claude-a" / "projects" / "-tmp-proj"
        src.mkdir(parents=True)
        (src / "s1.jsonl").write_text('{"type":"user"}\n')
        (root / ".claude-b").mkdir()
        cmd = ac.prepare_resume(root, "b", "s1")
        copied = (root / ".claude-b" / "projects" / "-tmp-proj" / "s1.jsonl").read_text()
        self.assertEqual((copied, cmd), ('{"type":"user"}\n', ["claude-b", "--resume", "s1"]))


if __name__ == "__main__":
    unittest.main()
