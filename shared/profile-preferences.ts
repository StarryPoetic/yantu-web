/** Preference clauses only: a negative clause cannot become an affirmative interest. */
export function preferenceClauses(value: unknown) {
  return typeof value === "string"
    ? value
        .split(/[，,。；;！？!?\n]|但是|不过|而是|但/)
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}
export function isNegativePreference(value: string) {
  return (
    !isAmbiguousPreference(value) &&
    /不想|不考虑|不喜欢|不愿|不要|拒绝|排除|无意|不打算|没有兴趣|不感兴趣/.test(
      value,
    )
  );
}
/** Open or double-negative wording cannot silently become a hard exclusion or preference. */
export function isAmbiguousPreference(value: string) {
  return /(?:并非|并不是|不是|没有说|不表示|不代表|并不意味着|不意味着)\s*(?:只考虑|仅考虑|不(?:想|考虑|喜欢|愿|要|打算))|不排除|不拒绝/.test(
    value,
  );
}
export function affirmativePreference(value: unknown) {
  return preferenceClauses(value)
    .filter(
      (part) => !isNegativePreference(part) && !isAmbiguousPreference(part),
    )
    .join("；");
}

/** Only clear restrictions filter the catalogue; conflicting/ambiguous clauses keep comparison open. */
export function explicitDegreeConstraint(
  ...values: unknown[]
): "academic" | "professional" | null {
  const wanted = new Set<"academic" | "professional">();
  for (const clause of values.flatMap(preferenceClauses)) {
    if (isAmbiguousPreference(clause)) continue;
    for (const [degree, label] of [
      ["academic", "(?:学硕|学术(?:学位|型))"],
      ["professional", "(?:专硕|专业(?:学位|型))"],
    ] as const) {
      // A negative word elsewhere in a note (e.g. 不考虑放弃学硕) is not a degree exclusion.
      if (
        new RegExp(
          `(?:不想|不考虑|不接受|不愿意?|不要|拒绝|排除|不打算|不选择|不报)\\s*(?:报考|申请|攻读|读|报)?\\s*${label}`,
        ).test(clause)
      )
        wanted.add(degree === "academic" ? "professional" : "academic");
      else if (
        new RegExp(
          `(?:(?:只|仅)(?:想|要|考虑|选择|接受)|只报|仅报)\\s*(?:报考|申请|攻读|读|报)?\\s*${label}`,
        ).test(clause)
      )
        wanted.add(degree);
    }
  }
  return wanted.size === 1 ? [...wanted][0] : null;
}
