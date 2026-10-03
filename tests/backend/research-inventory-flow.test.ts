import test from "node:test";
import assert from "node:assert/strict";
import { createResearchReportModule } from "../../server/explanation/research.ts";
import {
  ModelError,
  type ModelAdapter,
} from "../../server/explanation/deepseek.ts";
import type { WebReader } from "../../server/explanation/web.ts";
import { generateGuidance } from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import { webPageText } from "../../server/explanation/web.ts";

const school = "杭州电子科技大学";
const listUrl = "https://grs.hdu.edu.cn/13497/list.htm";
const directoryUrl = "https://grs.hdu.edu.cn/2026/0929/c13497a301001/page.htm";
const xlsUrl = "https://grs.hdu.edu.cn/_upload/catalog.xls";
const charterUrl = "https://grs.hdu.edu.cn/2026/0928/c13497a300811/page.htm";
const campusUrl = "https://xxhzk.hdu.edu.cn/main.htm";
// Structural fixtures, not an alternative to the actual school's admission catalogue.
const table =
  "工作表：目录\n第1行：2027年硕士研究生招生专业目录\n第2行：学院 | 专业 | 学位 | 考试科目\n第3行：010机械工程学院 | 080200机械工程 | 学术学位 | 初试①101思想政治理论②201英语（一）③301数学（一）\n第4行：010机械工程学院 | 085500机械 | 专业学位 | 初试①101思想政治理论②201英语（一）③301数学（一）";
function fixture(
  fail: "plan" | "report" | "none" = "none",
  campusChain: "none" | "complete" | "unreadable" = "none",
) {
  const reads: string[] = [];
  const calls: string[] = [];
  const adapter: ModelAdapter = {
    async complete(messages) {
      const plan = messages[0].content.includes("research-direction-plan");
      calls.push(plan ? "plan" : "report");
      if ((plan && fail === "plan") || (!plan && fail === "report"))
        throw new ModelError("PROVIDER_NETWORK_ERROR");
      return {
        content: JSON.stringify(
          plan
            ? { directions: [], followUpQuestions: ["请提供专业"] }
            : {
                summary: "模型没有提出任何学校。",
                facts: [],
                recommendations: [],
                limitations: [],
              },
        ),
        inputTokens: 100,
        outputTokens: 100,
        model: "deepseek-v4-pro",
      };
    },
  };
  const reader: WebReader = async (url) => {
    if (new URL(url).hostname === "api.search.brave.com")
      return {
        contentType: "application/json",
        text: JSON.stringify({ web: { results: [] } }),
      };
    reads.push(url);
    if (url === listUrl)
      return {
        contentType: "text/html",
        text: `<header>${school}研究生院</header><a href="${directoryUrl}">2027年硕士研究生招生专业目录</a>${campusChain === "none" ? "" : `<a href="${charterUrl}">2027年硕士研究生招生章程</a>`}<footer>Copyright©${school}研究生院</footer>`,
      };
    if (url === directoryUrl)
      return {
        contentType: "text/html",
        text: `<h1>${school}2027年硕士研究生招生专业目录</h1><a href="${xlsUrl}">2027年硕士研究生招生专业目录.xls</a>${campusChain === "none" ? `<p>${school}机械工程培养地点：杭州市钱塘区。</p><p>${school}机械专业硕士培养地点：杭州市钱塘区。</p>` : ""}<footer>Copyright©${school}研究生院</footer>`,
      };
    if (url === xlsUrl)
      return { contentType: "application/vnd.ms-excel", text: table };
    if (url === charterUrl && campusChain !== "none")
      return {
        contentType: "text/html",
        text: `<h1>${school}2027年硕士研究生招生章程</h1><p>录取在电子信息学院、集成电路学院的新生所在校区为下沙校区或绍兴校区；录取在其他学院的新生所在校区为下沙校区或文一校区。</p><p>招生办公室（下沙校区行政楼207） 地址：杭州市钱塘区。</p><footer>${school}</footer>`,
      };
    if (url === campusUrl && campusChain === "complete")
      return {
        contentType: "text/html",
        text: `<header>${school}</header><footer>地址：杭州市西湖区文一路115号 ${school}（文一校区）实验楼</footer>`,
      };
    throw new ModelError("WEB_UNAVAILABLE");
  };
  const run = generateGuidance({
    subjectId: "inventory-flow",
    guidanceRunId: "inventory-flow",
    generatedAt: "2026-10-04T00:00:00Z",
    profile: {
      ...blankProfile(),
      major: "机械设计制造及其自动化",
      cities: ["杭州"],
      crossMajor: "接受跨专业",
      degreePreference: "倾向专硕",
      hours: "4–6小时",
    },
    profileVersion: 1,
    selectionVersion: 0,
    confirmedMajorId: null,
    excludedMajorIds: [],
    assessments: [],
  });
  const engine = createResearchReportModule({
    enabled: true,
    apiKey: "test-only",
    searchEnabled: true,
    searchKey: "test-only",
    adapter,
    reader,
    userDailyTokens: 100000,
    globalDailyTokens: 500000,
    searchDailyRequestsPerUser: 100,
    searchDailyRequestsGlobal: 500,
  });
  return { reads, calls, run, engine };
}

for (const campusChain of ["complete", "unreadable"] as const) {
  test(`coded faculty and charter trigger bounded campus geography lookup: ${campusChain}`, async () => {
    const { engine, run, reads } = fixture("none", campusChain);
    const report = await engine.generate({ subjectId: run.subjectId, run });
    assert.equal(report.failureStage, undefined);
    assert.equal(reads.filter((url) => url === campusUrl).length, 1);
    assert.ok(reads.indexOf(campusUrl) > reads.indexOf(xlsUrl));
    const main = report.recommendations[0];
    assert.equal(main.collegeName, "机械工程学院");
    assert.equal(main.programAlternatives?.[0].degreeType, "academic");
    assert.equal(
      main.constraintChecks?.find((check) => check.field === "cities")?.status,
      campusChain === "complete" ? "match" : "unknown",
    );
    assert.equal(
      main.tier,
      campusChain === "complete" ? "preferred" : "alternative",
    );
    if (campusChain === "complete") {
      assert.equal(main.location?.city, "杭州");
      assert.equal(main.location?.supportingEvidence?.length, 4);
      for (const evidence of main.location!.supportingEvidence!) {
        const source = report.sources.find(
          (source) => source.id === evidence.sourceId,
        )!;
        assert.ok(source.excerpt.includes(evidence.quote));
        assert.ok(main.citations.includes(evidence.sourceId));
      }
    }
    assert.ok(reads.length <= 24);
  });
}
for (const failure of ["none", "plan", "report"] as const) {
  test(`known city directory → HTML detail → XLS yields both routes even with ${failure} model failure or omissions`, async () => {
    const { engine, run, reads, calls } = fixture(failure);
    const report = await engine.generate({ subjectId: run.subjectId, run });
    assert.equal(report.reportVersion, "profile-research-v7");
    assert.ok(reads.indexOf(directoryUrl) > reads.indexOf(listUrl));
    assert.ok(reads.indexOf(xlsUrl) > reads.indexOf(directoryUrl));
    assert.equal(report.recommendations.length, 1);
    const main = report.recommendations[0];
    assert.equal(main.institutionName, school);
    assert.equal(main.degreeType, "professional");
    assert.equal(main.tier, "preferred");
    assert.equal(main.collegeName, "机械工程学院");
    assert.equal(main.exams?.status, "verified_current");
    assert.deepEqual(
      main.exams?.subjects.map((s) => s.code),
      ["101", "201", "301"],
    );
    assert.equal(main.programAlternatives?.[0].degreeType, "academic");
    assert.equal(report.coverage?.schoolCount, 1);
    assert.ok(
      report.candidateAudit?.some(
        (entry) =>
          entry.institutionName === school && entry.status === "recommended",
      ),
    );
    assert.ok(
      report.sources.find((source) => source.url === xlsUrl)?.provenance,
    );
    assert.ok(
      report.sources
        .find((source) => source.url === xlsUrl)
        ?.excerpt.includes("085500机械"),
    );
    assert.ok(report.decisionBasis);
    assert.equal(report.status, "partial");
    assert.ok(calls.includes("report"));
    if (failure === "none") assert.equal(report.failureStage, undefined);
    assert.match(report.summary, /杭州电子科技大学/);
  });
}

test("HTML body extraction keeps program rows and a plain institutional footer in separate passages", () => {
  assert.equal(
    webPageText(
      "<script>答案泄漏</script><p>080200 机械工程</p><p>初试科目：201英语一</p><footer>地址：杭州市。</footer>",
    ),
    "080200 机械工程\n初试科目：201英语一\n地址：杭州市。",
  );
});

test("an unregistered city and school recover both degree routes and campus city from actual discovered links", async () => {
  const university = "清源大学";
  const directory = "https://grad.qingyuan.edu.cn/2027/directory.htm";
  const charter = "https://grad.qingyuan.edu.cn/2027/charter.htm";
  const campus = "https://www.qingyuan.edu.cn/campus.htm";
  const reads: string[] = [];
  const queries: string[] = [];
  const reader: WebReader = async (url) => {
    if (new URL(url).hostname === "api.search.brave.com") {
      queries.push(new URL(url).searchParams.get("q") ?? "");
      return {
        contentType: "application/json",
        text: JSON.stringify({
          web: {
            results: [
              {
                title: `${university}2027年硕士研究生招生专业目录`,
                url: directory,
                description: `${university}机械工程硕士研究生招生`,
              },
            ],
          },
        }),
      };
    }
    reads.push(url);
    if (url === directory)
      return {
        contentType: "text/html",
        text: `<h1>${university}2027年硕士研究生招生专业目录</h1><p>010机械工程学院 | 080200机械工程 | 学术学位 | 初试①101思想政治理论②201英语（一）③301数学（一）</p><p>010机械工程学院 | 085500机械 | 专业学位 | 初试①101思想政治理论②204英语（二）③302数学（二）</p><a href="${charter}">2027年硕士研究生招生章程</a><footer>${university}</footer>`,
      };
    if (url === charter)
      return {
        contentType: "text/html",
        text: `<h1>${university}2027年硕士研究生招生章程</h1><p>机械工程学院硕士研究生就读校区为东校区。</p><a href="${campus}">校区介绍</a><footer>${university}</footer>`,
      };
    if (url === campus)
      return {
        contentType: "text/html",
        text: `<h1>${university}校区介绍</h1><p>东校区 地址：南京市清源路1号。</p><footer>${university}</footer>`,
      };
    throw new ModelError("WEB_UNAVAILABLE");
  };
  const adapter: ModelAdapter = {
    async complete(messages) {
      return {
        model: "deepseek-v4-pro",
        inputTokens: 100,
        outputTokens: 100,
        content: JSON.stringify(
          messages[0].content.includes("research-direction-plan")
            ? { directions: [], followUpQuestions: [] }
            : {
                summary: "模型没有提出任何学校。",
                facts: [],
                recommendations: [],
                limitations: [],
              },
        ),
      };
    },
  };
  const run = generateGuidance({
    subjectId: "unregistered",
    guidanceRunId: "unregistered",
    generatedAt: "2026-10-04T00:00:00Z",
    profile: {
      ...blankProfile(),
      major: "机械工程",
      targetMajor: "机械",
      cities: ["南京"],
      degreePreference: "倾向专硕",
      hours: "4–6小时",
    },
    profileVersion: 1,
    selectionVersion: 0,
    confirmedMajorId: null,
    excludedMajorIds: [],
    assessments: [],
  });
  const engine = createResearchReportModule({
    enabled: true,
    apiKey: "test-only",
    searchEnabled: true,
    searchKey: "test-only",
    adapter,
    reader,
    userDailyTokens: 100000,
    globalDailyTokens: 500000,
    searchDailyRequestsPerUser: 100,
    searchDailyRequestsGlobal: 500,
  });
  const report = await engine.generate({ subjectId: run.subjectId, run });
  assert.equal(report.failureStage, undefined);
  assert.ok(
    queries.some(
      (query) => query.includes("南京") && query.includes("招生单位"),
    ),
  );
  assert.deepEqual(reads, [directory, charter, campus]);
  assert.equal(report.recommendations.length, 1);
  const main = report.recommendations[0];
  assert.equal(main.institutionName, university);
  assert.equal(main.location?.city, "南京");
  assert.equal(main.tier, "preferred");
  assert.deepEqual(
    main.exams?.subjects.map((subject) => subject.code),
    ["101", "204", "302"],
  );
  assert.equal(main.programAlternatives?.[0].degreeType, "academic");
  assert.deepEqual(
    main.programAlternatives?.[0].exams.subjects.map((subject) => subject.code),
    ["101", "201", "301"],
  );
  assert.ok(
    report.candidateAudit?.some(
      (item) =>
        item.institutionName === university && item.status === "recommended",
    ),
  );
});
