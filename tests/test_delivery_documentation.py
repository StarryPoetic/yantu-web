"""Keep current delivery docs distinct from historical and production claims."""

from pathlib import Path
import re
import unittest
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
SITE = "https://yantu-web-preview.onrender.com/"
REPO = "https://github.com/StarryPoetic/yantu-web"


class DeliveryDocumentationTests(unittest.TestCase):
    def test_entry_points_separate_source_from_disposable_preview(self):
        for path in (ROOT / "README.md", DOCS / "免费公网测试站.md",
                     DOCS / "实施说明.md", DOCS / "剩余工作执行计划.md"):
            text = path.read_text(encoding="utf-8")
            with self.subTest(path=path.name):
                self.assertIn(SITE, text)
                self.assertIn(REPO, text)
                self.assertIn("临时", text)
                self.assertNotIn("GitHub 仓库仍为私有", text)
                self.assertNotIn("推送已验证提交到私有仓库", text)

    def test_current_implementation_uses_code_budget_not_historical_limits(self):
        current = (DOCS / "实施说明.md").read_text(encoding="utf-8").split("## 7.", 1)[0]
        code = (ROOT / "server/explanation/research-budget.ts").read_text(encoding="utf-8")
        values = dict(re.findall(r"^  (\w+): (\d+),", code, re.M))
        for key, suffix in (("searches", "次搜索"), ("reads", "次读取"),
                            ("schoolReads", "次读取")):
            self.assertIn(values[key] + suffix, current)
        self.assertIn("4–5所不同学校", current)
        for obsolete in ("尚无邮件验证、密码找回及账号注销界面",
                         "当前没有自动备份或一键恢复命令", "最终默认Pro/high16384/120秒"):
            self.assertNotIn(obsolete, current)

    def test_current_report_contract_is_linked_from_delivery_and_design(self):
        current = (DOCS / "实施说明.md").read_text(encoding="utf-8").split("## 7.", 1)[0]
        for boundary in ("整块默认收起", "新生成学校卡片默认折叠", "顶部吸顶", "重新连接",
                         "含已展示同校对照", "零检索、零读取、零模型调用", "不引入别校替补"):
            self.assertIn(boundary, current)
        for path in (ROOT / "README.md", DOCS / "实施说明.md",
                     DOCS / "剩余工作执行计划.md",
                     DOCS / "技术设计/00-文档清单与需求映射.md"):
            self.assertIn("research-supplement-flow.md", path.read_text(encoding="utf-8"))

    def test_preview_deployment_does_not_close_production_or_review_gates(self):
        preview = (DOCS / "免费公网测试站.md").read_text(encoding="utf-8")
        for boundary in ("dc044691af65b3dbedee5bcba6cd40ff1908067c", "自动部署关闭",
                         "模型、网页搜索、联网生成报告和模型咨询均关闭",
                         "题库仍未完成真实学科审校和校准", "本地账号与资料没有迁移"):
            self.assertIn(boundary, preview)
        production = (DOCS / "长期部署.md").read_text(encoding="utf-8")
        self.assertIn("免费公网测试站.md", production)
        self.assertIn("长期生产服务器、自有域名和持久化灾备仍待验收", production)
        self.assertNotIn("当前没有经验证的公网地址", production)

    def test_delivery_links_and_history_labels_remain_valid(self):
        files = ["实施说明.md", "剩余工作执行计划.md", "后续改进执行台账.md",
                 "免费公网测试站.md", "长期部署.md"]
        for name in files:
            path = DOCS / name
            text = path.read_text(encoding="utf-8")
            self.assertEqual(len(re.findall(r"^# ", text, re.M)), 1, name)
            for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
                parsed = urlsplit(target)
                if parsed.scheme or target.startswith("#"):
                    continue
                self.assertTrue((path.parent / unquote(parsed.path)).resolve().is_file(),
                                f"{name}: {target}")
        implementation = (DOCS / "实施说明.md").read_text(encoding="utf-8")
        self.assertIn("第7–13节保留各日期的历史记录", implementation)
        self.assertIn("不启动第12次付费运行", implementation)
        ledger = (DOCS / "剩余工作执行计划.md").read_text(encoding="utf-8")
        self.assertIn("3项失败修复后5项定向回归通过", ledger)
        self.assertIn("没有将定向复测说成139项全部重新跑过", ledger)


if __name__ == "__main__":
    unittest.main()
