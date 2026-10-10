import { schoolRegistry } from "../schools/index.ts";
import { normalizeDiscoveryCity } from "./research-candidates.ts";

export interface ResearchSchoolPreferences {
  cities?: readonly string[];
  selectedSchool?: string;
  schoolHints?: readonly string[];
}

/** Registry geography orders investigation only; it never binds a programme location. */
export function researchSchoolPriorities(
  preferences: ResearchSchoolPreferences = {},
) {
  const cities = [
    ...new Set((preferences.cities ?? []).map(normalizeDiscoveryCity)),
  ].filter(
    (city) => city.length >= 2 && !/^(?:不确定|不限|无偏好|未确定)$/.test(city),
  );
  const citySchools = [
    ...new Set(
      cities.flatMap((city) =>
        schoolRegistry.byCity(city).map(({ school }) => school.name),
      ),
    ),
  ];
  const matched = new Set(citySchools);
  const hints = new Set(preferences.schoolHints ?? []);
  const selected =
    preferences.selectedSchool &&
    (schoolRegistry.byName(preferences.selectedSchool)?.name ??
      preferences.selectedSchool);
  const active = cities.length > 0;
  return {
    active,
    citySchools,
    priority(name: string | undefined) {
      if (!active || !name) return 3;
      const canonical = schoolRegistry.byName(name)?.name ?? name;
      return canonical === selected
        ? 0
        : matched.has(canonical)
          ? 1
          : hints.has(name) || hints.has(canonical)
            ? 2
            : 3;
    },
  };
}
