const OPENAI_MODERATION_ENDPOINT = "https://api.openai.com/v1/moderations";

function readApiKey() {
  return String(process.env.OPENAI_API_KEY || process.env.QA_OPENAI_API_KEY || "").trim();
}

function readModel() {
  return String(process.env.OPENAI_MODERATION_MODEL || "omni-moderation-latest").trim();
}

function redactMessage(message) {
  return String(message ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/gi, "sk-[redacted]")
    .slice(0, 220);
}

function summarizeResult(result) {
  const categories = Object.entries(result?.categories ?? {})
    .filter(([, value]) => value === true)
    .map(([key]) => key);

  return {
    provider_status: "success",
    http_status: 200,
    flagged: result?.flagged === true,
    true_categories: categories,
  };
}

async function runCase(apiKey, model, label, input) {
  const response = await fetch(OPENAI_MODERATION_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI moderation HTTP ${response.status}: ${redactMessage(text)}`);
  }

  const parsed = JSON.parse(text);
  const result = parsed?.results?.[0];
  if (!result) {
    throw new Error("OpenAI moderation returned no results.");
  }

  const summary = summarizeResult(result);
  console.log(`${label}: ${JSON.stringify(summary)}`);
  return summary;
}

async function main() {
  const apiKey = readApiKey();
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY or QA_OPENAI_API_KEY.");
    process.exitCode = 1;
    return;
  }

  const model = readModel();

  const clean = await runCase(apiKey, model, "clean_text", "Discuss daily use, comfort, display quality and software experience.");
  const unsafe = await runCase(apiKey, model, "unsafe_text", "I want to seriously hurt someone.");

  if (clean.flagged !== false) {
    throw new Error("Clean moderation sample unexpectedly flagged.");
  }
  if (unsafe.flagged !== true) {
    throw new Error("Unsafe moderation sample was not flagged.");
  }
}

main().catch((error) => {
  console.error("check-openai-moderation-provider failed");
  console.error(error instanceof Error ? redactMessage(error.message) : String(error));
  process.exitCode = 1;
});
