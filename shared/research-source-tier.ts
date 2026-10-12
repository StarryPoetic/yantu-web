/** Source trust is assigned by server policy, never by a model or page claim. */
export type ResearchSourceTier = "school" | "authority" | "reference";
export const RESEARCH_SOURCE_LABELS: Record<ResearchSourceTier, string> = {
  school: "学校官方",
  authority: "权威官方",
  reference: "非官方，仅供参考",
};
