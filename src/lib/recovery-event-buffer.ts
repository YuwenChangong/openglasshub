const RECOVERY_PATH = "/auth/reset-password/";

export function createRecoveryEventBuffer(now = Date.now) {
  let expiresAt: number | null = null;
  let closed = false;
  return {
    observe(event: string, hasSession: boolean, pathname: string): void {
      if (!closed && event === "PASSWORD_RECOVERY" && hasSession && pathname === RECOVERY_PATH) expiresAt = now() + 2800;
      else if (event === "SIGNED_OUT" || event === "SIGNED_IN") expiresAt = null;
    },
    consume(pathname: string): boolean {
      const observed = !closed && expiresAt !== null && now() < expiresAt && pathname === RECOVERY_PATH;
      expiresAt = null;
      return observed;
    },
    invalidate(): void {
      // SDK events have no attempt id. A closed attempt cannot accept later events.
      closed = true;
      expiresAt = null;
    },
  };
}
