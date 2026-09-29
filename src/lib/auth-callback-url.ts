const CALLBACK_PARAMS = ["code", "sb_flow_id", "error", "error_code", "error_description"] as const;

export function hasAuthCallbackError(url: URL): boolean {
  const fragment = new URLSearchParams(url.hash.slice(1));
  return ["error", "error_code", "error_description"].some((key) => url.searchParams.has(key) || fragment.has(key));
}

export function clearAuthCallbackUrl(): boolean {
  try {
    const url = new URL(window.location.href);
    for (const key of CALLBACK_PARAMS) url.searchParams.delete(key);
    url.hash = "";
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
    return true;
  } catch {
    return false;
  }
}
