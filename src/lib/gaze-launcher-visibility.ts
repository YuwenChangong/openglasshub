export const GAZE_LAUNCHER_PUBLIC_ENABLED = false;

// The optional argument exists only for offline tests. Production consumers use
// the immutable default above, never request or client-controlled state.
export function isGazeLauncherPublicEnabled(
  value: boolean = GAZE_LAUNCHER_PUBLIC_ENABLED,
): boolean {
  return value === true;
}

export function isGazeLauncherSitemapEntryIncluded(
  page: string,
  value: boolean = GAZE_LAUNCHER_PUBLIC_ENABLED,
): boolean {
  const pathname = new URL(page, "https://openglasshub.pages.dev").pathname;
  return pathname !== "/gaze-launcher/" && pathname !== "/gaze-launcher"
    ? true
    : isGazeLauncherPublicEnabled(value);
}
