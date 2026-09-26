import { fields, HttpError, integer, object, text } from "./http.ts";
import type { Profile } from "../shared/profile.ts";

export const priorities = [
  "专业兴趣",
  "就业机会",
  "发展前景",
  "政策支持",
  "学校与城市",
  "招生透明度",
  "风险接受度",
] as const;
export const blankProfile = (): Profile => ({
  name: "",
  university: "",
  major: "",
  graduation: "",
  year: "2027",
  english: "",
  math: "",
  hours: "",
  budget: "",
  cities: [],
  crossMajor: "",
  priorities: Object.fromEntries(priorities.map((name) => [name, 50])),
});
export function validateProfile(input: unknown): Profile {
  const body = object(input);
  const strings = [
    "name",
    "university",
    "major",
    "graduation",
    "year",
    "english",
    "math",
    "hours",
    "budget",
    "crossMajor",
    "preparation",
    "courses",
    "notes",
    "targetMajor",
    "studyGoal",
    "degreePreference",
  ];
  fields(body, [...strings, "cities", "priorities"]);
  const result = blankProfile();
  for (const field of strings)
    if (field in body)
      (result as unknown as Record<string, unknown>)[field] = text(
        body[field],
        field,
        field === "notes" || field === "courses" ? 3000 : 200,
      );
  if (!/^20\d{2}$/.test(result.year))
    throw new HttpError(422, "invalid_year", "请选择有效的招生年份。");
  if (!Array.isArray(body.cities) || body.cities.length > 30)
    throw new HttpError(422, "invalid_cities", "意向城市最多 30 个。");
  result.cities = [
    ...new Set(body.cities.map((city) => text(city, "城市", 100, true))),
  ];
  if (result.cities.includes("不确定") && result.cities.length > 1)
    throw new HttpError(422, "city_conflict", "不确定不能与具体城市同时选择。");
  const weights = object(body.priorities);
  fields(weights, priorities);
  for (const name of priorities)
    result.priorities[name] = integer(weights[name], name, 0, 100);
  return result;
}
export interface Selections {
  selectionVersion: number;
  confirmedMajorId: string | null;
  savedProgramIds: string[];
  exclusions: {
    scope: "institution" | "majorDirection" | "program";
    objectId: string;
    reason?: string;
  }[];
  targetProgramId: string | null;
}
export const blankSelections = (): Selections => ({
  selectionVersion: 0,
  confirmedMajorId: null,
  savedProgramIds: [],
  exclusions: [],
  targetProgramId: null,
});
