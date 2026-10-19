import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getDisciplineCatalog } from "../server/disciplines/index.ts";
import { schoolRegistry } from "../server/schools/index.ts";
import {
  deduplicatePriorityFacts,
  extractPriorityFacts,
  factSourceTier,
  preferredPriorityFacts,
  priorityCoverage,
  priorityFactMatches,
} from "../server/explanation/research-priority-facts.ts";
import { programEntries } from "../server/explanation/research-matching.ts";
import { safeSourceYear } from "../server/explanation/research-years.ts";
import { researchSourceTier } from "../server/explanation/research-source-policy.ts";
import {
  RESEARCH_PRIORITY_FIELDS,
  type ResearchPriorityFact,
  type ResearchPriorityField,
} from "../shared/research-priority-facts.ts";
import type { WebSource } from "../server/explanation/web.ts";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixtureDirectory = "tests/fixtures";
export const A_EVIDENCE_TARGETS = [
  { institutionName: "浙江理工大学", majorCode: "085501" },
  { institutionName: "杭州电子科技大学", majorCode: "085500" },
  { institutionName: "浙江科技大学", majorCode: "085500" },
  { institutionName: "浙江农林大学", majorCode: "085500" },
  { institutionName: "浙江师范大学", majorCode: "085500" },
] as const;
type Recommendation = Parameters<typeof priorityCoverage>[1][number];
type Page = {
  url: string;
  title: string;
  source?: WebSource;
  origin?: { fixture: string; pageIndex: number };
  leadOrigin?: { fixture: string; pageIndex: number };
};
type Fixture = {
  pages: Page[];
  runs: {
    id: string;
    recommendations: Recommendation[];
    reads: { url: string; outcome: string }[];
    metrics?: {
      gitHead: string;
      priorityCoverage: ReturnType<typeof priorityCoverage>;
    };
  }[];
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const labels: Record<ResearchPriorityField, string> = {
  cutoff: "复试线",
  admissionScore: "录取分",
  applicationAdmissionRatio: "报录比",
  admittedCount: "录取人数",
  recommendationShare: "推免占比",
  undergraduateAdmission: "本科背景统计",
  crossMajorAdmission: "跨考背景统计",
  disciplineAssessment: "学科评估",
  programRanking: "专业排名",
  employment: "就业",
  cityDevelopment: "城市产业",
};
const patterns: Record<ResearchPriorityField, RegExp> = {
  cutoff: /复试|分数线|国家线/,
  admissionScore: /录取|初试成绩/,
  applicationAdmissionRatio: /报录|报考|录取/,
  admittedCount: /报录|录取/,
  recommendationShare: /推免|推荐免试/,
  undergraduateAdmission: /生源|背景|本科|双非/,
  crossMajorAdmission: /生源|背景|跨考|跨专业/,
  disciplineAssessment: /学科评估|第四轮/,
  programRanking: /排名|排行/,
  employment: /就业|毕业.*去向/,
  cityDevelopment: /城市|产业|地区生产/,
};
export function loadEvidenceCorpus(root = repositoryRoot) {
  const names = [
    "research-real-replay.json",
    ...readdirSync(resolve(root, fixtureDirectory))
      .filter((name) => /^research-v3a6-run\d+\.json$/.test(name))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
  ];
  const pages = new Map<string, Page>();
  const fixtures = names.map((name) => {
    const path = `${fixtureDirectory}/${name}`;
    const fixture = JSON.parse(
      readFileSync(resolve(root, path), "utf8"),
    ) as Fixture;
    fixture.pages.forEach((page, pageIndex) => {
      const old = pages.get(page.url);
      pages.set(page.url, {
        ...page,
        source: page.source ?? old?.source,
        origin: page.source ? { fixture: path, pageIndex } : old?.origin,
        leadOrigin: { fixture: path, pageIndex },
      });
    });
    return { path, fixture };
  });
  const latest = fixtures.at(-1)!;
  if (!latest.fixture.runs[0]?.metrics?.priorityCoverage)
    throw new Error(
      "Latest real fixture has no recorded coverage; refusing to invent a baseline.",
    );
  return { pages: [...pages.values()], fixtures, latest };
}
function belongsTo(page: Page, school: string) {
  return (
    schoolRegistry.byHost(new URL(page.url).hostname)?.name === school ||
    page.title.includes(school) ||
    Boolean(page.source?.title.includes(school))
  );
}
export function sourceReference(page: Page, quote: string) {
  if (!page.source || !page.origin)
    throw new Error("A saved body and its fixture location are required.");
  const offset = page.source.excerpt.indexOf(quote);
  if (offset < 0)
    throw new Error(`Quote is not literal saved text: ${page.url}`);
  return {
    url: page.url,
    title: page.source.title,
    kind: page.source.kind,
    retrievedAt: page.source.retrievedAt,
    ...page.origin,
    textSha256: hash(page.source.excerpt),
    hashScope: "saved-extracted-text-utf8" as const,
    quote,
    offset,
    length: quote.length,
    verified: false as const,
  };
}
export function classifySlot(input: {
  recommendation: Recommendation;
  field: ResearchPriorityField;
  year: number | null;
  facts: ResearchPriorityFact[];
  pages: Page[];
}) {
  const { recommendation: r, field, year, facts, pages } = input;
  const relevant = facts.filter(
    (f) => f.schoolName === r.institutionName && f.field === field,
  );
  const exact = preferredPriorityFacts(facts, r).filter(
    (f) =>
      f.field === field &&
      (year === null || f.year === year) &&
      factSourceTier(f) !== "reference",
  );
  const excluded = relevant.filter(
    (f) => !priorityFactMatches(f, r) || (year !== null && f.year !== year),
  );
  const leads = pages.filter(
    (p) =>
      belongsTo(p, r.institutionName) &&
      patterns[field].test(`${p.title} ${p.source?.title ?? ""}`) &&
      (year === null ||
        `${p.title} ${p.source?.title ?? ""}`.includes(String(year))),
  );
  // This classifies captured evidence, never the school's disclosure policy or the field's existence.
  const evidenceStatus = exact.length
    ? "captured_applicable"
    : excluded.length
      ? "scope_not_applicable"
      : leads.some((p) => !p.source)
        ? "body_not_captured"
        : "public_availability_unconfirmed";
  return { evidenceStatus, exact, excluded, leads };
}
export function buildEvidenceAudit(root = repositoryRoot) {
  const corpus = loadEvidenceCorpus(root);
  const disciplines = getDisciplineCatalog().items.filter((d) =>
    ["0802", "0855"].includes(d.code),
  );
  const facts = deduplicatePriorityFacts(
    corpus.pages.flatMap((p) =>
      p.source ? extractPriorityFacts(p.source, disciplines, "2027") : [],
    ),
  );
  const recommendations = corpus.latest.fixture.runs[0].recommendations;
  if (
    recommendations.length !== A_EVIDENCE_TARGETS.length ||
    !A_EVIDENCE_TARGETS.every((target) =>
      recommendations.some(
        (r) =>
          r.institutionName === target.institutionName &&
          r.majorCode === target.majorCode,
      ),
    )
  )
    throw new Error(
      "A evidence audit requires the fixed five school/program identities; refusing a changed denominator.",
    );
  const pageByUrl = new Map(corpus.pages.map((p) => [p.url, p]));
  const evidence = (f: ResearchPriorityFact) => ({
    schoolName: f.schoolName,
    disciplineCode: f.disciplineCode ?? null,
    majorCode: f.majorCode ?? null,
    collegeName: f.collegeName ?? null,
    field: f.field,
    year: f.year,
    value: f.value,
    source: sourceReference(pageByUrl.get(f.sourceUrl)!, f.quote),
    supportingEvidence: (f.evidenceQuotes ?? []).map((quote) =>
      sourceReference(pageByUrl.get(f.sourceUrl)!, quote),
    ),
  });
  const oldAudit = JSON.parse(
    readFileSync(
      resolve(root, fixtureDirectory, "research-v3a6-audit.json"),
      "utf8",
    ),
  ) as { school: string; field: string; year?: number; evidence: string }[];
  const rows = recommendations.flatMap((r) =>
    RESEARCH_PRIORITY_FIELDS.flatMap((field) =>
      (["cutoff", "admissionScore"].includes(field)
        ? [2026, 2025, 2024]
        : [null]
      ).map((year) => {
        const slot = classifySlot({
          recommendation: r,
          field,
          year,
          facts,
          pages: corpus.pages,
        });
        const note = oldAudit.find(
          (a) =>
            a.school === r.institutionName &&
            a.field === field &&
            (a.year ?? null) === year,
        );
        return {
          id: `${r.institutionName}:${r.majorCode ?? r.disciplineCode}:${r.collegeName ?? "待确认学院"}:${field}:${year ?? "不限年槽"}`,
          ...r,
          field,
          year,
          evidenceStatus: slot.evidenceStatus,
          publicAvailability: slot.exact.length ? "captured" : "unconfirmed",
          reviewStatus: "draft",
          confirmedByHuman: false,
          applicableEvidence: slot.exact.map(evidence),
          rejectedScopeEvidence: slot.excluded.map(evidence),
          leads: slot.leads.map((p) => ({
            url: p.url,
            title: p.title,
            captured: Boolean(p.source),
            failures: [
              ...new Set(
                corpus.fixtures.flatMap((f) =>
                  f.fixture.runs.flatMap((run) =>
                    run.reads
                      .filter(
                        (read) =>
                          read.url === p.url && read.outcome !== "success",
                      )
                      .map((read) => read.outcome),
                  ),
                ),
              ),
            ],
          })),
          priorAuditNote: note?.evidence ?? null,
          nextAction: slot.exact.length
            ? "复核原文表头、年份、人群和项目范围；仍不能自动发布。"
            : field === "disciplineAssessment"
              ? "补第四轮权威矩阵及目标项目依托学科的显式原文；不借用其他学科评级。"
              : field === "cutoff"
                ? "核对同年同专业复试要求；采用国家线时补适用声明、区域、学位类型、专业范围和国家线数值链。"
                : ["applicationAdmissionRatio", "recommendationShare"].includes(
                      field,
                    )
                  ? "补同年同项目同人群的分子、分母及统计定义，不用估计数。"
                  : ["undergraduateAdmission", "crossMajorAdmission"].includes(
                        field,
                      )
                    ? "寻找公开群体统计及样本口径；无可核验统计则保留缺项。"
                    : "先复查已保存原文与附件，再核对该年度、项目及人群范围；无法取得时保留缺项。",
        };
      }),
    ),
  );
  const associationEvidence = corpus.pages.flatMap((p) => {
    if (!p.source || p.source.kind !== "official_page") return [];
    const fragments =
      p.source.excerpt.match(
        /[^。\n]*(?:国家A类地区线|机械工程学科和工商管理学科获得 B\+)[^。\n]*/g,
      ) ?? [];
    return fragments.map((quote) => ({
      kind: quote.includes("B+")
        ? "discipline_assessment_scope"
        : "national_line_applicability",
      status: "incomplete_chain",
      source: sourceReference(p, quote),
      missing: quote.includes("B+")
        ? ["085500目标项目与0802学科的显式依托关系", "可复核第四轮权威原文矩阵"]
        : [
            "2024/2025/2026逐年适用声明",
            "目标项目不在例外范围的依据",
            "同年同类型A区国家线数值原文",
          ],
      conclusion: quote.includes("B+")
        ? "仅能作为0802第四轮B+历史线索；不得给085500直接赋评级。"
        : "2022年一般情况说明并明确存在例外；不构成2024–2026目标项目复试线。",
    }));
  });
  const authorityEntrances = corpus.pages
    .filter((p) => researchSourceTier(p.url) === "authority")
    .map((p) => {
      const disciplineCode = p.title.match(/^(\d{4})\s/)?.[1];
      const status = /2012/.test(`${p.url} ${p.title}`)
        ? "wrong_assessment_round"
        : disciplineCode && disciplineCode !== "0802"
          ? "different_discipline"
          : /校长|主任|院士/.test(p.title)
            ? "speech_not_matrix"
            : /dslxkpgjggb\/?$/.test(p.url)
              ? "matrix_portal_body_not_captured"
              : p.source
                ? "captured_no_applicable_priority_fields"
                : "body_not_captured";
      return {
        url: p.url,
        title: p.title,
        leadOrigin: p.leadOrigin!,
        captured: Boolean(p.source),
        status,
        usablePriorityFacts: p.source
          ? extractPriorityFacts(p.source, disciplines, "2027").length
          : 0,
        failures: [
          ...new Set(
            corpus.fixtures.flatMap((f) =>
              f.fixture.runs.flatMap((run) =>
                run.reads
                  .filter(
                    (read) => read.url === p.url && read.outcome !== "success",
                  )
                  .map((read) => read.outcome),
              ),
            ),
          ),
        ],
        availabilityNow: "not_checked",
        verified: false,
      };
    });
  const baselineCoverage =
    corpus.latest.fixture.runs[0].metrics!.priorityCoverage;
  const wasConfirmed = (row: (typeof rows)[number]) => {
    const prior = baselineCoverage.schools.find(
      (school) => school.schoolName === row.institutionName,
    );
    if (!prior) return false;
    return row.year === null
      ? prior.confirmed.includes(row.field)
      : !prior.missingScoreYears.some(
          (missing) => missing.field === row.field && missing.year === row.year,
        );
  };
  const changedRow = (row: (typeof rows)[number]) => ({
    id: row.id,
    school: row.institutionName,
    majorCode: row.majorCode,
    field: row.field,
    year: row.year,
    evidence: row.applicableEvidence,
  });
  const offlineCoverage = priorityCoverage(facts, recommendations, "2027");
  return {
    schemaVersion: 2,
    kind: "offline-research-evidence-audit",
    scope: A_EVIDENCE_TARGETS,
    targetYear: 2027,
    networkRequests: 0,
    paidCalls: 0,
    generatedFrom: corpus.fixtures.map((f) => f.path),
    corpus: {
      urls: corpus.pages.length,
      bodies: corpus.pages.filter((p) => p.source).length,
    },
    baseline: {
      fixture: corpus.latest.path,
      gitHead: corpus.latest.fixture.runs[0].metrics!.gitHead,
      coverage: corpus.latest.fixture.runs[0].metrics!.priorityCoverage,
    },
    offlineCoverage,
    reviewProgress: {
      baselineConfirmed: baselineCoverage.confirmed,
      baselinePending: baselineCoverage.pending,
      currentConfirmable: offlineCoverage.confirmed,
      currentPending: offlineCoverage.pending,
      confirmedDelta: offlineCoverage.confirmed - baselineCoverage.confirmed,
      pendingDelta: offlineCoverage.pending - baselineCoverage.pending,
      promoted: rows
        .filter(
          (row) =>
            !wasConfirmed(row) && row.evidenceStatus === "captured_applicable",
        )
        .map(changedRow),
      demoted: rows
        .filter(
          (row) =>
            wasConfirmed(row) && row.evidenceStatus !== "captured_applicable",
        )
        .map(changedRow),
      humanReviewed: 0,
    },
    stageAcceptance:
      "A只覆盖浙江理工085501、杭电/浙科/浙农林/浙师085500。按复核原文→关联链→统计口径三步验收，做完就停；不以60%为完成条件，不触发付费，不做UI或目录入库。",
    method:
      "以最新真实运行的5校身份固定分母，对累计保存正文确定性重提取。不是网络实测、全国覆盖或人工审核。范围不适用仅指所列原文；公开可得性未确认不表示学校未公开。",
    rows,
    associationEvidence,
    authorityEntrances,
  };
}

export function buildReviewCandidates(root = repositoryRoot) {
  const corpus = loadEvidenceCorpus(root);
  const disciplines = getDisciplineCatalog().items.filter((d) =>
    ["0802", "0855"].includes(d.code),
  );
  // These are observed originals, not hypothetical admissions identities. Incomplete identities stay null.
  const selections = [
    [
      "0c6dd461-06e5-485e-a8cb-aea791618009.xls",
      ["080200", "085500"],
      "机械工程学院",
    ],
    ["034fab1a-fcbd-4560-9f90-436076f19cb0.pdf", ["085500"], null],
    ["24ee6fec-84e1-49c0-b6e2-153c646076d7.pdf", ["080200"], null],
    ["/info/1135/8514.htm", ["080200", "085501"], "机械工程学院"],
    ["ie.zafu.edu.cn/info/1091/5213.htm", ["085500"], "光机电工程学院"],
    [
      "yzw.zust.edu.cn/info/1035/1986.htm",
      ["080200"],
      "智能制造与能源工程学院",
    ],
  ] as const;
  const candidates = selections.flatMap(([suffix, codes, college]) => {
    const page = corpus.pages.find((p) => p.url.endsWith(suffix));
    if (!page?.source)
      throw new Error(`Saved candidate original missing: ${suffix}`);
    const school = schoolRegistry.byHost(new URL(page.url).hostname)!;
    return programEntries(page.source, disciplines)
      .filter(
        (e) =>
          (codes as readonly string[]).includes(e.majorCode) &&
          (!college || e.collegeName === college),
      )
      .map((e) => {
        const source = sourceReference(page, e.catalogQuote);
        return {
          candidateId: `review-${hash(`${page.url}:${e.majorCode}:${e.collegeName ?? ""}`).slice(0, 16)}`,
          reviewStatus: "draft",
          publicationStatus: "unpublished",
          availability: "unverified",
          verified: false,
          reviewedBy: null,
          approvedBy: null,
          publicationReady: false,
          institutionName: school.name,
          discoveryCity: school.city,
          observedYear: safeSourceYear(page.source!) ?? null,
          majorCode: e.majorCode,
          programName: e.programName,
          collegeName: e.collegeName ?? null,
          studyMode: e.studyMode ?? null,
          campus: null,
          eligibilityComplete: false,
          sourceType: /调剂/.test(page.source!.title)
            ? "historical_adjustment_announcement"
            : "admissions_catalogue",
          source,
          blockingChecks: [
            "独立人工复核原文及表头",
            "年度项目身份、学院、方向、学位与学习方式",
            "目标年度资格及停招/科目变更",
            "科目满分与可选组、费用及培养地点",
            "来源使用限制与原始文件哈希（当前仅有抽取文本哈希）",
          ],
          limitation:
            "真实保存原文的待审线索包，非正式catalog导入文件。历史调剂事实不证明2027招生；城市为注册表线索，不是培养地点。",
        };
      });
  });
  return {
    schemaVersion: 1,
    kind: "catalog-review-evidence-pack",
    importable: false,
    verified: false,
    targetYear: 2027,
    publicationStatus: "unpublished",
    reviewers: [],
    candidates,
  };
}
function markdown(audit: ReturnType<typeof buildEvidenceAudit>) {
  const states: Record<string, string> = {
    captured_applicable: "有适用原文，待人工审校",
    scope_not_applicable: "现存相关原文范围不适用",
    body_not_captured: "线索正文未获取",
    public_availability_unconfirmed: "公开可得性未确认",
  };
  const rows = audit.rows.map(
    (r) =>
      `| ${r.institutionName} ${r.majorCode} | ${labels[r.field]}${r.year ?? ""} | ${states[r.evidenceStatus]} | ${r.applicableEvidence.length}/${r.rejectedScopeEvidence.length}/${r.leads.filter((l) => !l.captured).length} |`,
  );
  return `# 证据改进台账\n\n本文件由 \`node scripts/research-evidence-audit.ts --write\` 从仓库已保存真实语料生成；\`--check\` 检查产物一致。未加载 .env，未使用网络、模型或搜索。人工补充请写入后续审校记录，避免被再次生成覆盖。\n\n## 基线与口径\n\n${audit.stageAcceptance}\n\n最新真实网络基线为2026-10-12历史第11次（2a2c114），见[真实验证记录](阶段7真实验证记录.md#来源政策第7次真实运行与停止记录历史第11次2a2c114)：5校、461.846秒、120检索、180读取；合计字段8%、整类0%、复试线4/15=26.67%、学科评估0/5，9确认/66待补。三项60%门槛均未通过，连续三次无进展后停止，未新增第12次。\n\n本次扫描${audit.corpus.urls} URL/${audit.corpus.bodies}份保存正文，以最后真实运行5校固定身份形成${audit.rows.length}个字段/年度槽。离线确定性提取${audit.offlineCoverage.confirmed}确认/${audit.offlineCoverage.pending}待补、字段${(audit.offlineCoverage.combined.partialAverage * 100).toFixed(2)}%、整类${(audit.offlineCoverage.combined.completeAverage * 100).toFixed(2)}%；这些是规则复核计数，未经人工审校。不是新的网络覆盖或全国样本。\n\n历史基线8%按五类等权再按学校平均：分数类6槽（2字段×3年度）、竞争3、背景2、学科2、就业2；(23.33%+6.67%+0+0+10%)/5=8%。9/75=12%为不同的原始槽位率，不能互换。降低推荐数量不降低三项60%标准，也不重写历史分母。\n\n## 本批可核对变化\n\n可确认（规则复核、非人工审核）：${audit.reviewProgress.baselineConfirmed}→${audit.reviewProgress.currentConfirmable}；待补：${audit.reviewProgress.baselinePending}→${audit.reviewProgress.currentPending}。新增${audit.reviewProgress.promoted.length}槽、撤回${audit.reviewProgress.demoted.length}槽。逐条原文、表头/身份辅助片段及SHA-256/UTF-16偏移均写入机器台账reviewProgress。\n\n${audit.reviewProgress.promoted.map((row) => `- 新增：${row.school} ${row.majorCode} ${labels[row.field]}${row.year ?? ""}；${row.evidence.map((e) => `${e.value.number ?? e.value.employmentRate ?? e.value.grade ?? "原文统计"}，原文${e.source.fixture} pages[${e.source.pageIndex}] offset ${e.source.offset}`).join("；")}。`).join("\n")}\n\n${audit.reviewProgress.demoted.map((row) => `- 撤回：${row.school} ${row.majorCode} ${labels[row.field]}${row.year ?? ""}；保留原始历史基线，当前保持待补。`).join("\n") || "无撤回槽。"}\n\n## 可执行顺序\n\n1. 复核下表和机器台账原文定位，优先已有正文可补的范围/表头问题；以真实负例测试防止错年、错专业、导航页和估计值误计。\n2. 国家线建立同年适用声明→学科/学位类型和A区→数值原文完整链；学科评估建立第四轮矩阵→0802→目标项目明确依托关系。链条缺一保持待补。\n3. 对报录比/推免补同年同人群分子分母，对本科/跨考背景补公开群体统计，对就业保留学院/研究生口径。没有数据不估算，不以经验评价替代。\n\n三步之外不自动推进；目录待审包属于C，本批不修改或入库，页面属于B。固定75槽保留历史分母，其中城市产业槽只保留旧缺项，本批不扩展城市证据。已公开但未抓到、所见原文范围不适用、公开可得性未确认分别记录；均不能推断学校从未公开。\n\n## 关联链核查\n\n累计语料含${audit.authorityEntrances.length}个权威域名入口线索，仅${audit.authorityEntrances.filter((e) => e.captured).length}份保存正文，均无适用优先字段。机器台账逐条保留入口fixture位置及历史失败码，区分2012旧轮次、其他学科、讲话、第四轮矩阵门户未取正文与普通未读线索。本次未做网络探测，不能把这些URL称为现已稳定可用入口。\n\n${audit.associationEvidence.map((a) => `- [${a.source.title}](${a.source.url})：${a.conclusion} 尚缺：${a.missing.join("；")}。原文定位与文本SHA-256在机器台账中。`).join("\n")}\n\n上述2022年一般A线声明含例外，不能拿2024–2026国家线数值拼接；工大0802 B+没有提升为085500项目评级。没有新证据被写入正式目录或研究核心。\n\n## 逐字段审计\n\n“范围不适用”指已有相关原文与当前槽的年/专业/学院不匹配，**不表示该字段对学校不适用**。“确认”是既有抽取规则口径，不是人工审核。数量列依次为适用原文/范围不符原文/未取得正文线索；URL、失败码、历史审计说明及下一动作在[机器台账](../knowledge/catalog/review-candidates/evidence-audit.json)。\n\n| 学校/专业 | 字段/参考年 | 已存证据状态 | 原文/异范围/缺正文 |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`;
}
export function auditOutputs(root = repositoryRoot) {
  const audit = buildEvidenceAudit(root),
    pack = buildReviewCandidates(root);
  return new Map([
    [
      "knowledge/catalog/review-candidates/evidence-audit.json",
      `${JSON.stringify(audit, null, 2)}\n`,
    ],
    [
      "knowledge/catalog/review-candidates/first-batch.json",
      `${JSON.stringify(pack, null, 2)}\n`,
    ],
    ["docs/证据改进台账.md", markdown(audit)],
  ]);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const mode = process.argv[2];
  if (
    !["--write", "--check", undefined].includes(mode) ||
    process.argv.length > 3
  )
    throw new Error(
      "Usage: node scripts/research-evidence-audit.ts [--write|--check]",
    );
  const outputs = auditOutputs();
  for (const [file, contents] of outputs) {
    if (
      mode === "--write" &&
      readFileSync(resolve(repositoryRoot, file), "utf8").replaceAll(
        "\r\n",
        "\n",
      ) !== contents
    )
      writeFileSync(resolve(repositoryRoot, file), contents);
    if (
      mode === "--check" &&
      readFileSync(resolve(repositoryRoot, file), "utf8").replaceAll(
        "\r\n",
        "\n",
      ) !== contents
    )
      throw new Error(`Generated audit is stale: ${file}`);
  }
  console.log(
    JSON.stringify({
      mode: mode ?? "inspect",
      files: [...outputs.keys()],
      networkRequests: 0,
      paidCalls: 0,
    }),
  );
}
