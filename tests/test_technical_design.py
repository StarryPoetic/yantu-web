"""Check that the technical design package is navigable and traceable to V0.8."""

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
    "06-诊断型题库与分层选题.md",
    "07-DeepSeek接入与密钥管理.md",
    "08-变更与扩展约定.md",
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
        self.assertEqual([number for number, _ in rows], [f"R-{n:02d}" for n in range(1, 30)])
        self.assertEqual(len(set(number for number, _ in rows)), len(rows))
        for number, title in rows:
            self.assertTrue(title.strip(), number)

    def test_markdown_local_links_resolve(self):
        files = [INDEX, *(DESIGN_DIR / name for name in DESIGN_FILES), README,
                 ROOT / "docs" / "实施说明.md", ROOT / "docs" / "本地模型与联网测试.md", ROOT / "knowledge" / "README.md",
                 ROOT / "knowledge" / "catalog" / "README.md",
                 ROOT / "knowledge" / "questions" / "README.md",
                 ROOT / "server" / "explanation" / "README.md"]
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
        self.assertIn("产品设计文档 V0.8", readme)
        self.assertIn("技术设计文档清单", readme)
        self.assertNotIn("产品设计文档 V0.4", readme)

    def test_september_27_additions_are_traceable(self):
        content = INDEX.read_text(encoding="utf-8")
        ids = re.findall(r"^\| (U-\d{2}) \|", content, re.MULTILINE)
        self.assertEqual(ids, ["U-01", "U-02", "U-03", "U-04"])

    def test_decisions_have_one_owner_and_explicit_gates(self):
        owner = "08-变更与扩展约定.md"
        definitions = {}
        for document in DESIGN_DIR.glob("*.md"):
            content = document.read_text(encoding="utf-8")
            for line in content.splitlines():
                if not re.match(r"^\| D-\d{2} \|", line):
                    continue
                cells = [cell.strip() for cell in line.strip("|").split("|")]
                self.assertEqual(document.name, owner)
                self.assertEqual(len(cells), 5)
                self.assertTrue(all(cells))
                self.assertIn(cells[1], {"拟议", "待定", "部分确定", "已确定", "已替代"})
                self.assertNotIn(cells[0], definitions)
                definitions[cells[0]] = cells
        self.assertEqual(set(definitions), {f"D-{n:02d}" for n in range(1, 13)})
        for document in DESIGN_DIR.glob("*.md"):
            references = set(re.findall(r"\bD-\d{2}\b", document.read_text(encoding="utf-8")))
            self.assertLessEqual(references, set(definitions), document.name)

    def test_acceptance_references_resolve_and_cover_every_requirement(self):
        owner = DESIGN_DIR / "05-安全运维与验证.md"
        definitions = re.findall(r"^\| (T-\d{2}) \|", owner.read_text(encoding="utf-8"), re.MULTILINE)
        self.assertEqual(definitions, [f"T-{n:02d}" for n in range(1, 23)])
        covered = set()
        for document in DESIGN_DIR.glob("*.md"):
            content = document.read_text(encoding="utf-8")
            refs = set(re.findall(r"\bT-\d{2}\b", content))
            self.assertLessEqual(refs, set(definitions), document.name)
            if document != owner:
                self.assertFalse(re.search(r"^\| T-\d{2} \|", content, re.MULTILINE))
            if document == INDEX:
                for row in content.splitlines():
                    if re.match(r"^\| [RU]-\d{2} \|", row):
                        targets = set(re.findall(r"\bT-\d{2}\b", row))
                        self.assertTrue(targets, row.split("|")[1])
                        covered.update(targets)
        self.assertEqual(covered, set(definitions))

    def test_contract_names_do_not_reintroduce_old_aliases(self):
        deprecated = re.compile(r"\b(?:assessmentVersion|dataVersion|runId|release_id|project_id|project_revision_id)\b")
        for document in DESIGN_DIR.glob("*.md"):
            self.assertFalse(deprecated.search(document.read_text(encoding="utf-8")), document.name)
        dictionary = (DESIGN_DIR / "02-数据模型与可信数据.md").read_text(encoding="utf-8")
        for field in ("selectionVersion", "assessmentRefs[]", "recommendationRunId", "deletionGeneration"):
            self.assertIn(f"`{field}`", dictionary)

    def test_current_version_and_new_contract_boundaries(self):
        for document in [INDEX, *(DESIGN_DIR / name for name in DESIGN_FILES)]:
            self.assertIn("V0.5", document.read_text(encoding="utf-8"), document.name)
        api = (DESIGN_DIR / "04-接口与前端交互.md").read_text(encoding="utf-8")
        for route in (
            "PUT /api/v1/me/target", "GET /api/v1/research/status",
            "POST /api/v1/guidance/{guidanceRunId}/research",
            "GET /api/v1/guidance/{guidanceRunId}/research/latest",
            "GET /api/v1/research-jobs/{jobId}",
        ):
            self.assertIn(f"`{route}`", api)
        for phrase in ("左右对齐", "不显示空字母", "三色方格", "解释图只在提交后开放", "不自动付费重试"):
            self.assertIn(phrase, api)
        data = (DESIGN_DIR / "02-数据模型与可信数据.md").read_text(encoding="utf-8")
        for field in ("ResearchJob", "ResearchReport", "research-latest", "needsRefresh/refreshReasons", "valid=false"):
            self.assertIn(field, data)

    def test_profile_research_v4_contract_and_budget_are_consistent(self):
        data = (DESIGN_DIR / "02-数据模型与可信数据.md").read_text(encoding="utf-8")
        for field in (
            "profile-research-v4", "failureStage", "researchDirections", "followUpQuestions",
            "programName", "degreeType", "fitReasons", "profileField", "profileValue",
            "tradeoffs", "admissionStatus", "current_evidence", "needs_verification",
        ):
            self.assertIn(field, data)
        for path in (
            DESIGN_DIR / "07-DeepSeek接入与密钥管理.md",
            ROOT / "server" / "explanation" / "README.md",
            ROOT / "docs" / "本地模型与联网测试.md",
            README,
        ):
            content = path.read_text(encoding="utf-8")
            with self.subTest(document=path.name):
                for value in ("4096", "12000", "16384", "六次", "十二项", "历史", "条件性", "画像"):
                    self.assertIn(value, content)
                for obsolete in (
                    "最多三次搜索", "最多三次检索", "最多检索三个专业方向",
                    "据此生成的资格摘录与学校建议会移除",
                    "不能支撑当前资格摘录与最终学校建议",
                    "每项学校建议均引用对应目标年度的学校官网正文",
                    "不发送姓名、本科院校字段",
                ):
                    self.assertNotIn(obsolete, content)
        api = (DESIGN_DIR / "04-接口与前端交互.md").read_text(encoding="utf-8")
        for phrase in ("页面首先展示具体学校", "可展开区域", "不能显示为“已符合报考资格”", "旧报告缺字段"):
            self.assertIn(phrase, api)
        self.assertIn("旧基础探索默认折叠", api)
        model = (DESIGN_DIR / "07-DeepSeek接入与密钥管理.md").read_text(encoding="utf-8")
        for phrase in ("includeDomains", "原生 `include`", "用户城市偏好", "不来自HTTP请求", "不做无界重试", "research-search.ts", "最多两个具体学校根域", "跨方向轮流", "searchSchools", "仅为检索线索"):
            self.assertIn(phrase, model)
        for phrase in ("核心学校身份", "至少两个有效且不同的真实画像维度", "至少一项有效取舍", "未取得资料不等于学校尚未发布"):
            self.assertIn(phrase, model)
        for path in (
            DESIGN_DIR / "07-DeepSeek接入与密钥管理.md",
            ROOT / "server" / "explanation" / "README.md",
            ROOT / "docs" / "实施说明.md",
            ROOT / "docs" / "本地模型与联网测试.md",
        ):
            evidence_record = path.read_text(encoding="utf-8")
            with self.subTest(real_evidence_record=path.name):
                for phrase in ("复用", "不是全新端到端搜索", "RESEARCH_PARTIAL_VALIDATION", "needs_verification", "模拟"):
                    self.assertIn(phrase, evidence_record)
                self.assertNotIn("当时v2因缺2027", evidence_record)
        for phrase in ("research-generation.ts", "最多修复一次", "非思考", "4096", "30秒", "failureStage", "校名＋专业＋硕士", "第二所学校", "具体专业的代码/句段", "实际学校标识"):
            self.assertIn(phrase, model)
        self.assertNotIn("第一轮有校名线索时用“校名＋官网”", model)
        self.assertNotIn("每次默认12000输出token，两次均含思考输出", model)
        for phrase in ("allowPdf:true", "maxPdfBytes:5000000", "普通问答默认false", "pdf-parse@2.4.5", "512000", "80页", "120000字符", "独立隐藏Node子进程", "不做OCR", "NODE_OPTIONS", "WEB_PDF_TIMEOUT"):
            self.assertIn(phrase, model)

    def test_http_routes_are_explicit_and_unique(self):
        content = (DESIGN_DIR / "04-接口与前端交互.md").read_text(encoding="utf-8")
        routes = re.findall(r"^\| `(GET|POST|PUT|PATCH|DELETE) (/api/v1/[^`]+)` \|", content, re.MULTILINE)
        self.assertTrue(routes)
        self.assertEqual(len(routes), len(set(routes)))
        for method, path in routes:
            self.assertNotIn("...", path)
            self.assertNotIn(" ", path)
            self.assertNotIn("{id}", path)
            self.assertEqual(path.count("{"), path.count("}"))
        route_rows = [line for line in content.splitlines() if line.startswith("| `") and "/api/v1/" in line]
        self.assertEqual(len(route_rows), len(routes), "Each API row needs one explicit method and path")

    def test_domestic_search_setup_matches_server_environment_contract(self):
        guide = (ROOT / "docs" / "本地模型与联网测试.md").read_text(encoding="utf-8")
        example = (ROOT / ".env.example").read_text(encoding="utf-8")
        for setting in ("YANTU_SEARCH_PROVIDER=bocha", "BOCHA_API_KEY=", "YANTU_SEARCH_ENABLED="):
            self.assertIn(setting, guide)
            self.assertIn(setting, example)
        self.assertIn("https://open.bochaai.com/login", guide)
        self.assertIn("以当前账户为准", guide)
        self.assertIn("不需要先把网站部署到公网", guide)
        self.assertIn("YANTU_DNS_MODE=system", guide)
        self.assertIn("YANTU_DNS_MODE=system", example)
        self.assertIn("YANTU_DNS_MODE=public-doh", guide)

    def test_project_artifacts_do_not_contain_live_key_shapes(self):
        credential = re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")
        files = [README, ROOT / ".gitignore"]
        for directory in ("src", "public", "docs", "scripts", "server", "knowledge", "tests", "dist"):
            files.extend(path for path in (ROOT / directory).rglob("*")
                         if path.is_file() and "__pycache__" not in path.parts
                         and path.suffix in (".md", ".py", ".ts", ".tsx", ".js", ".json", ".html", ".css", ".svg"))
        for document in files:
            found = bool(credential.search(document.read_text(encoding="utf-8")))
            safe_path = credential.sub("[REDACTED]", str(document.relative_to(ROOT)))
            self.assertFalse(found, f"Credential-like material in {safe_path}")



if __name__ == "__main__":
    unittest.main()
