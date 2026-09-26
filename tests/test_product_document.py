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
        cls.table_rows = {}
        for line in cls.lines:
            if line.startswith("|"):
                cells = [cell.strip() for cell in line.strip("|").split("|")]
                if len(cells) == 2:
                    cls.table_rows[cells[0]] = cells[1]

    def test_utf8_and_no_unfinished_placeholders(self):
        self.assertTrue(self.content.endswith("\n"))
        self.assertNotIn("\ufffd", self.content)
        self.assertNotIn("\x00", self.content)
        self.assertFalse(re.search(r"\b(?:TODO|FIXME|TBD)\b", self.content))

    def test_current_requirement_version_is_declared(self):
        self.assertRegex(self.content, r"版本：V0\.6 · 日期：\d{4}-\d{2}-\d{2}")

    def test_complete_journey_and_national_scope_are_requirements(self):
        for phrase in ("14 个学科门类", "117 个一级学科", "67 个专业学位类别", "不默认计算机", "下拉", "自动进入公共课测评", "推荐结论", "每一道题", "行列式", "圆球", "连续追问", "注册只创建学生账号", "跨设备"):
            self.assertIn(phrase, self.content)
        scope = self.content.split("## 6. 首版 MVP 范围", 1)[1].split("## 7.", 1)[0]
        self.assertNotIn("后续再扩展全学科覆盖", scope)
        self.assertNotIn("先面向准备全日制考研的理工科", scope)

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

    def test_undecided_student_flow_supports_joint_selection(self):
        flow = re.search(r"^\*\*填写.+?\*\*$", self.content, re.MULTILINE)
        self.assertIsNotNone(flow)
        steps = flow.group().split(" → ")
        required_stages = ("公共课测评", "专业与院校联合推荐", "双向比较与调整", "确定专业与院校组合")
        indices = []
        for stage in required_stages:
            matches = [i for i, step in enumerate(steps) if stage in step]
            self.assertEqual(len(matches), 1, stage)
            indices.append(matches[0])
        self.assertEqual(indices, sorted(indices))
        self.assertFalse(any("专业课测评" in step for step in steps[:indices[1] + 1]))

    def test_major_and_school_selection_are_both_core_mvp(self):
        for module in ("专业推荐与选择", "院校推荐与选择"):
            self.assertIn(f"{module}（核心 MVP）", self.table_rows)
        scope = self.content.split("## 6. 首版 MVP 范围", 1)[1].split("## 7.", 1)[0]
        for requirement in ("专业选择与院校选择", "并重", "专业与院校联合推荐", "双向比较与调整"):
            self.assertIn(requirement, scope)
        acceptance = self.content.split("## 7. 首版验收方向", 1)[1].split("## 参考资料", 1)[0]
        for behavior in ("调整专业方向时更新候选院校", "调整院校偏好时更新适合的专业"):
            self.assertIn(behavior, acceptance)

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
        guidance = self.table_rows["学硕/专硕建议与解释"]
        self.assertIn("说明按钮", guidance)
        self.assertIn("点击或触摸", guidance)
        scope = self.content.split("## 6. 首版 MVP 范围", 1)[1].split("## 7.", 1)[0]
        for requirement in ("专业选择", "学硕/专硕解释入口", "专业确认后", "不列为首版必备"):
            self.assertIn(requirement, scope)

    def test_city_picker_has_search_order_selection_and_uncertainty(self):
        city_requirement = self.table_rows["意向城市选择"]
        for behavior in (
            "全国城市下拉列表", "拼音首字母 A–Z 分组排序", "中文",
            "拼音", "多选", "移除", "自定义城市", "不确定", "互斥", "保存",
        ):
            self.assertIn(behavior, city_requirement)

    def test_overlay_interactions_keep_navigation_and_close_controls_visible(self):
        interactions = self.content.split("### 3.2. 说明弹窗与城市浮层交互", 1)[1].split("## 4.", 1)[0]
        for behavior in (
            "加宽弹窗", "手机端改为单列", "关闭按钮固定在顶部",
            "独立区域内滚动", "焦点回到入口", "向上翻转", "重新定位并调整高度",
            "列表独立滚动", "不能连带滚动整个页面", "← →", "↑ ↓",
            "Home / End", "Enter 选择", "Esc 收起", "四方向移动按钮",
        ):
            self.assertIn(behavior, interactions)

    def test_assessment_modules_have_five_questions_and_no_math_requirement(self):
        public_row = self.table_rows["公共课测评"]
        specialty_row = self.table_rows["专业课测评（专业确定后可选）"]
        for requirement in ("数学", "英语", "政治", "每科 5", "共 15", "不强制"):
            self.assertIn(requirement, public_row)
        for requirement in ("确认专业后", "5 道", "可以跳过", "不阻断"):
            self.assertIn(requirement, specialty_row)
        self.assertIn("取消数学后可完成英语与政治共 10 题", self.content)

    def test_assessment_navigation_requires_explicit_final_submission(self):
        interaction = self.content.split("### 3.1. 测评交互细则", 1)[1].split("## 4.", 1)[0]
        for requirement in (
            "短暂的选中反馈", "自动跳到下一题", "末题选中后停留",
            "主动点击提交", "不能自动提交", "返回检查与修改答案",
            "不得丢失", "旧版 6 题缓存", "独立版本记录", "删除个人资料",
        ):
            self.assertIn(requirement, interaction)

    def test_readability_and_mobile_overflow_are_acceptance_requirements(self):
        readability = self.table_rows["阅读与响应式适配"]
        for requirement in ("16px", "12px", "14px", "375px", "不裁切", "无横向溢出", "自然换行"):
            self.assertIn(requirement, readability)
        acceptance = self.content.split("## 7. 首版验收方向", 1)[1].split("## 参考资料", 1)[0]
        self.assertIn("正文默认 16px", acceptance)
        self.assertIn("375px", acceptance)


if __name__ == "__main__":
    unittest.main()
