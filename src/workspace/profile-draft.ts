import type { Profile } from "../types";
export const profileDraftKey = (accountId: string) =>
  `yantu-profile-draft-v1:${accountId}`;
export interface ProfileDraft {
  schemaVersion: 1;
  profile: Profile;
  baseEtag: string;
}
export function readProfileDraft(accountId: string): ProfileDraft | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(profileDraftKey(accountId)) ?? "null",
    );
    if (
      value?.schemaVersion !== 1 ||
      typeof value.baseEtag !== "string" ||
      !value.profile ||
      !Array.isArray(value.profile.cities) ||
      !value.profile.priorities ||
      typeof value.profile.major !== "string"
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function clearProfileDraft(accountId: string) {
  localStorage.removeItem(profileDraftKey(accountId));
}
