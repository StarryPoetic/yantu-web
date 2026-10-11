import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class BatchOneResearchDocsTests(unittest.TestCase):
    def test_collection_scope_and_evidence_limits_are_explicit(self):
        text = (ROOT / 'docs/实施说明.md').read_text(encoding='utf-8').split('### 13.18.', 1)[1]
        for phrase in ('1–3', '每城最多15', '179校', '60组', '估计',
                       'RESEARCH_FLASH_ENABLED=true', 'researchUseFlash=false',
                       '复试线', '录取分', '报录比', '推免占比', '双非', '跨考',
                       '学科评估', '专业排名', '就业去向', '城市发展', '连续原句',
                       '4000000', '12000000', '15个字段槽', '计费未知', 'partial'):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)

    def test_paid_runner_requires_explicit_intent_and_keeps_one_shot_lock(self):
        text = (ROOT / 'tests/helpers/research-batch-live.ts').read_text(encoding='utf-8')
        self.assertIn('"--confirm-paid"', text)
        self.assertIn('openSync(path, "wx"', text)
        self.assertIn('one-run-no-relaunch', text)
        self.assertNotIn('unlink', text)
        self.assertIn('var/batch1-live-copy.sqlite', text)


if __name__ == '__main__':
    unittest.main()
