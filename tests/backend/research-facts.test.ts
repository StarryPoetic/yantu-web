import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../server/store.ts";
import { createResearchEvidenceLibrary } from "../../server/explanation/research-library.ts";
import type { WebSource } from "../../server/explanation/web.ts";
import type {
  TuitionEvidence,
  LocationEvidence,
} from "../../shared/research-recommendation.ts";
import { libraryMissingGaps } from "../../server/explanation/research-library-first.ts";
import type { ResearchEvidenceGap } from "../../shared/research-coverage.ts";

const epoch = Date.parse("2026-10-11T00:00:00Z");
const catalogue =
  "杭州电子科技大学2027年硕士研究生招生专业目录。\n机械工程学院\n080200 机械工程 全日制 ①101思想政治理论②201英语（一）③301数学（一）④812机械工程综合";
function page(path: string, excerpt = catalogue, offset = 0): WebSource {
  return {
    id: path,
    title: "硕士招生资料",
    url: `https://grs.hdu.edu.cn/${path}`,
    excerpt,
    retrievedAt: new Date(epoch + offset).toISOString(),
    kind: "official_page",
    verified: false,
  };
}
const query = { targetYear: "2027", disciplineCodes: ["0802"] };

test("known registry schools' non-edu HTTPS originals persist, while their HTTP and unregistered domains remain rejected", () => {
  const store = new Store(),
    library = createResearchEvidenceLibrary(store, { now: () => epoch });
  try {
    const source = {
      ...page("ucas"),
      url: "https://admission.ucas.ac.cn/catalogue",
      excerpt: catalogue.replace("杭州电子科技大学", "中国科学院大学"),
    };
    library.save(source);
    assert.equal(library.load(query).length, 1);
    assert.ok(
      library.queryFacts(query).some((f) => f.schoolName === "中国科学院大学"),
    );
    library.save({ ...source, url: "http://admission.ucas.ac.cn/catalogue" });
    library.save({ ...source, url: "https://unregistered.cn/catalogue" });
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS n FROM research_public_sources")
        .get()!.n,
      1,
    );
  } finally {
    store.close();
  }
});

test("facts persist unchanged across restart and a stage-1 originals-only database deterministically backfills", () => {
  const directory = mkdtempSync(join(tmpdir(), "program-facts-")),
    path = join(directory, "public.sqlite");
  let store = new Store(path);
  try {
    const first = createResearchEvidenceLibrary(store, { now: () => epoch });
    first.save(page("catalogue"));
    const facts = first.queryFacts(query);
    assert.equal(facts.length, 2);
    store.close();
    store = new Store(path);
    assert.deepEqual(
      createResearchEvidenceLibrary(store, {
        now: () => epoch + 1000,
      }).queryFacts(query),
      facts,
    );
    store.db.exec("DROP TABLE research_program_facts");
    store.close();
    store = new Store(path);
    const migrated = createResearchEvidenceLibrary(store, {
      now: () => epoch + 2000,
    });
    assert.equal(migrated.queryFacts(query).length, 2);
    assert.ok(
      migrated
        .queryFacts(query)
        .every(
          (f) =>
            f.retrievedAt === page("catalogue").retrievedAt &&
            f.extractedAt === new Date(epoch + 2000).toISOString(),
        ),
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("multi-page campus binding retains all phase-2 supporting passages and their persisted IDs", () => {
  let clock = epoch;
  const store = new Store(),
    library = createResearchEvidenceLibrary(store, {
      now: () => clock,
      targetTtlMs: 10 * 86400000,
    });
  try {
    library.save(
      page(
        "directory",
        "杭州电子科技大学2027年硕士研究生招生专业目录\n第4行：010机械工程学院 | 080200机械工程 | 学术学位 | 201英语（一）301数学（一）",
      ),
    );
    library.save(
      page(
        "charter",
        "杭州电子科技大学2027年硕士研究生招生章程\n十四、培养所在校区\n录取在电子信息学院、集成电路科学与工程学院的新生所在校区：根据研究生导师团队和学科方向在杭州电子科技大学下沙校区或绍兴校区。\n其他学院的新生所在校区为杭州电子科技大学下沙校区或文一校区。\n联系方式\n研究生招生办公室（下沙校区行政楼207）\n地址：杭州市钱塘区2号大街1158号",
      ),
    );
    assert.ok(
      library
        .queryFacts(query)
        .some((f) => f.field === "campus" && f.status === "bound"),
      "documented campus hints suffice for city binding",
    );
    library.save(
      page(
        "geography",
        "杭州电子科技大学浙江省信息化发展研究院\n联系我们\n地址：杭州市西湖区文一路115号 杭州电子科技大学（文一校区）实验楼\n版权所有©杭州电子科技大学",
      ),
    );
    const fact = library
      .queryFacts(query)
      .find((f) => f.field === "campus" && f.status === "bound");
    const location = fact?.value as LocationEvidence;
    assert.equal(location.city, "杭州");
    assert.equal(location.supportingEvidence?.length, 4);
    const sources = library.load({
      ...query,
      schoolNames: ["杭州电子科技大学"],
    });
    assert.ok(
      location.supportingEvidence?.every((e) =>
        sources.find((s) => s.id === e.sourceId)?.excerpt.includes(e.quote),
      ),
    );
    clock += 11 * 86400000;
    const expired = library
      .queryFacts(query)
      .find((f) => f.field === "campus" && f.status === "bound");
    assert.equal(expired?.targetYearApplicable, false);
    assert.equal(expired?.freshness, "stale");
  } finally {
    store.close();
  }
});

test("facts use complete project identity, exact quotes, canonical schools, explicit year and no model/profile data", () => {
  const store = new Store(),
    library = createResearchEvidenceLibrary(store, { now: () => epoch });
  try {
    library.save({
      ...page("catalogue"),
      profile: "PRIVATE_PROFILE",
      recommendations: [{ tuition: 3 }],
      question: "PRIVATE_QUERY",
    } as WebSource);
    const facts = library.queryFacts({
      ...query,
      collegeName: "机械工程学院",
      majorCode: "080200",
      studyMode: "full_time",
      degreeType: "academic",
      year: 2027,
    });
    assert.deepEqual(facts.map((f) => f.field).sort(), ["catalog", "exams"]);
    assert.ok(
      facts.every(
        (f) =>
          f.schoolName === "杭州电子科技大学" &&
          f.verified === false &&
          f.status === "bound" &&
          f.targetYearApplicable &&
          catalogue.includes(f.quote) &&
          f.extractor === "phase2-program-binding@3",
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(
        store.db.prepare("SELECT payload FROM research_program_facts").all(),
      ),
      /PRIVATE_|profile|recommendations|rationale|subjectId/,
    );
    assert.equal(
      library.queryFacts({ ...query, cities: ["杭州市"] }).length,
      2,
    );
    assert.equal(
      library.queryFacts({ ...query, registrableDomains: ["hdu.edu.cn"] })
        .length,
      2,
    );
    assert.equal(
      library.queryFacts({ ...query, schoolNames: ["浙江大学"] }).length,
      0,
    );
    assert.equal(
      library.queryFacts({ ...query, collegeName: "计算机学院" }).length,
      0,
    );
    assert.deepEqual(library.coverageStats(), {
      librarySchoolCount: 1,
      libraryProgramCount: 1,
    });
  } finally {
    store.close();
  }
});

test("different sources and years retain conflicting values; source replacement removes only its prior version and failures preserve all facts", () => {
  let clock = epoch;
  const store = new Store(),
    library = createResearchEvidenceLibrary(store, { now: () => clock });
  try {
    library.save(page("catalogue"));
    for (const [path, year, amount] of [
      ["a", 2027, 8000],
      ["b", 2027, 9000],
      ["old", 2026, 7000],
    ] as const)
      library.save(
        page(
          path,
          `杭州电子科技大学${year}年硕士研究生收费标准。全校所有硕士研究生学费统一为${amount}元/年。`,
        ),
      );
    const fees = () =>
      library
        .queryFacts(query)
        .filter((f) => f.field === "tuition" && f.status === "bound");
    assert.deepEqual(
      fees()
        .map((f) => (f.value as TuitionEvidence).amount)
        .sort(),
      [7000, 8000, 9000],
    );
    assert.ok(
      fees().every((f) => (f.value as TuitionEvidence).scope === "school_wide"),
    );
    clock += 1000;
    library.save(
      page(
        "a",
        "杭州电子科技大学2027年硕士研究生收费标准。全校所有硕士研究生学费统一为10000元/年。",
        1000,
      ),
    );
    assert.deepEqual(
      fees()
        .map((f) => (f.value as TuitionEvidence).amount)
        .sort((a, b) => a - b),
      [7000, 9000, 10000],
    );
    library.recordAttempt({
      url: page("a").url,
      status: "failed",
      reason: "HTTP_503",
      attemptedAt: new Date(clock).toISOString(),
    });
    assert.equal(fees().length, 3);
    library.save(page("a", "杭州电子科技大学网页已更新，没有收费数据。", 1001));
    assert.deepEqual(
      fees()
        .map((f) => (f.value as TuitionEvidence).amount)
        .sort(),
      [7000, 9000],
    );
    library.save(page("historical", catalogue.replaceAll("2027", "2026")));
    assert.deepEqual(library.coverageStats(), {
      librarySchoolCount: 1,
      libraryProgramCount: 1,
    });
  } finally {
    store.close();
  }
});

test("freshness uses target/historical/undated TTL; stale facts remain visible but never target-year proof", () => {
  let clock = epoch;
  const store = new Store(),
    library = createResearchEvidenceLibrary(store, { now: () => clock });
  try {
    library.save(page("catalogue"));
    library.save(page("historical", catalogue.replaceAll("2027", "2026")));
    library.save(
      page(
        "undated",
        "杭州电子科技大学硕士研究生收费标准。全校所有硕士研究生学费统一为8000元/年。",
      ),
    );
    clock += 2 * 86400000;
    const facts = library.queryFacts(query);
    assert.ok(
      facts
        .filter((f) => f.year === 2027)
        .every((f) => f.freshness === "stale" && !f.targetYearApplicable),
    );
    assert.ok(
      facts
        .filter((f) => f.year === 2026)
        .every((f) => f.freshness === "fresh" && !f.targetYearApplicable),
    );
    assert.ok(
      facts.some(
        (f) =>
          f.field === "tuition" &&
          f.year === undefined &&
          !f.targetYearApplicable,
      ),
    );
    clock += 31 * 86400000;
    assert.ok(library.queryFacts(query).every((f) => f.freshness === "stale"));
  } finally {
    store.close();
  }
});

test("unresolved modes keep pending tariff passages; city-only binding never gains a campus or programme scope", () => {
  const store = new Store(),
    library = createResearchEvidenceLibrary(store, { now: () => epoch });
  try {
    library.save(page("generic", catalogue.replace("全日制 ", "")));
    library.save(
      page(
        "fees",
        "杭州电子科技大学2027年硕士研究生收费标准。全日制硕士研究生学费8000元/年。非全日制硕士研究生学费30000元/年。",
      ),
    );
    assert.ok(
      library
        .queryFacts(query)
        .some((f) => f.field === "tuition" && f.status === "pending"),
    );
    library.save({
      ...page("nbut"),
      url: "https://www.nbut.edu.cn/catalog",
      excerpt:
        "宁波工程学院2027年硕士研究生招生专业目录。\n080200 机械工程 全日制。\n校区地址：宁波杭州湾新区滨海二路769号。\n校区地址：宁波市江北区风华路201号。",
    });
    const location = library
      .queryFacts(query)
      .find(
        (f) =>
          f.field === "campus" &&
          f.status === "bound" &&
          f.schoolName === "宁波工程学院",
      );
    assert.equal((location?.value as LocationEvidence)?.city, "宁波");
    assert.equal(
      (location?.value as LocationEvidence & { campus?: string })?.campus,
      undefined,
    );
    library.save({
      ...page("alias"),
      url: "https://www.ylu.edu.cn/catalog",
      excerpt:
        "榆林大学2027年硕士研究生招生专业目录。\n榆林学院\n080200 机械工程 全日制。",
    });
    assert.ok(
      library.queryFacts(query).some((f) => f.schoolName === "榆林大学"),
    );
    assert.ok(
      library
        .queryFacts(query)
        .filter((f) => f.schoolName === "榆林大学")
        .every((f) => f.collegeName === undefined),
    );
  } finally {
    store.close();
  }
});

test("academic HTTP and HTTPS deduplicate by final page, preserve redirect chain and provenance, reject other plaintext hosts", () => {
  const store = new Store(),
    library = createResearchEvidenceLibrary(store, {
      now: () => epoch,
      allowedHosts: ["yz.chsi.com.cn"],
    });
  try {
    const source = {
      ...page("start"),
      url: "http://grs.hdu.edu.cn/start",
      finalUrl: "http://grs.hdu.edu.cn/catalogue",
      transport: "http" as const,
      redirectChain: [
        "http://grs.hdu.edu.cn/intermediate",
        "http://grs.hdu.edu.cn/catalogue",
      ],
    };
    library.save(source);
    library.save({ ...page("catalogue"), retrievedAt: source.retrievedAt });
    assert.equal(library.load(query).length, 1);
    assert.equal(library.coverageStats().libraryProgramCount, 1);
    library.save({ ...source, retrievedAt: new Date(epoch + 1).toISOString() });
    const loaded = library.load(query)[0];
    assert.deepEqual(loaded.redirectChain, source.redirectChain);
    assert.equal(loaded.transport, "http");
    assert.match(loaded.retrievalNote!, /明文传输/);
    assert.equal(library.isFresh(source.url, "2027"), true);
    assert.equal(
      library.isFresh("https://grs.hdu.edu.cn/catalogue", "2027"),
      true,
    );
    library.save({ ...page("platform"), url: "http://yz.chsi.com.cn/zsml/" });
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS n FROM research_public_sources")
        .get()!.n,
      1,
    );
  } finally {
    store.close();
  }
});

test("library gaps require only missing fields, with exact project identity and fresh explicit target year", () => {
  const store = new Store(),
    library = createResearchEvidenceLibrary(store, { now: () => epoch });
  try {
    library.save(page("catalogue"));
    const gaps = ["program", "exams", "tuition", "location"].map((field) => ({
      field,
      institutionName: "杭州电子科技大学",
      majorCode: "080200",
      programName: "机械工程",
      collegeName: "机械工程学院",
      studyMode: "full_time",
      disciplineCode: "0802",
      targetYear: "2027",
    })) as ResearchEvidenceGap[];
    const facts = library.queryFacts(query);
    assert.equal(libraryMissingGaps(gaps, facts, []).length, 4);
    assert.equal(
      libraryMissingGaps(
        gaps.map((g) => ({ ...g, purpose: "resolve_ambiguity" as const })),
        facts,
      ).length,
      4,
    );
    assert.deepEqual(
      libraryMissingGaps(gaps, facts).map((g) => g.field),
      ["tuition", "location"],
    );
    assert.equal(
      libraryMissingGaps(
        gaps.map((g) => ({ ...g, collegeName: "其他学院" })),
        facts,
      ).length,
      4,
    );
    assert.equal(
      libraryMissingGaps(
        gaps,
        facts.map((f) => ({ ...f, targetYearApplicable: false })),
      ).length,
      4,
    );
  } finally {
    store.close();
  }
});
