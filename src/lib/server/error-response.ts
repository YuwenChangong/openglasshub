/**
 * Converts unexpected provider/database failures into stable public API codes.
 * Detailed errors belong in server-side observability, never HTTP responses.
 */
export function sanitizeApiError(_error: unknown, fallback: string): string {
  return fallback;
}
