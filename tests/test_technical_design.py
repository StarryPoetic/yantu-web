"""Check that the technical design package is navigable and traceable to V0.5."""

from pathlib import Path
import re
import unittest
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
DESIGN_DIR = ROOT / "docs" / "技术设计"
INDEX = DESIGN_DIR / "00-文档清单与需求映射.md"
PRODUCT = ROOT / "docs" / "产品设计文档.md"
README = ROOT / "README.md"

DESIGN_FILES = [
    "01-总体架构与演进.md",
    "02-数据模型与可信数据.md",
    "03-联合推荐测评与分数规划.md",
    "04-接口与前端交互.md",
    "05-安全运维与验证.md",
]


class TechnicalDesignTests(unittest.TestCase):
    def test_every_deliverable_is_listed_and_linked(self):
        content = INDEX.read_text(encoding="utf-8")
        for name in DESIGN_FILES:
            with self.subTest(name=name):
                self.assertTrue((DESIGN_DIR / name).is_file())
                self.assertIn(f"({name})", content)

    def test_product_modules_have_unique_trace_rows(self):
        product = PRODUCT.read_text(encoding="utf-8")
        index = INDEX.read_text(encoding="utf-8")
        modules = [
            "学生画像", "意向城市选择", "用户偏好", "公共课测评",
            "专业推荐与选择", "学硕/专硕建议与解释", "专业课测评",
            "院校推荐与选择", "分数规划", "院校评价", "对比与报告",
            "管理后台", "阅读与响应式适配",
        ]
        for module in modules:
            with self.subTest(module=module):
                self.assertIn(module, product)
        rows = re.findall(r"^\| (R-\d{2}) \| ([^|]+) \|", index, re.MULTILINE)
        self.assertEqual([number for number, _ in rows], [f"R-{n:02d}" for n in range(1, 18)])
        self.assertEqual(len(set(number for number, _ in rows)), len(rows))
        for number, title in rows:
            self.assertTrue(title.strip(), number)

    def test_markdown_local_links_resolve(self):
        files = [INDEX, *(DESIGN_DIR / name for name in DESIGN_FILES), README]
        for document in files:
            content = document.read_text(encoding="utf-8")
            with self.subTest(document=document.name):
                self.assertTrue(content.endswith("\n"))
                self.assertEqual(len(re.findall(r"^# ", content, re.MULTILINE)), 1)
                self.assertNotIn("\ufffd", content)
                self.assertNotIn("\x00", content)
                self.assertFalse(re.search(r"\b(?:TODO|FIXME|TBD)\b", content))
                for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", content):
                    parsed = urlsplit(target)
                    if parsed.scheme or target.startswith("#"):
                        continue
                    local = (document.parent / unquote(parsed.path)).resolve()
                    self.assertTrue(local.is_file(), f"{document.name}: {target}")

    def test_design_headings_and_tables_are_readable(self):
        for document in [INDEX, *(DESIGN_DIR / name for name in DESIGN_FILES)]:
            content = document.read_text(encoding="utf-8")
            lines = content.splitlines()
            with self.subTest(document=document.name):
                headings = re.findall(r"^(#{1,6}) (.+)$", content, re.MULTILINE)
                self.assertTrue(headings)
                previous = 0
                for marks, title in headings:
                    self.assertTrue(title.strip())
                    self.assertLessEqual(len(marks), previous + 1)
                    previous = len(marks)

                tables = []
                current = []
                for line in [*lines, ""]:
                    if line.startswith("|"):
                        current.append(line)
                    elif current:
                        tables.append(current)
                        current = []
                for table in tables:
                    self.assertGreaterEqual(len(table), 3)
                    widths = {len(row.strip("|").split("|")) for row in table}
                    self.assertEqual(len(widths), 1)
                    for cell in table[1].strip("|").split("|"):
                        self.assertRegex(cell.strip(), r"^:?-{3,}:?$")

    def test_readme_points_to_current_baseline(self):
        readme = README.read_text(encoding="utf-8")
        self.assertIn("产品设计文档 V0.5", readme)
        self.assertIn("技术设计文档清单", readme)
        self.assertNotIn("产品设计文档 V0.4", readme)


if __name__ == "__main__":
    unittest.main()
