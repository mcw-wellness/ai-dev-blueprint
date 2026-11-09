import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("ai_usage", Path(__file__).with_name("ai-usage.py"))
au = importlib.util.module_from_spec(spec)
spec.loader.exec_module(au)


class WeeklyLine(unittest.TestCase):
    def test_percent_per_profile_with_a_warning_from_80(self):
        self.assertEqual(au.weekly_line([("vvs", 42.4), ("tcp", 88)]), "wk: vvs 42% · tcp 88% ⚠️")

    def test_unreadable_profile_is_a_question_mark(self):
        self.assertEqual(au.weekly_line([("almir", None)]), "wk: almir ?")

    def test_no_profiles_is_empty(self):
        self.assertEqual(au.weekly_line([]), "")


if __name__ == "__main__":
    unittest.main()
