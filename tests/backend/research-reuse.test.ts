import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../server/store.ts";
import { generateGuidance } from "../../server/disciplines/index.ts";
import { blankProfile } from "../../server/profile.ts";
import {
  createModelRuntime,
  ModelError,
} from "../../server/explanation/index.ts";
import { createResearchReportModule } from "../../server/explanation/research.ts";
import {
  createWebAnswerModule,
  webPageText,
} from "../../server/explanation/web.ts";
import { createResearchEvidenceLibrary } from "../../server/explanation/research-library.ts";
import type { ModelMessage } from "../../server/explanation/deepseek.ts";
import type { WebSource } from "../../server/explanation/web.ts";

// Public-policy fixtures are fictional; no provider or live school request is made.
const school = "苏州清源大学";
const host = "yz.qingyuan.edu.cn";
const url = `https://${host}/directory.htm`;
const feeUrl = `https://${host}/fees.htm`;
const initialTime = Date.parse("2026-10-04T08:00:00Z");
const row =
  "001机械学院 | 080200 机械工程 学术学位 全日制 ①101思想政治理论 ②201英语一 ③301数学一 ④811机械原理";
const directory = `${school}2026年硕士研究生招生专业目录。\n${row}`;
function guidance(subjectId = "reuse-first", cities = ["苏州"]) {
  return generateGuidance({
    subjectId,
    guidanceRunId: `${subjectId}-run`,
    generatedAt: new Date(initialTime).toISOString(),
    profile: {
      ...blankProfile(),
      name: `PRIVATE_NAME_${subjectId}`,
      notes: `PRIVATE_NOTE_${subjectId}`,
      university: "本科背景大学",
      major: "机械工程",
      targetMajor: "机械",
      year: "2027",
      cities,
      budget: "1万元以内",
      hours: "4–6 小时",
      crossMajor: "接受跨专业",
      studyGoal: "专业实践与行业就业",
    },
    profileVersion: 1,
    selectionVersion: 0,
    confirmedMajorId: null,
    excludedMajorIds: [],
    assessments: [],
  });
}
function setup(
  store: Store,
  settings: {
    now?: () => number;
    noResults?: boolean;
    directoryText?: string;
    fee?: "success" | "failed";
    schoolHints?: string[];
  } = {},
) {
  const requests: string[] = [];
  const modelCalls: ModelMessage[][] = [];
  const now = settings.now ?? (() => initialTime);
  const library = createResearchEvidenceLibrary(store, { now });
  const config = {
    enabled: true,
    apiKey: "mock-model-only",
    searchEnabled: true,
    searchKey: "mock-search-only",
    searchDailyRequestsPerUser: 100,
    searchDailyRequestsGlobal: 500,
    userDailyTokens: 150000,
    globalDailyTokens: 500000,
    allowedHosts: [host],
    allowAcademicHosts: false,
    now,
    adapter: {
      async complete(messages: ModelMessage[]) {
        modelCalls.push(structuredClone(messages));
        const planning = messages[0].content.includes(
          "research-direction-plan-v6",
        );
        return {
          content: JSON.stringify(
            planning
              ? {
                  directions: ["0802", "0855"].map((disciplineCode) => ({
                    disciplineCode,
                    ...(settings.schoolHints
                      ? { searchSchools: settings.schoolHints }
                      : {}),
                    rationale:
                      "结合已保存的机械兴趣与实践目标比较学术和专业培养路线。",
                    fitReasons: [
                      {
                        profileField: "targetMajor",
                        reason: "机械兴趣支持调查对应的硕士培养项目。",
                      },
                      {
                        profileField: "studyGoal",
                        reason: "结合实践就业目标比较具体训练内容。",
                      },
                    ],
                  })),
                  followUpQuestions: [],
                }
              : {
                  summary: "比较已取得学校条目，未取得资料继续核验。",
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
    },
    reader: async (value: string) => {
      requests.push(value);
      const parsed = new URL(value);
      if (parsed.hostname === "api.search.brave.com")
        return {
          contentType: "application/json",
          text: JSON.stringify({
            web: {
              results: settings.noResults
                ? []
                : [
                    {
                      url,
                      title: `${school}2026年机械硕士招生目录`,
                      description: directory,
                    },
                  ],
            },
          }),
        };
      if (value === url)
        return {
          contentType: "text/html",
          text: settings.directoryText ?? directory,
        };
      if (value === feeUrl && settings.fee === "success")
        return {
          contentType: "text/html",
          text: `${school}2026年硕士研究生收费标准。\n001机械学院 | 080200 机械工程 全日制 学费8000元/年。`,
        };
      throw new ModelError("WEB_UNAVAILABLE");
    },
  };
  const runtime = createModelRuntime(config);
  const web = createWebAnswerModule({ ...config, runtime });
  return {
    module: createResearchReportModule(config, { runtime, web, library }),
    library,
    requests,
    modelCalls,
  };
}
function seed(
  library: ReturnType<typeof createResearchEvidenceLibrary>,
  documentLinks?: WebSource["documentLinks"],
) {
  library.save({
    id: "initial-source",
    url,
    title: `${school}2026年硕士研究生目录`,
    excerpt: directory,
    kind: "official_page",
    verified: false,
    retrievedAt: new Date(initialTime).toISOString(),
    ...(documentLinks ? { documentLinks } : {}),
  });
}

test("library-first repair logs each real read once under an advancing clock and reports only dispatched counts", async () => {
  const store = new Store();
  let clock = initialTime;
  try {
    const after = setup(store, {
      now: () => ++clock,
      noResults: true,
      fee: "success",
    });
    seed(after.library, [{ url: feeUrl, title: "2026年硕士研究生收费标准" }]);
    const run = guidance("advancing-read-stats");
    const report = await after.module.generate({
      subjectId: run.subjectId,
      run,
    });
    assert.equal(after.requests.filter((value) => value === feeUrl).length, 1);
    assert.equal(
      report.evidenceCoverage!.attempts.filter(
        (a) => a.url === feeUrl && a.status === "success",
      ).length,
      1,
    );
    assert.equal(
      after.library.attempts([feeUrl]).filter((a) => a.status === "success")
        .length,
      1,
    );
    assert.equal(report.readStatistics!.success, report.usage!.reads.success);
    assert.equal(report.readStatistics!.failed, report.usage!.reads.failed);
    assert.ok(
      report.coverage!.shortfallReasons.some((s) =>
        s.includes(`尝试读取 ${report.usage!.reads.reads} 项`),
      ),
    );
  } finally {
    store.close();
  }
});

test("the report module saves real page reads and reuses public evidence after restart for a different user and preference", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "yantu-report-reuse-"));
  const dbPath = join(temporary, "public.sqlite");
  let store = new Store(dbPath);
  try {
    const first = setup(store);
    const firstRun = guidance();
    const old = await first.module.generate({
      subjectId: firstRun.subjectId,
      run: firstRun,
    });
    assert.ok(first.requests.includes(url));
    assert.equal(
      old.evidenceCoverage!.supplementedSourceCount,
      1,
      "normal generation counts its successful new source",
    );
    assert.ok(
      first.library
        .load({ disciplineCodes: ["0802"], targetYear: "2027" })
        .some((source) => source.url === url),
    );
    assert.ok(
      old.recommendations.some((item) => item.institutionName === school),
    );
    first.module.clearSubject(firstRun.subjectId);
    store.close();
    store = new Store(dbPath);
    const second = setup(store, { noResults: true });
    const newRun = guidance("reuse-second", ["南京"]);
    const current = await second.module.generate({
      subjectId: newRun.subjectId,
      run: newRun,
    });
    const paidSearches = (requests: string[]) =>
      requests.filter(
        (value) => new URL(value).hostname === "api.search.brave.com",
      ).length;
    assert.ok(
      paidSearches(second.requests) < paidSearches(first.requests),
      `library-first searches: first=${paidSearches(first.requests)}, second=${paidSearches(second.requests)}`,
    );
    assert.deepEqual(
      current.evidenceCoverage && {
        librarySchoolCount: current.evidenceCoverage.librarySchoolCount,
        libraryProgramCount: current.evidenceCoverage.libraryProgramCount,
      },
      second.library.coverageStats(),
    );
    assert.equal(
      current.sources.find((source) => source.url === url)?.id,
      second.library.load({ disciplineCodes: ["0802"], targetYear: "2027" })[0]
        ?.id,
    );
    assert.ok(
      current.recommendations.some((item) => item.institutionName === school),
    );
    assert.equal(current.evidenceCoverage!.reusedSourceCount, 1);
    assert.equal(
      current.evidenceCoverage!.supplementedSourceCount,
      0,
      "library reuse is not a new read",
    );
    assert.equal(second.requests.filter((value) => value === url).length, 0);
    const reused = current.sources.find((source) => source.url === url)!;
    assert.equal(
      reused.retrievedAt,
      old.sources.find((source) => source.url === url)!.retrievedAt,
    );
    assert.equal(reused.verified, false);
    assert.equal(reused.library!.status, "fresh");
    assert.ok(
      current.recommendations.every((item) =>
        item.citations.every((id) =>
          current.sources.some((source) => source.id === id),
        ),
      ),
    );
    const records = JSON.stringify(
      store.db.prepare("SELECT payload FROM research_public_sources").all(),
    );
    assert.doesNotMatch(
      records,
      /PRIVATE_NAME_|PRIVATE_NOTE_|reuse-first|reuse-second/,
    );
    assert.doesNotMatch(
      JSON.stringify(second.modelCalls),
      /PRIVATE_NAME_reuse-first|PRIVATE_NOTE_reuse-first/,
    );
    assert.equal(current.guidanceRunId, newRun.guidanceRunId);
  } finally {
    store.close();
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("the integrated report records every related programme and independent field gaps even when model school cards are empty", async () => {
  const store = new Store();
  try {
    const text = [
      `${school}2026年硕士研究生招生专业目录。`,
      row,
      "001机械学院 | 080201 机械制造及其自动化 全日制 ①101思想政治理论 ②204英语二 ③302数学二 ④812工程基础",
      "002工程学院 | 085500 机械 非全日制",
      "001机械学院 | 080202 机械电子工程 全日制",
      "001机械学院 | 080203 车辆工程 全日制",
      "002工程学院 | 085501 机械工程 全日制",
      "002工程学院 | 085502 车辆工程 全日制",
      "003计算机学院 | 081200 计算机科学与技术 全日制",
      "本目录的公开说明文字，不涉及任何个人资料。\n".repeat(400),
      "004机器人学院 | 085510 机器人技术 全日制",
    ].join("\n");
    assert.ok(text.indexOf("085510") > 6000);
    const { module, modelCalls } = setup(store, { directoryText: text });
    const run = guidance();
    // An explicit refusal excludes the unrelated computer category from this request.
    run.inputSnapshot.profile.notes = "不考虑计算机专业";
    const report = await module.generate({ subjectId: run.subjectId, run });
    const candidate = report.candidateAudit!.find(
      (item) => item.institutionName === school,
    )!;
    const programs = candidate.coverage!.programs;
    assert.deepEqual(programs.map((item) => item.majorCode).sort(), [
      "080200",
      "080201",
      "080202",
      "080203",
      "085500",
      "085501",
      "085502",
      "085510",
    ]);
    assert.equal(report.evidenceCoverage!.programCount, 8);
    for (const program of programs) {
      assert.equal(program.fields.program.status, "supported_reference");
      assert.equal(Object.keys(program.fields).length, 6);
      assert.ok(
        program.fields.program.references.every((ref) =>
          ref.quote.includes(program.majorCode!),
        ),
      );
      assert.equal(program.fields.tuition.status, "missing");
      assert.equal(program.fields.curriculum.status, "missing");
      assert.ok(program.missing.some((gap) => gap.field === "location"));
    }
    const academic = programs.find((item) => item.majorCode === "080200")!;
    const manufacturing = programs.find((item) => item.majorCode === "080201")!;
    const professional = programs.find((item) => item.majorCode === "085500")!;
    assert.match(academic.fields.exams.references[0].quote, /201英语一/);
    assert.doesNotMatch(academic.fields.exams.references[0].quote, /204英语二/);
    assert.match(manufacturing.fields.exams.references[0].quote, /204英语二/);
    assert.equal(professional.fields.exams.status, "missing");
    assert.equal(new Set(programs.map((item) => item.identity)).size, 8);
    assert.equal(report.recommendations.length, 1);
    assert.ok(
      (report.recommendations[0].programAlternatives?.length ?? 0) <= 3,
    );
    assert.equal(
      report.sources.find((source) => source.url === url)!.excerpt,
      webPageText(text),
    );
    assert.ok(
      modelCalls
        .filter(
          (messages) =>
            !messages[0].content.includes("research-direction-plan-v6"),
        )
        .every((messages) => JSON.stringify(messages).length <= 24000),
    );
    assert.ok(
      candidate.coverage!.missing.every((gap) =>
        programs.some((item) => item.identity === gap.programIdentity),
      ),
    );
  } finally {
    store.close();
  }
});

test("supplement mode continues saved programme gaps, preserves prior bytes and adds known linked fee evidence", async () => {
  const store = new Store();
  let clock = initialTime;
  try {
    const before = setup(store, { now: () => clock, noResults: true });
    seed(before.library, [{ url: feeUrl, title: "2026年硕士研究生收费标准" }]);
    const run = guidance("supplement-public");
    const initial = await before.module.generate({
      subjectId: run.subjectId,
      run,
    });
    const bytes = JSON.stringify(initial);
    const previousProgram = initial.candidateAudit!.find(
      (item) => item.institutionName === school,
    )!.coverage!.programs[0];
    assert.equal(previousProgram.fields.tuition.status, "missing");
    clock += 6 * 60000;
    const after = setup(store, {
      now: () => clock,
      noResults: true,
      fee: "success",
      schoolHints: ["南京远山大学"],
    });
    const report = await after.module.generate({
      subjectId: run.subjectId,
      run,
      mode: "supplement",
      previousReport: initial,
    });
    assert.equal(JSON.stringify(initial), bytes);
    assert.equal(report.evidenceCoverage!.mode, "supplement");
    assert.ok(report.evidenceCoverage!.reusedSourceCount >= 1);
    assert.ok(report.evidenceCoverage!.supplementedSourceCount >= 1);
    assert.ok(after.requests.includes(feeUrl));
    const program = report
      .candidateAudit!.find((item) => item.institutionName === school)!
      .coverage!.programs.find(
        (item) => item.identity === previousProgram.identity,
      )!;
    assert.equal(program.fields.tuition.status, "supported_reference");
    assert.equal(program.fields.tuition.year, 2026);
    assert.ok(
      program.fields.tuition.references.some((ref) =>
        ref.quote.includes("8000元/年"),
      ),
    );
    assert.equal(program.fields.location.status, "missing");
    assert.ok(
      report.candidateAudit!.some(
        (candidate) => candidate.institutionName === "南京远山大学",
      ),
    );
    assert.ok(
      report.sources.some(
        (source) => source.url === url && source.excerpt === directory,
      ),
    );
    assert.ok(
      after.library
        .load({ disciplineCodes: ["0802"], targetYear: "2027" })
        .some((source) => source.url === feeUrl),
    );
  } finally {
    store.close();
  }
});

test("failed supplement reads keep existing facts and expose precise retry diagnostics", async () => {
  const store = new Store();
  try {
    const initial = setup(store, { noResults: true });
    seed(initial.library, [{ url: feeUrl, title: "2026年硕士研究生收费标准" }]);
    const run = guidance("failed-supplement");
    const previous = await initial.module.generate({
      subjectId: run.subjectId,
      run,
    });
    const retry = setup(store, {
      noResults: true,
      now: () => initialTime + 6 * 60000,
    });
    const report = await retry.module.generate({
      subjectId: run.subjectId,
      run,
      mode: "supplement",
      previousReport: previous,
    });
    assert.ok(
      report.sources.some(
        (source) => source.url === url && source.excerpt === directory,
      ),
    );
    assert.ok(
      report.recommendations.some((item) => item.institutionName === school),
    );
    const program = report.candidateAudit!.find(
      (item) => item.institutionName === school,
    )!.coverage!.programs[0];
    assert.equal(program.fields.tuition.status, "missing");
    assert.equal(report.evidenceCoverage!.supplementedSourceCount, 0);
    assert.equal(
      report.readStatistics!.failed,
      report.usage!.reads.failed,
      "historical failures do not count as failures dispatched in this supplement",
    );
    assert.ok(
      report.evidenceCoverage!.attempts.some(
        (attempt) => attempt.url === feeUrl && attempt.status === "failed",
      ),
    );
    assert.ok(
      retry.library
        .attempts([feeUrl])
        .some((attempt) => attempt.status === "failed"),
    );
    assert.equal(
      retry.library
        .load({ disciplineCodes: ["0802"], targetYear: "2027" })
        .find((source) => source.url === url)!.excerpt,
      directory,
    );
  } finally {
    store.close();
  }
});

test("a supplement cannot borrow a previous report from another guidance run or changed versions", async () => {
  const store = new Store();
  try {
    const { module, library, requests } = setup(store, { noResults: true });
    seed(library);
    const run = guidance();
    const previous = await module.generate({ subjectId: run.subjectId, run });
    const count = requests.length;
    const other = guidance("another-student");
    await assert.rejects(
      module.generate({
        subjectId: other.subjectId,
        run: other,
        mode: "supplement",
        previousReport: previous,
      }),
      (error: unknown) =>
        error instanceof ModelError && error.code === "GUIDANCE_NOT_FOUND",
    );
    const changed = structuredClone(run);
    changed.versions.profileVersion++;
    await assert.rejects(
      module.generate({
        subjectId: changed.subjectId,
        run: changed,
        mode: "supplement",
        previousReport: previous,
      }),
      (error: unknown) =>
        error instanceof ModelError && error.code === "GUIDANCE_NOT_FOUND",
    );
    assert.equal(requests.length, count);
  } finally {
    store.close();
  }
});
