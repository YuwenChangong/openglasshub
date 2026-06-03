import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";

interface CircleManageEntryProps {
  circleSlug: string;
  ownerId: string | null;
}

export default function CircleManageEntry({ circleSlug, ownerId }: CircleManageEntryProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const authState = useBrowserAuthState(supabase);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    if (authState.status !== "signed_in" || !authState.user) {
      setRole(null);
      return;
    }

    let cancelled = false;
    supabase
      .from("profiles")
      .select("role")
      .eq("id", authState.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setRole(String(data?.role ?? ""));
      })
      .catch(() => {
        if (cancelled) return;
        setRole("");
      });

    return () => {
      cancelled = true;
    };
  }, [authState.status, authState.user, supabase]);

  if (authState.status !== "signed_in" || !authState.user) {
    return null;
  }

  const canManage = authState.user.id === ownerId || role === "moderator" || role === "admin";
  if (!canManage) {
    return null;
  }

  return (
    <a href={`/circles/${circleSlug}/manage/`} className="community-action-button community-action-button--muted">
      管理圈子
    </a>
  );
}
