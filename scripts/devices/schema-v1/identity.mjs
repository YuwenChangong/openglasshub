const RAY_BAN = {
  yamlBrand: "Ray-Ban / Meta",
  yamlModel: "Ray-Ban Meta",
  yamlGeneration: "Gen 2",
};

const RAY_BAN_INDETERMINATE_DETAIL = "CURRENT_RAY_BAN_BOOTSTRAP_SLUG=ray-ban-meta; CURRENT_RAY_BAN_BOOTSTRAP_GENERATION=UNSPECIFIED; CURRENT_RAY_BAN_BOOTSTRAP_IDENTITY_CONFIDENCE=INSUFFICIENT_FOR_GEN_2";

function normalizedText(value) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError("Identity values must be nonempty strings");
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function identityOf(value) {
  const basic = value.basic ?? value;
  return {
    yamlBrand: basic.brand ?? basic.yamlBrand,
    yamlModel: basic.model ?? basic.yamlModel,
    yamlGeneration: basic.generation ?? basic.yamlGeneration,
  };
}

function identityKey(value) {
  const identity = identityOf(value);
  return [identity.yamlBrand, identity.yamlModel, identity.yamlGeneration].map(normalizedText).join("\u0000");
}

function sameIdentity(left, right) {
  return identityKey(left) === identityKey(right);
}

function sameBrandAndModel(left, right) {
  const leftIdentity = identityOf(left);
  const rightIdentity = identityOf(right);
  return normalizedText(leftIdentity.yamlBrand) === normalizedText(rightIdentity.yamlBrand)
    && normalizedText(leftIdentity.yamlModel) === normalizedText(rightIdentity.yamlModel);
}

function blocker(identity, code, detail) {
  return { ...identity, blocker: { code, detail } };
}

/**
 * Resolve each approved YAML identity only through the reviewed map. Casing and
 * whitespace are normalized; model, brand, generation, and slug are never
 * inferred from similar text.
 *
 * @param {{ yamlDevices: unknown[], bootstrapRows: { slug: string }[], mappings: { yamlBrand: string, yamlModel: string, yamlGeneration: string, slug: string }[] }} input
 * @returns {import("./types.mjs").IdentityMapping[]}
 */
export function resolveIdentityMappings({ yamlDevices, bootstrapRows, mappings }) {
  if (!Array.isArray(yamlDevices) || !Array.isArray(bootstrapRows) || !Array.isArray(mappings)) {
    throw new TypeError("yamlDevices, bootstrapRows, and mappings must be arrays");
  }

  const yamlIdentities = yamlDevices.map(identityOf);
  for (const mapping of mappings) {
    if (!yamlIdentities.some((identity) => sameIdentity(identity, mapping))
      && !yamlIdentities.some((identity) => sameBrandAndModel(identity, mapping))) {
      throw new TypeError("Reviewed identity map contains an unmapped identity");
    }
  }
  const mappingsByIdentity = new Map();
  for (const mapping of mappings) {
    const key = identityKey(mapping);
    const mapped = mappingsByIdentity.get(key) ?? [];
    mapped.push(mapping);
    mappingsByIdentity.set(key, mapped);
  }

  const duplicateTargetSlugs = new Set();
  const targetOwners = new Map();
  for (const mapping of mappings) {
    const slug = normalizedText(mapping.slug);
    if (targetOwners.has(slug)) duplicateTargetSlugs.add(slug);
    targetOwners.set(slug, true);
  }

  return yamlIdentities.map((identity) => {
    if (sameIdentity(identity, RAY_BAN)) {
      const explicitGenerations = bootstrapRows
        .filter((row) => row?.slug === "ray-ban-meta" && typeof row.generation === "string")
        .map((row) => normalizedText(row.generation));
      if (explicitGenerations.some((generation) => generation === "generic" || generation === "gen 1")) {
        return blocker(identity, "BLOCKED_IDENTITY_MISMATCH", "ray-ban-meta is explicitly generic or Gen 1 and must never be updated as Gen 2");
      }
      return blocker(identity, "RAY_BAN_IDENTITY_INDETERMINATE", RAY_BAN_INDETERMINATE_DETAIL);
    }
    const candidates = mappingsByIdentity.get(identityKey(identity)) ?? [];
    if (candidates.length !== 1) {
      return blocker(identity, "BLOCKED_IDENTITY_MISMATCH", "Each YAML brand/model/generation must have exactly one reviewed mapping");
    }
    const mapping = candidates[0];
    const slugKey = normalizedText(mapping.slug);
    if (duplicateTargetSlugs.has(slugKey)) {
      return { ...blocker(identity, "BLOCKED_DUPLICATE_TARGET_SLUG", `Reviewed target slug is shared: ${mapping.slug}`), slug: mapping.slug };
    }
    const targets = bootstrapRows.filter((row) => row?.slug === mapping.slug);
    if (targets.length === 0) {
      return { ...blocker(identity, "BLOCKED_IDENTITY_NOT_FOUND", `Reviewed target slug is absent from bootstrap: ${mapping.slug}`), slug: mapping.slug };
    }
    if (targets.length > 1) {
      return { ...blocker(identity, "BLOCKED_IDENTITY_MULTIPLE_MATCHES", `Reviewed target slug has ${targets.length} bootstrap rows: ${mapping.slug}`), slug: mapping.slug };
    }
    return { ...identity, slug: mapping.slug };
  });
}
