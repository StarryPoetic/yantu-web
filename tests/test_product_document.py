"""Validate the product document's packaging and Markdown integrity.

Content is also reviewed against the conversation requirements. These checks
validate the document artifact, not an implemented recommendation service.
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


if __name__ == "__main__":
    unittest.main()
