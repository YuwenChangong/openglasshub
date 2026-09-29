const RECOVERY_PATH = "/auth/reset-password/";

export function createRecoveryEventBuffer() {
  let pending = false;
  return {
    observe(event: string, hasSession: boolean, pathname: string): void {
      if (event === "PASSWORD_RECOVERY" && hasSession && pathname === RECOVERY_PATH) pending = true;
      else if (event === "SIGNED_OUT" || event === "SIGNED_IN") pending = false;
    },
    consume(pathname: string): boolean {
      const observed = pending && pathname === RECOVERY_PATH;
      pending = false;
      return observed;
    },
  };
}
