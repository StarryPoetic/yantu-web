import { createHash } from "node:crypto";
import type { WebSource } from "./web.ts";
import type { Discipline } from "../disciplines/types.ts";
import type {
  ResearchPriorityFact,
  ResearchPriorityField,
} from "../../shared/research-priority-facts.ts";
import { schoolRegistry } from "../schools/index.ts";
import { historicalReferenceYears } from "../../shared/research-years.ts";
import {
  researchExternalPolicy,
  externalFieldAllowed,
} from "./research-source-policy.ts";
import { redactAdmissionsText } from "./research-priority-tables.ts";

/** Public external text is evidence, never a new school identity or a catalogue publication. */
export function externalPriorityFacts(
  source: WebSource,
  disciplines: readonly Discipline[],
  targetYear: string,
): ResearchPriorityFact[] {
  const policy = researchExternalPolicy(source.finalUrl ?? source.url);
  if (
    !policy ||
    researchExternalPolicy(source.url)?.tier !== policy.tier ||
    !["authority_page", "reference_page"].includes(source.kind)
  )
    return [];
  const body = redactAdmissionsText(source.excerpt);
  if (/请先登录|登录后(?:查看|可见)|验证码|访问过于频繁|人机验证/.test(body))
    return [];
  const schoolNames = [...schoolRegistry.schools].sort(
    (a, b) => b.name.length - a.name.length,
  );
  const namedSchools = (text: string) =>
    schoolNames.filter((s) => {
      if (!text.includes(s.name)) return false;
      text = text.replaceAll(s.name, " ");
      return true;
    });
  const schools = namedSchools(body);
  const facts: ResearchPriorityFact[] = [];
  const years = [
    ...new Set([...body.matchAll(/\b(20\d{2})\s*年/g)].map((m) => +m[1])),
  ];
  const lines = body
    .split(/\n|。/)
    .map((q) => q.trim())
    .filter(Boolean);
  const assessment = /第四轮学科评估/.test(body);
  const bodyDisciplines = disciplines.filter(
    (d) => body.includes(d.name) || new RegExp(`\\b${d.code}\\b`).test(body),
  );
  for (const quote of lines) {
    if (
      quote.length < 8 ||
      quote.length > 600 ||
      /【个人信息已删除】/.test(quote)
    )
      continue;
    const local = namedSchools(quote);
    const school =
      local.length === 1
        ? local[0]
        : schools.length === 1
          ? schools[0]
          : undefined;
    if (!school) continue;
    const named = disciplines.filter(
      (d) =>
        quote.includes(d.name) ||
        new RegExp(`\\b${d.code}\\d{0,2}\\b`).test(quote),
    );
    const specific = named.filter(
      (d) =>
        !named.some(
          (other) =>
            other.name.length > d.name.length && other.name.includes(d.name),
        ),
    );
    const discipline =
      specific.length === 1
        ? specific[0]
        : assessment && bodyDisciplines.length === 1
          ? bodyDisciplines[0]
          : undefined;
    const codes = [
      ...new Set([...quote.matchAll(/\b(\d{6})\b/g)].map((m) => m[1])),
    ];
    if (codes.length > 1 || specific.length > 1) continue;
    const localYears = [
      ...new Set([...quote.matchAll(/\b(20\d{2})\s*年/g)].map((m) => +m[1])),
    ];
    const year =
      localYears.length === 1
        ? localYears[0]
        : localYears.length
          ? undefined
          : years.length === 1
            ? years[0]
            : undefined;
    const add = (
      field: ResearchPriorityField,
      value: ResearchPriorityFact["value"],
      assessmentYear = year,
    ) => {
      if (
        !externalFieldAllowed(policy.tier, field) ||
        !assessmentYear ||
        assessmentYear > +targetYear
      )
        return;
      if (
        [
          "cutoff",
          "admissionScore",
          "applicationAdmissionRatio",
          "admittedCount",
          "recommendationShare",
        ].includes(field) &&
        ![...historicalReferenceYears(targetYear), +targetYear].includes(
          assessmentYear,
        )
      )
        return;
      if (
        [
          "cutoff",
          "applicationAdmissionRatio",
          "disciplineAssessment",
        ].includes(field) &&
        !discipline
      )
        return;
      const fact = {
        sourceTier: policy.tier,
        schoolName: school.name,
        disciplineCode: discipline?.code,
        programName: discipline?.name,
        majorCode: codes[0],
        scope: discipline ? ("program" as const) : ("school" as const),
        field,
        year: assessmentYear,
        quote,
        sourceId: source.id,
        sourceUrl: source.url,
        evidenceQuotes: [
          school.name,
          ...(discipline && !quote.includes(discipline.name)
            ? [discipline.name]
            : []),
        ].filter((q) => body.includes(q)),
        value,
        status: "bound" as const,
        verified: false as const,
      };
      facts.push({
        id: createHash("sha256")
          .update(JSON.stringify(fact))
          .digest("hex")
          .slice(0, 20),
        ...fact,
      });
    };
    // A national threshold is not the school's programme cutoff. Relative or predicted values are not facts.
    if (!/国家线|高于|预计|预测|左右|建议|本科|博士/.test(quote)) {
      const cutoff = quote.match(/复试(?:基本)?(?:分数)?线[：:为\s]*(\d{3})/);
      if (cutoff && /硕士|研究生|考研/.test(body))
        add("cutoff", { text: quote, number: +cutoff[1] });
    }
    const ratio = quote.match(/报录比[：:为\s]*(\d+(?:\.\d+)?)[：:比/]1/);
    if (
      ratio &&
      !/预测|预计|左右|约|拟招生|估计|参考值|[0-9]1?[-~～][0-9]/.test(quote)
    )
      add("applicationAdmissionRatio", { text: quote, number: +ratio[1] });
    if (
      !/不歧视|不限制|没有限制|友好|建议|例如|假设|网友|学长|经验贴|自述/.test(
        quote,
      ) &&
      /(?:录取|生源)[^。\n]*\d/.test(quote)
    ) {
      if (/双非|非双一流|普通本科/.test(quote))
        add("undergraduateAdmission", { text: quote });
      if (/跨考|跨专业/.test(quote))
        add("crossMajorAdmission", { text: quote });
    }
    if (
      /(?:硕士|研究生)[^。\n]{0,24}毕业生|毕业[^。\n]{0,12}(?:硕士|研究生)/.test(
        quote,
      ) &&
      !/本科|博士|定向|招聘|应当|预计|培养目标/.test(quote)
    ) {
      const rate = quote.match(
        /(?:就业率|去向落实率)[：:为\s]*(\d+(?:\.\d+)?)\s*[%％]/,
      );
      const destination = quote.match(
        /(?:就业去向|主要去向|就业单位|就业行业)[：:为\s]*([^。\n]+)/,
      );
      if ((rate && +rate[1] <= 100) || destination)
        add("employment", {
          text: quote,
          employmentRate: rate ? +rate[1] : undefined,
          destinations: destination?.[1],
        });
    }
    if (assessment && policy.tier === "authority" && discipline) {
      const grade = quote.match(
        /(?:评估(?:结果|等级)?[：:为\s]*|[|｜\s])([ABC](?:[+-])?)(?=$|[|｜\s，。])/,
      );
      if (grade && !/第五轮|预测|推测/.test(quote))
        add("disciplineAssessment", { text: quote, grade: grade[1] }, 2017);
    }
  }
  return facts;
}
