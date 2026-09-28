import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { User } from "@supabase/supabase-js";
import type { UserSummarySuccess } from "../../../src/lib/user-summary";
import HeaderUserMenu from "../../../src/components/site/HeaderUserMenu";
import "../../../src/styles/community.css";

const previous = { id: "00000000-0000-4000-8000-000000000001", email: "qa@example.test", user_metadata: {}, app_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" } as User;
const current = { ...previous, id: "00000000-0000-4000-8000-000000000002", email: "next@example.test" } as User;
const pending = new Map<string, (value: UserSummarySuccess) => void>();
let resolveSlowToken: ((value: string) => void) | null = null;
let observedAborts = 0;

function summary(user: User, name: string, avatar = false, posts: number | null = null): UserSummarySuccess {
  return {
    ok: true,
    profile: { id: user.id, username: null, display_name: name, profile_href: `/users/${user.id}/`, avatar_resolved_url: avatar ? `/api/media/profile/${user.id}/avatar` : null },
    stats: { post_count: posts, received_like_count: posts },
    availability: { avatar: avatar ? "ready" : "unavailable", posts: posts === null ? "unavailable" : "ready", commentLikes: posts === null ? "unavailable" : "ready" },
  };
}

function Harness() {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState("pending");
  const [refresh, setRefresh] = useState(0);
  const adapter = useMemo(() => ({
    state: { viewState: user ? "signed_in" as const : "signed_out" as const, user },
    getAccessToken: () => mode === "slow-token" ? new Promise<string>((resolve) => { resolveSlowToken = resolve; }) : Promise.resolve("local-fixture"),
    loadSummary: (_token: string, signal: AbortSignal) => {
      signal.addEventListener("abort", () => { observedAborts += 1; Object.assign(window, { __headerAbortCount: observedAborts }); }, { once: true });
      if (["reject", "401", "404", "500"].includes(mode)) return Promise.reject(new Error(mode));
      if (mode === "success") return Promise.resolve(summary(user!, "Current actor", false, 0));
      if (mode === "broken-avatar") return Promise.resolve(summary(user!, "Current actor", true));
      return new Promise<UserSummarySuccess>((resolve) => pending.set(user!.id, resolve));
    },
  }), [user, mode, refresh]);
  return <>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: 20 }}>
      <strong>OpenGlass Hub</strong><HeaderUserMenu identityAdapter={adapter} />
    </header>
    <main style={{ padding: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button onClick={() => { setMode("pending"); setUser(previous); }}>Sign in with pending summary</button>
      <button onClick={() => setUser(current)}>Switch actor</button>
      <button onClick={() => pending.get(previous.id)?.(summary(previous, "Previous actor", false, 9))}>Resolve previous summary</button>
      <button onClick={() => pending.get(current.id)?.(summary(current, "Current actor", false, 4))}>Resolve current summary</button>
      <button onClick={() => { setMode("slow-token"); setUser(previous); }}>Sign in with slow token</button>
      <button onClick={() => resolveSlowToken?.("local-fixture")}>Resolve slow token</button>
      <button onClick={() => { setMode("broken-avatar"); setUser(previous); }}>Sign in with broken avatar</button>
      <button onClick={() => { setMode("success"); setUser(previous); }}>Sign in with summary</button>
      {(["401", "404", "500", "reject"] as const).map((failure) => <button key={failure} onClick={() => { setMode(failure); setUser(previous); }}>Sign in with {failure}</button>)}
      <button onClick={() => setUser(null)}>Log out</button>
      <button onClick={() => setRefresh((n) => n + 1)}>Refresh</button>
      <output data-testid="observed-aborts">{observedAborts}</output>
    </main>
  </>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
