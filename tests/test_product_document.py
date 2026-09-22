"""Validate the product document's packaging and Markdown integrity.

Content is also reviewed against the conversation requirements. These checks
validate the document artifact and its assessment-stage boundaries, not an
implemented recommendation service.
"""

from pathlib import Path
import re
import unittest
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
DOCUMENT = ROOT / "docs" / "产品设计文档.md"


class ProductDocumentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = DOCUMENT.read_text(encoding="utf-8")
        cls.lines = cls.content.splitlines()

    def test_utf8_and_no_unfinished_placeholders(self):
        self.assertTrue(self.content.endswith("\n"))
        self.assertNotIn("\ufffd", self.content)
        self.assertNotIn("\x00", self.content)
        self.assertFalse(re.search(r"\b(?:TODO|FIXME|TBD)\b", self.content))

    def test_heading_hierarchy_and_unique_titles(self):
        headings = re.findall(r"^(#{1,6}) (.+)$", self.content, re.MULTILINE)
        self.assertTrue(headings)
        self.assertEqual(sum(len(level) == 1 for level, _ in headings), 1)
        previous = 0
        titles = set()
        for level, title in headings:
            self.assertLessEqual(len(level), previous + 1)
            self.assertNotIn(title, titles)
            titles.add(title)
            previous = len(level)

    def test_tables_have_headers_and_consistent_columns(self):
        tables = []
        current = []
        for line in self.lines + [""]:
            if line.startswith("|"):
                current.append(line)
            elif current:
                tables.append(current)
                current = []
        self.assertTrue(tables, "The functional overview must retain its tables")
        for table in tables:
            self.assertGreaterEqual(len(table), 3)
            widths = {len(row.strip("|").split("|")) for row in table}
            self.assertEqual(len(widths), 1)
            for cell in table[1].strip("|").split("|"):
                self.assertRegex(cell.strip(), r"^:?-{3,}:?$")

    def test_reference_links_are_valid_and_local_targets_exist(self):
        links = re.findall(r"\[([^\]]+)\]\(([^)]+)\)", self.content)
        self.assertTrue(links, "The document must retain its reference links")
        for label, target in links:
            self.assertTrue(label.strip())
            parsed = urlsplit(target)
            if parsed.scheme:
                self.assertEqual(parsed.scheme, "https")
                self.assertTrue(parsed.hostname)
                self.assertFalse(any(char.isspace() for char in target))
            elif parsed.path:
                self.assertTrue((DOCUMENT.parent / unquote(parsed.path)).is_file())

    def test_undecided_student_flow_prioritizes_major_selection(self):
        flow = re.search(r"^\*\*填写.+?\*\*$", self.content, re.MULTILINE)
        self.assertIsNotNone(flow)
        steps = flow.group().split(" → ")
        required_stages = ("公共课测评", "专业推荐与选择", "院校项目匹配")
        indices = []
        for stage in required_stages:
            matches = [i for i, step in enumerate(steps) if stage in step]
            self.assertEqual(len(matches), 1, stage)
            indices.append(matches[0])
        self.assertEqual(indices, sorted(indices))
        self.assertFalse(any("专业课测评" in step for step in steps[:indices[1] + 1]))

    def test_assessment_subjects_and_specialty_prerequisite(self):
        rows = {}
        for line in self.lines:
            if line.startswith("|"):
                cells = [cell.strip() for cell in line.strip("|").split("|")]
                if len(cells) == 2:
                    rows[cells[0]] = cells[1]
        initial = rows["公共课测评"]
        for subject in ("数学", "英语", "政治"):
            self.assertIn(subject, initial)
        self.assertNotRegex(initial, r"专业(?:课|技能|基础)(?:测评|测试)")
        specialty = rows["专业课测评（专业确定后可选）"]
        self.assertIn("确认专业后", specialty)
        self.assertIn("可以跳过", specialty)
        self.assertRegex(self.content, r"专业已确定 → 专业课测评")

    def test_degree_guidance_has_accessible_explanation_and_mvp_scope(self):
        guidance = next(line for line in self.lines if line.startswith("| 学硕/专硕建议与解释 |"))
        self.assertIn("说明按钮", guidance)
        self.assertIn("点击或触摸", guidance)
        scope = self.content.split("## 6. 首版 MVP 范围", 1)[1].split("## 7.", 1)[0]
        for requirement in ("专业选择", "学硕/专硕解释入口", "专业确认后", "不列为首版必备"):
            self.assertIn(requirement, scope)


if __name__ == "__main__":
    unittest.main()
