import { isKnownCountry } from "./country-codes.ts";

export function getTrustedCountry(request: Request): string | undefined {
  const country = (request as Request & { cf?: { country?: unknown } }).cf?.country;
  return isKnownCountry(country) ? country : undefined;
}
