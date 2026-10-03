"""Check that the technical design package is navigable and traceable to V0.9."""

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
        self.assertEqual([number for number, _ in rows], [f"R-{n:02d}" for n in range(1, 32)])
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
        self.assertIn("产品设计文档 V0.9", readme)
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
        self.assertEqual(definitions, [f"T-{n:02d}" for n in range(1, 26)])
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
            self.assertIn("V0.6", document.read_text(encoding="utf-8"), document.name)
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

    def test_profile_research_v6_contract_and_budget_are_consistent(self):
        data = (DESIGN_DIR / "02-数据模型与可信数据.md").read_text(encoding="utf-8")
        for field in (
            "profile-research-v6", "failureStage", "researchDirections", "followUpQuestions",
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
                for value in ("4096", "16384", "24", "40", "15分钟", "历史", "条件性", "画像"):
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

    def test_v6_school_tiers_evidence_budget_and_provider_retries_are_traceable(self):
        product = PRODUCT.read_text(encoding="utf-8")
        for phrase in ("5–10所不同学校", "每校一个主推荐专业", "未知不能默认合格", "年度预算", "不足5校", "硬限制"):
            self.assertIn(phrase, product)
        data = (DESIGN_DIR / "02-数据模型与可信数据.md").read_text(encoding="utf-8")
        for field in ("preferred/alternative/exploratory", "suitabilityTier", "suitabilityReason", "constraintChecks", "match/mismatch/unknown", "tuition", "location", "academic_year/program/semester/credit", "studyMode", "coverage", "targetMin:5", "targetMax:10", "exploratoryCount", "shortfallReasons", "旧v5报告"):
            self.assertIn(field, data)
        for path in (DESIGN_DIR / "07-DeepSeek接入与密钥管理.md", ROOT / "server" / "explanation" / "README.md"):
            content = path.read_text(encoding="utf-8")
            with self.subTest(document=path.name):
                for phrase in ("5–10所不同学校", "4–6个", "24次搜索", "40条搜索候选", "24次正文读取", "18次搜索", "16次读取", "最多6次搜索", "8次读取", "最多12条同校PDF附件候选", "15分钟", "失败不缓存", "24000字符", "规划与初次报告每阶段最多3次", "整份报告最多7次", "保留已有建议", "250毫秒", "beforeRetry", "PROVIDER_BALANCE_INSUFFICIENT", "PROVIDER_INVALID_REQUEST", "PROVIDER_TEMPORARY_UNAVAILABLE", "PROVIDER_NETWORK_ERROR", "60次", "300次", "每账号每日100000、全站300000", "同一额度", "不能直接与用户年度预算比较"):
                    self.assertIn(phrase, content)
                self.assertNotIn("整份报告至多四次模型调用", content)
                self.assertNotIn("整份报告最多6次", content)
                self.assertNotIn("默认12000", content)
                self.assertNotIn("默认每账号每天 20000", content)
                self.assertIn("v6学校覆盖、费用质量及真实端到端结果尚待独立验收", content)
        acceptance = (DESIGN_DIR / "05-安全运维与验证.md").read_text(encoding="utf-8")
        self.assertIn("| T-23 |", acceptance)
        self.assertIn("| T-24 |", acceptance)
        self.assertIn("达到5校的比例", acceptance)
        self.assertIn("各类失败码", acceptance)

    def test_comprehensive_tiers_and_academic_https_upgrade_preserve_boundaries(self):
        product = PRODUCT.read_text(encoding="utf-8")
        for phrase in ("第一级·优先推荐", "第二级·适合备选", "第三级·探索选择", "同费用学校可以不同层", "无可靠综合分层理由", "费用只是其中一个因素"):
            self.assertIn(phrase, product)
        for path in (DESIGN_DIR / "07-DeepSeek接入与密钥管理.md", ROOT / "server" / "explanation" / "README.md"):
            content = path.read_text(encoding="utf-8")
            with self.subTest(document=path.name):
                for phrase in ("suitabilityTier", "suitabilityReason", "tier/tierReasons", "同费用学校可以不同层", "options.upgradeAcademicHttp:true", "sourcesOnly:true", "WebSource.retrievalNote", "显式端口", "不会发送HTTP请求", "普通聊天与用户直接提供的URL不启用"):
                    self.assertIn(phrase, content)
                if path == ROOT / "server" / "explanation" / "README.md":
                    for phrase in ("demand-match-v1", "方向关联、培养路线及已核验城市", "服务端生成 `tier/tierReasons`", "模型的 `suitabilityTier/suitabilityReason` 不能改变服务端层级", "有城市偏好时，城市未知不满足优先比较条件", "费用只是一个因素", "5–10所不同学校", "不按同校多专业凑数量"):
                        self.assertIn(phrase, content)
                    self.assertNotIn("无可靠分层理由暂列探索", content)
                else:
                    # The versioned design retains its v6 boundary; current v7
                    # behaviour is documented and checked in the module README.
                    for phrase in ("无可靠分层理由暂列探索", "与综合分层独立"):
                        self.assertIn(phrase, content)
                self.assertNotIn("已取得证据确认预算或城市不符时归入", content)
        acceptance = (DESIGN_DIR / "05-安全运维与验证.md").read_text(encoding="utf-8")
        self.assertIn("同费用不同层", acceptance)
        self.assertIn("无可靠分层理由暂列探索", acceptance)

    def test_thinking_stream_and_model_dns_preserve_transport_and_billing_limits(self):
        for path in (DESIGN_DIR / "07-DeepSeek接入与密钥管理.md", ROOT / "server" / "explanation" / "README.md"):
            content = path.read_text(encoding="utf-8")
            with self.subTest(document=path.name):
                for phrase in ("stream:true", "stream_options.include_usage:true", "[DONE]", "finish_reason:stop", "reasoning_content", "8388608字节", "65536字节", "131072字节", "心跳不延长", "deepseek-transport.ts", "public-address.ts", "YANTU_DNS_MODE", "rejectUnauthorized:true", "98304字节", "不是供应商账户余额或充值"):
                    self.assertIn(phrase, content)
                self.assertNotIn("两层比较", content)
                self.assertNotIn("代码只允许本次探索方向", content)

    def test_current_profile_references_do_not_reconstruct_cleared_values(self):
        for path in (
            DESIGN_DIR / "02-数据模型与可信数据.md",
            DESIGN_DIR / "07-DeepSeek接入与密钥管理.md",
            ROOT / "server" / "explanation" / "README.md",
        ):
            content = path.read_text(encoding="utf-8")
            with self.subTest(document=path.name):
                for phrase in ("profile-research-v6", "profileField", "profileValue", "profileEvidence", "当前原值", "已清空notes", "中性优先级50", "隔离该条", "至少两个不同真实画像维度", "一次有界修复"):
                    self.assertIn(phrase, content)
        api = (DESIGN_DIR / "04-接口与前端交互.md").read_text(encoding="utf-8")
        self.assertIn("新的profileVersion", api)
        self.assertIn("不能用旧值填补已清空内容", api)
        guide = (ROOT / "docs" / "本地模型与联网测试.md").read_text(encoding="utf-8")
        for phrase in ("未保存原始模型回答", "不能断定是哪一字段", "不是本次v5真实生成结果", "新画像版本4"):
            self.assertIn(phrase, guide)

    def test_preferred_city_coverage_and_location_ownership_are_traceable(self):
        for path in (DESIGN_DIR / "07-DeepSeek接入与密钥管理.md", ROOT / "server" / "explanation" / "README.md"):
            content = path.read_text(encoding="utf-8")
            with self.subTest(document=path.name):
                for phrase in ("最多4次读取", "初期最多20次", "总计仍最多24次正文读取", "同一综合推荐层级", "preferredCities", "preferredCitySchoolCount", "unknownCitySchoolCount", "PREFERRED_CITY_COVERAGE_INCOMPLETE", "城市未知不计入匹配", "最多一次覆盖分析", "合作单位地址", "历史报告保留原内容"):
                    self.assertIn(phrase, content)
        self.assertIn("| T-25 |", (DESIGN_DIR / "05-安全运维与验证.md").read_text(encoding="utf-8"))
        self.assertIn("shared/cities.ts", (ROOT / "docs" / "city-data.md").read_text(encoding="utf-8"))

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

    def test_deployment_preparation_links_and_recovery_limits_are_documented(self):
        path = ROOT / "docs" / "长期部署.md"
        content = path.read_text(encoding="utf-8")
        for phrase in ("没有服务器和域名", "尚未在实际 Linux 服务器执行", "一个 Node.js 应用进程", "YANTU_TRUSTED_PROXY_IPS", "/api/v1/health", "backup-database.mjs", "--source", "--destination", "integrity_check", "foreign_key_check", "删除状态", "撤销快照内旧会话", "没有设置定时备份", "不能将进程内额度当作长期账单硬上限"):
            self.assertIn(phrase, content)
        for target in re.findall(r"\]\(([^)]+)\)", content):
            parts = urlsplit(target)
            if not parts.scheme and not parts.netloc:
                self.assertTrue((path.parent / unquote(parts.path)).resolve().is_file(), target)
        self.assertIn("长期部署.md", README.read_text(encoding="utf-8"))

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
