function parseArgs(argv) {
  const options = {
    productionUrl: null,
    targetUrl: null,
    linkedRef: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] ?? "");
    if (value === "--production-url") {
      options.productionUrl = String(argv[index + 1] ?? "").trim() || null;
      index += 1;
    } else if (value === "--target-url") {
      options.targetUrl = String(argv[index + 1] ?? "").trim() || null;
      index += 1;
    } else if (value === "--linked-ref") {
      options.linkedRef = String(argv[index + 1] ?? "").trim() || null;
      index += 1;
    }
  }

  return options;
}

function hostFromUrl(value) {
  try {
    return new URL(String(value ?? "").trim()).host || null;
  } catch {
    return null;
  }
}

function refFromUrl(value) {
  const host = hostFromUrl(value);
  if (!host) return null;
  const [ref] = host.split(".");
  return ref || null;
}

function resolveInputs(options) {
  const productionUrl =
    options.productionUrl ??
    process.env.PRODUCTION_SUPABASE_URL ??
    process.env.PUBLIC_PRODUCTION_SUPABASE_URL ??
    process.env.PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    null;

  const targetUrl =
    options.targetUrl ??
    process.env.PREVIEW_SUPABASE_URL ??
    process.env.QA_SUPABASE_URL ??
    process.env.TARGET_SUPABASE_URL ??
    null;

  const linkedRef =
    options.linkedRef ??
    process.env.SUPABASE_LINKED_PROJECT_REF ??
    null;

  return {
    productionUrl,
    targetUrl,
    productionRef: refFromUrl(productionUrl),
    targetRef: refFromUrl(targetUrl),
    linkedRef,
  };
}

function fail(message, context) {
  console.error(message);
  if (context) {
    console.error(JSON.stringify(context, null, 2));
  }
  process.exitCode = 1;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputs = resolveInputs(options);

  if (!inputs.productionRef) {
    fail("PREVIEW_SUPABASE_GUARD_FAILED: missing production Supabase ref", {
      productionHost: hostFromUrl(inputs.productionUrl),
      targetHost: hostFromUrl(inputs.targetUrl),
      linkedRef: inputs.linkedRef,
    });
    return;
  }

  if (!inputs.targetRef) {
    fail("PREVIEW_SUPABASE_GUARD_FAILED: missing target Supabase ref", {
      productionRef: inputs.productionRef,
      productionHost: hostFromUrl(inputs.productionUrl),
      linkedRef: inputs.linkedRef,
    });
    return;
  }

  if (inputs.targetRef === inputs.productionRef) {
    fail("PREVIEW_SUPABASE_GUARD_FAILED: target ref matches production ref", {
      productionRef: inputs.productionRef,
      targetRef: inputs.targetRef,
      linkedRef: inputs.linkedRef,
    });
    return;
  }

  if (inputs.linkedRef && inputs.linkedRef === inputs.productionRef) {
    fail("PREVIEW_SUPABASE_GUARD_FAILED: linked CLI ref still matches production ref", {
      productionRef: inputs.productionRef,
      targetRef: inputs.targetRef,
      linkedRef: inputs.linkedRef,
    });
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    productionRef: inputs.productionRef,
    targetRef: inputs.targetRef,
    linkedRef: inputs.linkedRef,
  }, null, 2));
}

main();
