import { CITY_OPTIONS, normalizeCityName } from "../../shared/cities.ts";
import { ModelError } from "./deepseek.ts";

type CityStatus = "match" | "mismatch" | "unknown";
type RankedRecommendation = {
  tier: "preferred" | "alternative" | "exploratory";
  constraintChecks?: readonly { field: string; status: string }[];
};
const tierOrder = { preferred: 0, alternative: 1, exploratory: 2 };

/** City preference breaks ties within the holistic tier, retaining the caller's order otherwise. */
export function sortCityRecommendations<T extends RankedRecommendation>(
  items: T[],
): T[] {
  const match = (item: T) =>
    item.constraintChecks?.some(
      (check) => check.field === "cities" && check.status === "match",
    )
      ? 0
      : 1;
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        tierOrder[a.item.tier] - tierOrder[b.item.tier] ||
        match(a.item) - match(b.item) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cityNames = [...new Set(CITY_OPTIONS.map(({ name }) => name))].sort(
  (a, b) => b.length - a.length,
);
const cityMention = new RegExp(
  `(${cityNames.map(escaped).join("|")})(?:市)?(?=区位|城市|地区|地域|符合|满足|贴合|契合|匹配|是|的|[，,、。；;\s]|$)`,
  "g",
);
const negative = (prefix: string) =>
  /(?:不(?:完全|能|够)?|未(?:能|经|完全)?|无法|不能认定|并非|尚未|不应认为)\s*$/.test(
    prefix,
  );
const conditional = (sentence: string) =>
  /(?:如果|只有|若|需(?:要)?|须|有待|是否|能否|待)[^。；;]{0,25}(?:放宽|调整|确认|接受|愿意|通勤)|(?:放宽|调整)[^。；;]{0,20}(?:之后|后|才能|才可|可再)/.test(
    sentence,
  );

const changedCityCondition = (prefix: string) =>
  /(?:如果|只有|若|在|需(?:要)?|须)[^，,。；;]{0,20}(?:放宽|调整|改变)[^，,。；;]{0,20}(?:城市|地域|地区)(?:偏好|意向|要求|目标|条件)[^。；;]{0,35}$/.test(
    prefix,
  );

function localClaimPrefix(sentence: string, index: number) {
  const before = sentence.slice(0, index);
  return before.slice(
    Math.max(before.lastIndexOf("，"), before.lastIndexOf(",")) + 1,
  );
}

function acceptsCommute(profile: Record<string, unknown>) {
  const notes = typeof profile.notes === "string" ? profile.notes : "";
  const willingness =
    /(?:愿意|接受|可以|能够|可)[^。；;\n]{0,10}(?:跨城|跨市|异地)?通勤|(?:跨城|跨市|异地)?通勤[^。；;\n]{0,8}(?:可接受|可以接受|愿意)/g;
  return notes
    .split(/[。；;\n]/)
    .some((sentence) =>
      [...sentence.matchAll(willingness)].some(
        (match) =>
          !/不|不能|无法|尚未/.test(match[0]) &&
          !negative(
            sentence.slice(Math.max(0, match.index! - 10), match.index),
          ) &&
          !conditional(sentence),
      ),
    );
}

/** Prevent advice from silently replacing a saved city preference or inventing commute consent. */
export function validateCityPreferenceClaim(
  prose: string,
  profile: Record<string, unknown>,
  cityStatus?: CityStatus,
): void {
  const preferred = new Set(
    Array.isArray(profile.cities)
      ? profile.cities
          .filter(
            (city): city is string =>
              typeof city === "string" &&
              !!city.trim() &&
              !/^(?:全国|不确定|不限(?:城市)?|无偏好|未确定)$/.test(
                city.trim(),
              ),
          )
          .map(normalizeCityName)
      : [],
  );
  if (!preferred.size) return;
  for (const sentence of prose.split(/[。；;！？!?\n]/).filter(Boolean)) {
    const commute =
      /通勤(?:成本)?(?:可接受|可以接受|能够接受|可行)|(?:本人|用户|你)[^。；;]{0,10}(?:接受|愿意)[^。；;]{0,10}(?:跨城|跨市|异地|通勤)/g;
    if (
      !acceptsCommute(profile) &&
      [...sentence.matchAll(commute)].some(
        (match) =>
          !conditional(localClaimPrefix(sentence, match.index!) + match[0]) &&
          !negative(
            sentence.slice(Math.max(0, match.index! - 12), match.index),
          ),
      )
    )
      throw new ModelError("UNSUPPORTED_RESEARCH_CLAIM");
    const claims =
      /(?:符合|满足|契合|贴合|匹配)[^，,。；;]{0,16}(?:城市|地域|地区|区位)(?:偏好|意向|要求|目标|条件)|(?:城市|地域|地区|区位)[^，,。；;]{0,12}(?:符合|满足|契合|贴合|匹配)[^，,。；;]{0,8}(?:偏好|意向|要求|目标|条件)|(?:城市|地域|地区|区位)(?:偏好|意向|要求|目标|条件)[^，,。；;]{0,8}(?:相符|一致)/g;
    for (const claim of sentence.matchAll(claims)) {
      if (
        /是否|能否|有待|尚待|待核验|需核验|需确认/.test(claim[0]) ||
        /(?:不(?:完全|能|够)?|未(?:能|经|完全)?|无法|并非|尚未)(?:符合|满足|契合|贴合|匹配|相符|一致)/.test(
          claim[0],
        ) ||
        /(?:是否|能否|(?:待|需)(?:确认|核验)(?:是否)?)\s*$/.test(
          sentence.slice(Math.max(0, claim.index! - 12), claim.index),
        )
      )
        continue;
      if (negative(sentence.slice(Math.max(0, claim.index! - 10), claim.index)))
        continue;
      // Only an earlier explicit change to the saved city preference can make
      // this geographic assertion conditional. A later commute question cannot.
      if (changedCityCondition(sentence.slice(0, claim.index))) continue;
      const preceding = sentence.slice(
        Math.max(0, claim.index! - 45),
        claim.index,
      );
      const mentioned =
        [...preceding.matchAll(cityMention)].at(-1)?.[1] ??
        [...claim[0].matchAll(cityMention)].at(-1)?.[1];
      if (
        (mentioned && !preferred.has(normalizeCityName(mentioned))) ||
        (cityStatus !== undefined && cityStatus !== "match")
      )
        throw new ModelError("UNSUPPORTED_RESEARCH_CLAIM");
    }
  }
}
