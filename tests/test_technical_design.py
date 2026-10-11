"""Check that the technical design package is navigable and traceable to V1.0."""

from pathlib import Path
import re
import unittest
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
DESIGN_DIR = ROOT / "docs" / "技术设计"
INDEX = DESIGN_DIR / "00-文档清单与需求映射.md"
PRODUCT = ROOT / "docs" / "产品设计文档.md"
README = ROOT / "README.md"
B = {key: int(value) for key, value in re.findall(r'^  (\w+): (\d+),', (ROOT / 'server/explanation/research-budget.ts').read_text(encoding='utf-8'), re.M)}


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
        self.assertEqual([number for number, _ in rows], [f"R-{n:02d}" for n in range(1, 39)])
        self.assertEqual(len(set(number for number, _ in rows)), len(rows))
        for number, title in rows:
            self.assertTrue(title.strip(), number)

    def test_markdown_local_links_resolve(self):
        files = [INDEX, *(DESIGN_DIR / name for name in DESIGN_FILES), README,
                 ROOT / "docs" / "实施说明.md", ROOT / "docs" / "本地模型与联网测试.md", ROOT / "knowledge" / "README.md",
                 ROOT / "knowledge" / "catalog" / "README.md",
                 ROOT / "knowledge" / "schools" / "README.md",
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
        self.assertIn("产品设计文档 V1.0", readme)
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
        self.assertEqual(set(definitions), {f"D-{n:02d}" for n in range(1, 16)})
        for document in DESIGN_DIR.glob("*.md"):
            references = set(re.findall(r"\bD-\d{2}\b", document.read_text(encoding="utf-8")))
            self.assertLessEqual(references, set(definitions), document.name)

    def test_acceptance_references_resolve_and_cover_every_requirement(self):
        owner = DESIGN_DIR / "05-安全运维与验证.md"
        definitions = re.findall(r"^\| (T-\d{2}) \|", owner.read_text(encoding="utf-8"), re.MULTILINE)
        self.assertEqual(definitions, [f"T-{n:02d}" for n in range(1, 33)])
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
            self.assertIn("V0.7", document.read_text(encoding="utf-8"), document.name)
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

    def test_current_research_contract_preserves_v6_and_existing_budget(self):
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
                for phrase in ("5–10所不同学校", "4–6个", "24次搜索", f"{B['candidates']}条搜索候选", f"{B['reads']}次正文读取", f"{B['initialSearches']}次搜索", f"{B['initialReads']}次读取", f"最多{B['feeSearches']}次搜索", f"{B['cityReads']}次读取", f"最多{B['attachments']}条同校PDF附件候选", "15分钟", "失败不缓存", f"{B['thinkingChars']}字符", "规划与初次报告每阶段最多3次", "整份报告最多6次", "保留已有建议", "250毫秒", "beforeRetry", "PROVIDER_BALANCE_INSUFFICIENT", "PROVIDER_INVALID_REQUEST", "PROVIDER_TEMPORARY_UNAVAILABLE", "PROVIDER_NETWORK_ERROR", "60次", "300次", f"每账号每日{B['userDailyTokens']}、全站{B['globalDailyTokens']}", "同一额度", "不能直接与用户年度预算比较"):
                    self.assertIn(phrase, content)
                self.assertNotIn("整份报告至多四次模型调用", content)
                self.assertNotIn("整份报告最多7次", content)
                self.assertNotIn("默认12000", content)
                self.assertNotIn("默认每账号每天 20000", content)
                self.assertIn("v6学校覆盖、费用质量及真实端到端结果尚待独立验收", content)
        acceptance = (DESIGN_DIR / "05-安全运维与验证.md").read_text(encoding="utf-8")
        self.assertIn("| T-23 |", acceptance)
        self.assertIn("| T-24 |", acceptance)
        self.assertIn("达到5校的比例", acceptance)
        self.assertIn("各类失败码", acceptance)

    def test_comprehensive_tiers_and_academic_http_research_preserve_boundaries(self):
        product = PRODUCT.read_text(encoding="utf-8")
        for phrase in ("第一级·优先推荐", "第二级·适合备选", "第三级·探索选择", "同费用学校可以不同层", "无可靠综合分层理由", "费用只是其中一个因素"):
            self.assertIn(phrase, product)
        for path in (DESIGN_DIR / "07-DeepSeek接入与密钥管理.md", ROOT / "server" / "explanation" / "README.md"):
            content = path.read_text(encoding="utf-8")
            with self.subTest(document=path.name):
                for phrase in ("suitabilityTier", "suitabilityReason", "tier/tierReasons", "同费用学校可以不同层", "options.upgradeAcademicHttp:true", "sourcesOnly:true", "WebSource.retrievalNote", "显式端口", "研究会按原始HTTP地址读取", "普通聊天与用户直接提供的URL不启用"):
                    self.assertIn(phrase, content)
                if path == ROOT / "server" / "explanation" / "README.md":
                    for phrase in ("demand-match-v1", "方向关联、培养路线及已核验城市", "服务端生成 `tier/tierReasons`", "模型的 `suitabilityTier/suitabilityReason` 不能改变服务端层级", "有城市偏好时，城市未知不满足优先比较条件", "费用只是一个因素", "5–10所不同学校", "不按同校多专业凑数量"):
                        self.assertIn(phrase, content)
                    self.assertNotIn("无可靠分层理由暂列探索", content)
                else:
                    # Preserve historical v6 wording while enforcing current v7 rules.
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
                for phrase in ("stream:true", "stream_options.include_usage:true", "[DONE]", "finish_reason:stop", "reasoning_content", "8388608字节", "65536字节", "131072字节", "心跳不延长", "deepseek-transport.ts", "public-address.ts", "YANTU_DNS_MODE", "rejectUnauthorized:true", f"{B['requestBytes']}字节", "不是供应商账户余额或充值"):
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
                for phrase in (f"追加{B['cityReads']}次读取", f"最多{B['initialReads']}次读取", f"最多{B['reads']}次正文读取", "同一综合推荐层级", "preferredCities", "preferredCitySchoolCount", "unknownCitySchoolCount", "PREFERRED_CITY_COVERAGE_INCOMPLETE", "城市未知不计入匹配", "最多一次覆盖分析", "合作单位地址", "历史报告保留原内容"):
                    self.assertIn(phrase, content)
        self.assertIn("| T-25 |", (DESIGN_DIR / "05-安全运维与验证.md").read_text(encoding="utf-8"))
        self.assertIn("shared/cities.ts", (ROOT / "docs" / "city-data.md").read_text(encoding="utf-8"))

    def test_program_evidence_supplement_contract_is_bounded_and_traceable(self):
        documents = (
            DESIGN_DIR / "04-接口与前端交互.md",
            ROOT / "server" / "explanation" / "README.md",
        )
        modules = (
            "shared/research-coverage.ts",
            "server/explanation/research-coverage.ts",
            "server/explanation/research-library.ts",
            "server/explanation/research-repair.ts",
            "server/explanation/research.ts",
            "server/routes/research.ts",
            "src/workspace/ResearchEvidenceCoverage.tsx",
            "src/workspace/ResearchPanel.tsx",
        )
        for module in modules:
            with self.subTest(module=module):
                self.assertTrue((ROOT / module).is_file(), module)
        for document in documents:
            content = document.read_text(encoding="utf-8")
            with self.subTest(document=document.name):
                for value in (
                    "POST /api/v1/guidance/{guidanceRunId}/research/supplement",
                    "{}", "X-CSRF-Token", "Idempotency-Key", "queued/running",
                    "同一在途任务", "base report", "queued", "latest",
                    "失败保留历史报告", "不自动", "付费重试",
                    "candidateAudit[].coverage.programs", "program-evidence-v1",
                    "program/exams/location/tuition/eligibility/curriculum",
                    "supported_current/supported_reference/missing/ambiguous/not_applicable/excluded",
                    "sourceIds/references", "下一动作", "失败原因", "尝试时间",
                    "reusedSourceCount/supplementedSourceCount/lookupKeys/attempts",
                    "仅统计本次实际调查", "不代表全国院校资料已全部覆盖",
                    "24 次搜索", f"{B['reads']} 次正文读取", "不做无界重试",
                    *modules,
                ):
                    self.assertIn(value, content)

    def test_three_tier_school_models_and_research_transport_boundaries(self):
        architecture = (DESIGN_DIR / "01-总体架构与演进.md").read_text(encoding="utf-8")
        for phrase in (
            "三层资料", "正式目录", "公共院校资料库", "实时检索", "research_public_sources",
            "院校种子库", "预抓取脚本", "research-library.ts", "demand-match-v1",
            "模型只提供解释，不能改变层级", "阶段0不实现业务代码",
        ):
            self.assertIn(phrase, architecture)
        data = (DESIGN_DIR / "02-数据模型与可信数据.md").read_text(encoding="utf-8")
        for phrase in (
            "SchoolRegistryEntry", "name、aliases、province、city、registrableDomain",
            "graduateAdmissionsUrl、campusHints、tags、discoveryUrls、locationDiscoveryUrls、provenanceUrl、verification", "ProgramFact",
            "schoolName、registrableDomain、year、collegeName、majorCode、programName",
            "degreeType、studyMode、exams、tuition、campus、sourceId、quote、extractedAt、extractor",
            "WebSource.transport", "`https`/`http`", "WebSource.redirectChain",
            "librarySchoolCount/libraryProgramCount", "validationIssues", "被拒原因", "读取尝试",
            "verified:false", "最多3跳", "每跳重新公网 DNS 校验并固定连接 IP",
        ):
            self.assertIn(phrase, data)
        model = (DESIGN_DIR / "07-DeepSeek接入与密钥管理.md").read_text(encoding="utf-8")
        policy = model.split("### 3.1. 研究读取策略（V0.7）", 1)[1].split("## 4.", 1)[0]
        for phrase in (
            "同校跳转", "最多3次", "每跳重新", "固定连接IP", "跨校跳转", "私网", "IP直连",
            "`.edu.cn` 明文 HTTP仅限研究流程", "普通咨询与用户自填网址仍只用 HTTPS、不跟随跳转",
            "WebSource.transport:'http'", "明文传输", "GBK/GB18030", "gzip/deflate/br",
            "大小上限", "时间和取消限制", "细分读取失败码", "includeDomains",
            "先查公共院校资料库", "yz.chsi.com.cn", "verified:false", "只删除该句",
            "阶段1已实现研究HTTP及同校有限跳转", "阶段5统一替换为60次读取、每校8次、24次搜索与80条候选",
        ):
            self.assertIn(phrase, policy)
        current = model.split("当前v7以", 1)[1].split("历史v6以", 1)[0]
        for phrase in ("demand-match-v1", "模型只提供解释，不能改变层级", "不参与排序"):
            self.assertIn(phrase, current)
        for path in (
            DESIGN_DIR / "04-接口与前端交互.md", DESIGN_DIR / "07-DeepSeek接入与密钥管理.md",
            DESIGN_DIR / "08-变更与扩展约定.md", README,
            ROOT / "docs" / "实施说明.md", ROOT / "docs" / "本地模型与联网测试.md",
            ROOT / "docs" / "recommendation-method.md", ROOT / "server" / "explanation" / "README.md",
        ):
            with self.subTest(document=path.name):
                content = path.read_text(encoding="utf-8")
                self.assertIn("profile-research-v7", content)
                self.assertIn("兼容旧版", content)
                self.assertIn("profile-research-v6", content)

    def test_phase_zero_traceability_covers_collection_and_baseline(self):
        index = INDEX.read_text(encoding="utf-8")
        for requirement, acceptance in zip(range(32, 39), range(26, 33)):
            row = next(line for line in index.splitlines() if line.startswith(f"| R-{requirement} |"))
            self.assertIn(f"T-{acceptance}", row)
        acceptance = (DESIGN_DIR / "05-安全运维与验证.md").read_text(encoding="utf-8")
        for phrase in (
            "≥300所", "31个省级行政区", "robots.txt", "间隔≥1秒", "研招网",
            "并发读取共享总预算", "结构化事实", "共享额度", "已读但未结构化",
            "当前v7按 `demand-match-v1` 固定规则分层，模型理由不改变层级",
            "真实联网验证与模拟测试分开记录", "57.5%", "59%", "0/1/0", "39%",
        ):
            self.assertIn(phrase, acceptance)
        api = (DESIGN_DIR / "04-接口与前端交互.md").read_text(encoding="utf-8")
        for phrase in ("资料库已收录 X 校 Y 专业、本次复用 Z 条、新读 W 条", "逐字段状态", "已读但未结构化", "待确认", "明文传输", "继续补查", "demand-match-v1", "模型只提供解释，不能改变层级"):
            self.assertIn(phrase, api)
        decisions = (DESIGN_DIR / "08-变更与扩展约定.md").read_text(encoding="utf-8")
        for decision, status in ((13, "已确定"), (14, "已确定"), (15, "已确定")):
            self.assertIn(f"| D-{decision} | {status} |", decisions)
        implementation = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        self.assertIn("## 13. 院校资料收集修复（2026-10-11）", implementation)
        self.assertNotIn("院校资料收集修复（2026-10-11，进行中）", implementation)
        self.assertIn("阶段7真实验证记录", implementation)
        self.assertNotIn("固定六次总预算", implementation)
        for phase in range(1, 8):
            self.assertIn(f"阶段{phase}", implementation)

    def test_live_verification_record_separates_costs_denominators_and_manual_scope(self):
        implementation = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        record = (ROOT / "docs" / "阶段7真实验证记录.md").read_text(encoding="utf-8")
        for commit in ("54bc68f", "4017bef", "0a131f9", "a10d71e", "1bf14ba", "a797255", "bced20d", "bc44de3", "7e05b0f", "4fb461d", "8378e3f", "a086a8f", "32b7020", "8b690a1", "3e0e8fb", "d470fa1"):
            self.assertIn(commit, implementation)
        for phrase in ("免费预抓取", "零费用彩排", "真实运行", "前20次", "public-doh", "资料条件不同", "本次实时读取", "实时读取加资料库复用", "专业级绑定", "学校级学费", "城市级校区核验", "错误绑定", "样本分母", "逐推荐人工核对", "修复后未重新真实运行", "杭师大", "脚本模板", "robots禁止"):
            self.assertIn(phrase, record)
        for phrase in ("PROVIDER_NETWORK_ERROR", "失败也未自动重跑", "账单", "0/0", "888运筹学", "联系地址", "3e0e8fb", "d470fa1", "事务回滚", "同校跨子域", "旧规则事实残留0", "来源获取时间摘要前后一致", "871项"):
            self.assertIn(phrase, record)
        for row in ("| 学费（所有适用范围） | 1/4 | 0/4 | 3/4 |", "| 培养城市/校区 | 1/4 | 1/4 | 2/4 |", "| 初试科目 | 1/4 | 1/4 | 2/4 |"):
            self.assertIn(row, record)
        for phrase in ("系统待确认原文0条", "模型删句数未记录", "preferred 1、alternative 1、exploratory 2"):
            self.assertIn(phrase, record)
            self.assertIn(phrase, implementation)
        for path in (README, INDEX, ROOT / "docs" / "实施说明.md"):
            content = path.read_text(encoding="utf-8")
            for name in ("阶段4事实质量冒烟.md", "阶段4robots冒烟.md", "阶段7真实验证记录.md"):
                self.assertIn(name, content)
        for command in ("--rehearsal --dns-mode public-doh", "--confirm-paid --dns-mode public-doh", "phase7-paid-run.lock"):
            self.assertIn(command, README.read_text(encoding="utf-8"))

    def test_budgeted_model_completion_keeps_real_costs_and_original_audit_separate(self):
        record = (ROOT / "docs" / "阶段7真实验证记录.md").read_text(encoding="utf-8")
        implementation = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        for content in (record, implementation):
            for phrase in (
                "零新增搜索的最终分析补完", "0次新搜索", "同一份已批准预算内的补完",
                "不是新的独立端到端运行", "--confirm-paid --model-completion --dns-mode public-doh",
                "phase7-model-completion.lock", "PROVIDER_DNS_UNAVAILABLE", "最多重试1次",
                "不足12000不发送", "0.5", "16384", "15869", "25665", "29583",
                "19506", "10077", "第一次失败请求计费", "计费未知", "搜索合计22次",
                "36/36", "12/28＝42.86%", "28/28＝100%", "57.14个百分点",
                "被拒推荐4 / 模型提出推荐4＝100%", "单句删除数单独计0",
                "INVALID_RESEARCH_CITATION", "research-1", "BUDGET_EXHAUSTED", "partial",
                "专业级学费0/4", "学校级学费1/4", "具体校区0/4", "城市级校区核验1/4",
                "未知城市不算", "2026简章5213.htm", "884项",
                "3a60ffc", "f79b399", "a086a8f", "32b7020", "ef87e09", "8b690a1",
                "3e0e8fb", "d470fa1", "20cde04", "88aa3fc", "62bebcf",
            ):
                with self.subTest(phrase=phrase):
                    self.assertIn(phrase, content)
        header = "| 指标 | 修复前基线 | 本次真实原报告，经人工核对 |"
        table = record.split(header, 1)[1].split("\n\n", 1)[0]
        for original_row in (
            "| 官网读取成功率 | 57.5%，167次尝试 | 37/41＝90.24% | +32.74个百分点 |",
            "| 专业级初试科目正确绑定 | 0/50 | 1/4；原报告2条中剔除1条错误 | +25个百分点；增加1条 |",
            "| 校区/城市错误绑定 | 1/50＝2% | 1/4＝25% | +23个百分点；错误条数仍1 |",
            "| 模型推荐被校验删除比例 | 39%，原提案分母未给 | 0/0，不适用；最终模型未返回提案 |",
        ):
            self.assertIn(original_row, table)
        self.assertIn("零新增搜索补完（真实）", table)
        self.assertIn("4/4＝100%", table)
        self.assertIn("较原报告+25个百分点、增加1条", table)
        self.assertIn("| 初试科目（专业级） | 2/4 | 0/4 | 2/4 |", record)

    def test_citation_fix_offline_diagnosis_preserves_real_results_and_school_gaps(self):
        record = (ROOT / "docs" / "阶段7真实验证记录.md").read_text(encoding="utf-8")
        implementation = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        section = record.split("## 引用修复与离线诊断", 1)[1]
        summary = implementation.split("### 13.12.", 1)[1]
        for content in (section, summary):
            for phrase in (
                "离线诊断", "a2e0190", "b474da2", "sources[].id", "不得自造或改写",
                "NO_WEB_EVIDENCE", "EVIDENCE_TOO_LARGE", "37928", "435", "158", "66",
                "37", "100字符", "结构化事实", "全部", "裁剪", "scopeMatched=false",
                "0453", "0802", "0855", "0854", "1256", "1252", "pending", "bound",
                "UNSUPPORTED_RESEARCH_CLAIM", "2026", "0→7", "0→0", "与能源工程学院",
                "被拒推荐4 / 模型提出推荐4＝100%", "单句删除数单独计0", "真实数字",
                "29583", "19506", "10077", "verified:false", "890项", "10/10通过",
                "修复后未经真实运行验证", "需要一次新的、另获用户授权的真实运行",
            ):
                with self.subTest(phrase=phrase):
                    self.assertIn(phrase, content)
            for school in (
                "杭州师范大学", "浙江财经大学", "浙江理工大学", "浙江外国语学院",
                "浙江传媒学院", "浙江工商大学", "浙江科技大学", "浙江中医药大学",
                "杭州电子科技大学", "浙江大学",
            ):
                self.assertRegex(content, rf"(?m)^\| {school}(?:（[^|]+）)?[（\s|]")
        self.assertIn("真实模型0次、真实搜索0次、实际网络0次", section)
        self.assertIn("0／0／0", section)
        self.assertIn("最终编号全部", section)
        self.assertIn("3/3事实保留", section)
        self.assertIn("不计入真实对比", section)
        self.assertIn("浙江大学仅有资料库复用", section)
        for outdated in ("“照抄示例”只是推测", "“模型照抄示例”是有依据的推测"):
            self.assertNotIn(outdated, record)
            self.assertNotIn(outdated, implementation)

    def test_phase_four_public_facts_prefetch_and_platform_fallback_are_documented(self):
        for path in (README, ROOT / "knowledge" / "README.md", ROOT / "server" / "explanation" / "README.md",
                     DESIGN_DIR / "01-总体架构与演进.md", DESIGN_DIR / "02-数据模型与可信数据.md",
                     DESIGN_DIR / "04-接口与前端交互.md", DESIGN_DIR / "07-DeepSeek接入与密钥管理.md",
                     DESIGN_DIR / "08-变更与扩展约定.md"):
            content = path.read_text(encoding="utf-8")
            self.assertIn("阶段4", content)
        readme = README.read_text(encoding="utf-8")
        for phrase in ("prefetch-schools.mjs", "--dns-mode system|public-doh", "--dry-run", "--refresh", "robots.txt", "间隔≥1秒"):
            self.assertIn(phrase, readme)
        self.assertNotIn("结构化专业事实与预抓取规划中", readme)
        data = (DESIGN_DIR / "02-数据模型与可信数据.md").read_text(encoding="utf-8")
        for phrase in ("research_program_facts", "bound/pending", "fresh/stale", "targetYearApplicable", "sourceUrl", "retrievedAt", "phase2-program-binding@2", "失败不删除", "school_wide"):
            self.assertIn(phrase, data)
        implementation = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        for phrase in ("13.5. 阶段4", "ROBOTS_DISALLOWED", "数据加载中", "安全降级", "未调用付费搜索或模型", "public-doh", "3页", "2条"):
            self.assertIn(phrase, implementation)

    def test_phase_four_quality_rules_and_smoke_are_documented(self):
        for path in (ROOT / "server" / "explanation" / "README.md", DESIGN_DIR / "02-数据模型与可信数据.md"):
            content = path.read_text(encoding="utf-8")
            for phrase in ("phase2-program-binding@2", "programEntries", "school_degree_type", "registrySchoolCity", "300", "具体科目"):
                self.assertIn(phrase, content)
        for path in (README, ROOT / "server" / "explanation" / "README.md", DESIGN_DIR / "07-DeepSeek接入与密钥管理.md"):
            content = path.read_text(encoding="utf-8")
            self.assertIn("每校20页", content)
            self.assertIn("深度≤3", content)
        implementation = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        self.assertIn("13.6. 阶段4质量审查修正", implementation)
        smoke = (ROOT / "docs" / "阶段4事实质量冒烟.md").read_text(encoding="utf-8")
        for phrase in ("杭州电子科技大学", "杭州师范大学", "ROBOTS_UNAVAILABLE", "bound/pending", "50", "原文前80字", "public-doh"):
            self.assertIn(phrase, smoke)

    def test_phase_four_robots_policy_matches_rfc_9309_and_smoke(self):
        for path in (README, ROOT / "server" / "explanation" / "README.md",
                     DESIGN_DIR / "08-变更与扩展约定.md", ROOT / "docs" / "实施说明.md",
                     ROOT / "docs" / "产品设计文档.md"):
            content = path.read_text(encoding="utf-8")
            for phrase in ("robots.txt 不允许时不抓取", "4xx 视为无限制（429 除外）",
                           "429/5xx/网络失败时跳过该主机"):
                self.assertIn(phrase, content, path.name)
            self.assertNotIn("404允许，5xx/超时/无法判定", content)
            self.assertNotIn("404视为允许，5xx、超时或无法判定", content)
        for path in (ROOT / "server" / "explanation" / "README.md", DESIGN_DIR / "08-变更与扩展约定.md"):
            content = path.read_text(encoding="utf-8")
            for phrase in ("最多3次", "100000字节", "无效行", "robotsDisallowed",
                           "robotsUnavailable", "robotsUnavailableByCode"):
                self.assertIn(phrase, content)
        implementation = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        self.assertIn("13.7. 阶段4 robots RFC 9309修正", implementation)
        smoke = (ROOT / "docs" / "阶段4robots冒烟.md").read_text(encoding="utf-8")
        for phrase in ("public-doh", "成功15页", "HTTP_404 3次", "robotsUnavailable 0",
                       "目录专业代码数：0", "Content-Type", "研究生教育数据赋能管理系统",
                       "9770", "已遮蔽", "完整性 ok", "ZsssTksList?zsnf=2027"):
            self.assertIn(phrase, smoke)
        self.assertEqual(smoke.count("| [原文](https://"), 15)

    def test_phase_five_document_budget_table_matches_code(self):
        content = (DESIGN_DIR / "07-DeepSeek接入与密钥管理.md").read_text(encoding="utf-8")
        for key, value in B.items():
            self.assertIn(f"| `{key}` | {value} |", content)
        for name in ("README.md", "docs/长期部署.md", "server/explanation/README.md"):
            text = (ROOT / name).read_text(encoding="utf-8")
            self.assertIn(str(B['userDailyTokens']), text)
            self.assertIn(str(B['globalDailyTokens']), text)
        example = (ROOT / ".env.example").read_text(encoding="utf-8")
        self.assertIn(f"YANTU_MODEL_USER_DAILY_TOKENS={B['userDailyTokens']}", example)
        self.assertIn(f"YANTU_MODEL_DAILY_TOKENS={B['globalDailyTokens']}", example)

    def test_phase_six_ui_contract_and_private_raw_sources_are_implemented(self):
        api = (DESIGN_DIR / "04-接口与前端交互.md").read_text(encoding="utf-8")
        section = api.split("### 6.2.", 1)[1].split("## 7.", 1)[0]
        self.assertNotIn("待实施", section)
        for phrase in ("阶段6已实现", "该报告生成时未记录资料覆盖统计", "已绑定", "待确认", "未找到", "归属待确认", "最多2条", "查看更多待确认原文（N 条）", "默认收起", "按学位类型的全校标准", "城市已核验，具体校区待确认", "unstructuredSources", "pending-only", "600字", "6000字", "报告所有者", "原获取时间", "研招网平台", "noopener noreferrer", "details/summary", "375px", "中文说明", "失败保留历史报告"):
            self.assertIn(phrase, section)
        implementation = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        for phrase in ("13.9. 阶段6", "4fb461d", "var/phase6-1280.png", "var/phase6-375.png", "截图不代表真实联网验收"):
            self.assertIn(phrase, implementation)
        self.assertIn("阶段6报告资料展示", README.read_text(encoding="utf-8"))

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

    def test_phase_one_transport_implementation_and_free_probe_are_documented(self):
        for path in (DESIGN_DIR / "07-DeepSeek接入与密钥管理.md", ROOT / "server" / "explanation" / "README.md"):
            content = path.read_text(encoding="utf-8")
            for phrase in ("阶段1读取层已实现", "maxRedirects:3", "allowHttp:true", "BOM", "前4096字节meta", "WEB_REDIRECT_CROSS_SITE", "WEB_REDIRECT_LIMIT", "WEB_DECODE_FAILED", "WEB_TLS_CERT", "tlsCode", "finalUrl", "gzip/deflate/br", "probe-school-sites.mjs", "同主机串行", "不调用模型或搜索"):
                self.assertIn(phrase, content)
            self.assertNotIn("不会发送HTTP请求", content)
        implementation = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        for phrase in ("阶段1已完成", "23/29", "79.31%", "WEB_ADDRESS_BLOCKED 29", "WEB_CONNECTION_RESET 2", "3.45%", "未实现AIA", "WebVPN", "不等于取得招生事实"):
            self.assertIn(phrase, implementation)

    def test_phase_two_binding_sentence_isolation_and_diagnostics_are_documented(self):
        for path in (
            ROOT / "docs" / "recommendation-method.md",
            ROOT / "server" / "explanation" / "README.md",
            DESIGN_DIR / "02-数据模型与可信数据.md",
            DESIGN_DIR / "07-DeepSeek接入与密钥管理.md",
        ):
            content = path.read_text(encoding="utf-8")
            for phrase in (
                "阶段2", "pendingEvidence", "field", "quote", "sourceId", "year", "reason",
                "待确认原文", "不用于预算或城市匹配", "InstitutionResolver",
                "rejectedRecommendations", "removedSentences", "validationIssues",
                "readStatistics", "success", "failed", "failuresByCode",
                "GET /api/v1/research-jobs/:id", "不保存模型全文",
            ):
                with self.subTest(document=path.name, phrase=phrase):
                    self.assertIn(phrase, content)
        implementation = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        for phrase in ("各阶段实现提交", "13.2. 阶段2完成", "保存证据的离线重放，不是新的联网结果", "4017bef", "15000毫秒", "删除4句", "修改前", "修改后"):
            self.assertIn(phrase, implementation)
        for row in (
            "| 最终推荐数（每校一个主建议） | 10 | 6 |",
            "| 整条拒绝次数（本次模型校验尝试） | 3 | 2 |",
            "| 学费已绑定数 | 0 | 0 |",
            "| 校区城市已核验数 | 0 | 0 |",
            "| 初试科目已绑定数（含历史参考） | 0 | 0 |",
            "| 意向城市杭州已核验学校数 | 0 | 0 |",
            "| cities：match / mismatch / unknown | 0 / 0 / 10 | 0 / 0 / 6 |",
            "| budget：match / mismatch / unknown | 0 / 0 / 10 | 0 / 0 / 6 |",
        ):
            self.assertIn(row, implementation)

    def test_phase_two_schoolwide_tuition_and_pending_noise_fix_are_documented(self):
        for path in (
            ROOT / "docs" / "recommendation-method.md",
            ROOT / "server" / "explanation" / "README.md",
            DESIGN_DIR / "02-数据模型与可信数据.md",
            DESIGN_DIR / "07-DeepSeek接入与密钥管理.md",
        ):
            content = path.read_text(encoding="utf-8")
            for phrase in ("阶段2审查修正", "school_wide", "school_wide_mode", "全校统一标准", "year", "阶段3"):
                self.assertIn(phrase, content)
        implementation = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        for row in (
            "| 学费已绑定数 | 0 | 1 |",
            "| 待确认原文总条数 | 26 | 3 |",
            "| 待确认学费条数 | 14 | 3 |",
            "| 待确认校区条数 | 12 | 0 |",
        ):
            self.assertIn(row, implementation)
        for phrase in ("7000元/年", "2024", "学习方式", "纯联系方式", "城市级校区核验", "不改写首次阶段2提交"):
            self.assertIn(phrase, implementation)

    def test_phase_three_registry_city_guards_and_replay_are_documented(self):
        for path in (
            ROOT / "knowledge" / "schools" / "README.md",
            ROOT / "docs" / "recommendation-method.md",
            ROOT / "server" / "explanation" / "README.md",
            DESIGN_DIR / "01-总体架构与演进.md",
            DESIGN_DIR / "02-数据模型与可信数据.md",
            DESIGN_DIR / "07-DeepSeek接入与密钥管理.md",
        ):
            content = path.read_text(encoding="utf-8")
            for phrase in ("阶段3", "458", "31个省级行政区", "147所第二轮双一流", "discoveryOnly: true", "12", "6", "includeDomains"):
                with self.subTest(document=path.name, phrase=phrase):
                    self.assertIn(phrase, content)
        registry = (ROOT / "knowledge" / "schools" / "README.md").read_text(encoding="utf-8")
        for phrase in ("--province", "--city", "--limit", "--write", "每月及发布前", "D-13", "22/25", "20/21", "48/54", "榆林学院", "西湖大学", "间隔至少1秒"):
            self.assertIn(phrase, registry)
        for path in (ROOT / "docs" / "recommendation-method.md", DESIGN_DIR / "02-数据模型与可信数据.md", DESIGN_DIR / "07-DeepSeek接入与密钥管理.md"):
            content = path.read_text(encoding="utf-8")
            for phrase in ("城市级校区核验", "跨城", "待确认原文", "门牌", "具体校区"):
                self.assertIn(phrase, content)
            self.assertNotIn("城市级校区核验留待阶段3", content)
        implementation = (ROOT / "docs" / "实施说明.md").read_text(encoding="utf-8")
        for phrase in ("13.4. 阶段3", "455", "410/455", "293/293", "458", "412/458", "296/297", "22/25", "20/21", "保存证据的离线重放，不是新的联网结果", "榆林大学", "宁波杭州湾新区"):
            self.assertIn(phrase, implementation)
        for row in (
            "| 最终推荐数 | 6 | 6 |",
            "| 校区城市已核验数 | 0 | 5 |",
            "| 待确认原文总条数 | 3 | 4 |",
            "| 意向城市杭州已核验学校数 | 0 | 1 |",
            "| cities：match / mismatch / unknown | 0 / 0 / 6 | 1 / 4 / 1 |",
        ):
            self.assertIn(row, implementation)

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
