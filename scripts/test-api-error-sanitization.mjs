import { sanitizeApiError } from "../src/lib/server/error-response.ts";

const rawProviderError = "permission denied for relation profiles; jwt=eyJhbGciOiJIUzI1NiJ9.payload.signature";
const result = sanitizeApiError(rawProviderError, "PROFILE_UPDATE_FAILED");

if (result !== "PROFILE_UPDATE_FAILED") {
  throw new Error(`Expected stable public error code, received: ${result}`);
}

console.log("API_ERROR_SANITIZATION_OK");
