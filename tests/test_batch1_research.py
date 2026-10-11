import unittest
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class BatchOneResearchDocsTests(unittest.TestCase):
    def test_second_review_records_comparable_coverage_and_failure_boundaries(self):
        text = (ROOT / 'docs/实施说明.md').read_text(encoding='utf-8').split('### 13.20.', 1)[1]
        for phrase in ('f8af633', '完全相同的增补夹具', '159→38', '0/2→2/2',
                       '0/4→3/4', '0/5→3/5', '1/5→4/5', 'HTTP_404=8',
                       'HTTP_410=3', 'WEB_TLS_CERT=7', 'WEB_TIMEOUT=6',
                       'WEB_CONNECTION_RESET=1', '未联网验证其实际恢复数',
                       'COLLECTION_FALLBACK_RULES_', 'published_roster_rows',
                       '实际费用0元', '085502', 'verified:false'):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)
        record = (ROOT / 'docs/阶段7真实验证记录.md').read_text(encoding='utf-8').split('### 第二次真实运行复核后的遗留问题更新', 1)[1]
        for phrase in ('未开始第三次真实运行', '2.369682元另Flash未知项',
                       '7/14/21→8/17/22', '151.247秒', '另行授权'):
            self.assertIn(phrase, record)

    def test_rework_records_equivalence_performance_and_no_new_paid_run(self):
        text = (ROOT / 'docs/实施说明.md').read_text(encoding='utf-8').split('### 13.19.', 1)[1]
        for phrase in ('saveIncremental', 'research_pending_schools', 'setImmediate',
                       '13932', '缺失0、多出0', '2528', '242.8毫秒',
                       'finalReserveMs=150000', 'schoolDiscoveryReads=1',
                       'RESEARCH_COLLECTION_TIMEOUT', '实际HTTP、付费token及费用始终为0'):
            self.assertIn(phrase, text)
        elapsed = re.search(r'累计耗时 \*\*[\d.]+→([\d.]+)秒', text)
        self.assertIsNotNone(elapsed)
        self.assertLess(float(elapsed.group(1)), 180.7)
        record = (ROOT / 'docs/阶段7真实验证记录.md').read_text(encoding='utf-8').split('### 第一批监督返工后的遗留问题更新', 1)[1]
        self.assertIn('真实网络/付费调用/token/费用均为0', record)
        self.assertIn('632523毫秒', record)
        self.assertIn('另行授权', record)

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

    def test_paid_acceptance_records_usage_and_all_five_coverage_denominators(self):
        text = (ROOT / 'docs/阶段7真实验证记录.md').read_text(encoding='utf-8')
        section = text.split('## 第一批资料收集：唯一一次真实完整运行', 1)[1]
        for phrase in ('8124a44', '350/500', 'batch1-paid-run.lock',
                       'node --env-file-if-exists=.env', '耗时', '检索', '读取',
                       'deepseek-flash', 'deepseek-v4-pro', '输入token', '输出token',
                       '估算费用', '复试线与录取分', '报录比/人数/推免',
                       '本科背景', '学科评估与专业排名', '就业去向与城市发展',
                       '待补查', '是否仍需要补充资料', '没有第二次运行'):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, section)


if __name__ == '__main__':
    unittest.main()
