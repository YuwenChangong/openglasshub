import type { User } from "@supabase/supabase-js";
import type { UserSummarySuccess } from "./user-summary";

type Profile = UserSummarySuccess["profile"];

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = [...value.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, "").trim()].slice(0, 48).join("");
  return cleaned || null;
}

function safeEmailLocalPart(email: string | undefined): string | null {
  if (!email || email.indexOf("@") < 1) return null;
  const local = email.slice(0, email.indexOf("@"));
  if (!local || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(local)) return null;
  if (!/^[\p{L}\p{N}._+-]+$/u.test(local)) return null;
  if (/^(?:www\.)|(?:token|secret|bearer|api[_-]?key|password|eyJ)/i.test(local)) return null;
  if (/^[A-Za-z0-9_-]{24,}$/.test(local)) return null;
  return cleanLabel(local);
}

export function buildHeaderIdentity(input: {
  user: User;
  profile: Profile | null;
  locale: "zh-CN" | "en";
}): { label: string; initial: string; avatarUrl: string | null } {
  const { user, profile, locale } = input;
  const safeId = cleanLabel(user.id);
  const shortenedId = safeId ? (safeId.length <= 12 ? safeId : `${safeId.slice(0, 6)}…${safeId.slice(-4)}`) : null;
  const label = cleanLabel(profile?.display_name)
    ?? cleanLabel(profile?.username)
    ?? cleanLabel(user.user_metadata?.display_name)
    ?? safeEmailLocalPart(user.email)
    ?? shortenedId
    ?? (locale === "en" ? "Account" : "用户");
  const avatarPath = safeId ? `/api/media/profile/${encodeURIComponent(safeId)}/avatar` : null;
  const avatarUrl = profile?.id === user.id && profile.avatar_resolved_url === avatarPath ? avatarPath : null;
  return { label, initial: [...label][0]?.toLocaleUpperCase() ?? "U", avatarUrl };
}
