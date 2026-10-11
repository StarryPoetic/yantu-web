from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class TwoStageDocumentation(unittest.TestCase):
    def test_coverage_denominators_and_missing_scores_are_explicit(self):
        text = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        for phrase in ("任务二：两阶段收窄", "var/task-two-copy.sqlite", "12/458", "2.62%", "1/458", "7/458", "147/458", "985/211", "verified:false", "没有结构化字段", "不把英语/数学自评或五题测评换算为分数"):
            self.assertIn(phrase, text)

    def test_offline_comparison_and_strategy_are_documented(self):
        text = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        for phrase in ("粗筛25校", "每城10校", "最终10校", "research-prefilter-comparison.ts", "单城市", "多城市", "全国", "已确认字段", "真实付费调用0"):
            self.assertIn(phrase, text)

    def test_current_contract_and_legacy_compatibility_are_linked(self):
        for path in (ROOT / "README.md", ROOT / "docs" / "技术设计" / "07-DeepSeek接入与密钥管理.md"):
            content = path.read_text(encoding="utf-8")
            self.assertIn("任务二", content)
            self.assertIn("25校", content)
            self.assertIn("10校", content)
            self.assertIn("旧", content)
