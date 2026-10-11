from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class ReportExperienceDocumentation(unittest.TestCase):
    def test_generation_contract_and_offline_evidence_are_documented(self):
        content = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        for phrase in ("任务一：报告生成体验", "research_inputs_locked", "GET /api/v1/research/latest", "检索与读取", "prefers-reduced-motion", "var/task1-1280.png", "var/task1-375.png", "测评答题、咨询", "单实例轮询", "不访问付费服务"):
            self.assertIn(phrase, content)
