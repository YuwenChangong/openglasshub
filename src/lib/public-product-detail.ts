import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublishedDeviceBySlug } from "./public-device-data";

export const detailSpecColumns = "id,key,group_key,label,value_type,admin_order,state,value_number,value_boolean,value_text,value_json,canonical_unit,measurement_context,region,variant,confidence,verified_at";
export const detailSourceColumns = "id,publisher,title,url,source_type,published_at,accessed_at,region";
export const detailEvidenceColumns = "spec_id,key,region,variant,source_id,claimed_value,is_primary,is_conflicting";

export type PublicDetailSpec = {
  id: string; key: string; group_key: string; label: string;
  value_type: "number" | "boolean" | "text" | "json"; admin_order: number;
  state: "KNOWN" | "NOT_DISCLOSED" | "NOT_APPLICABLE" | "CONFLICT";
  value_number: number | null; value_boolean: boolean | null;
  value_text: string | null; value_json: unknown;
  canonical_unit: string | null; measurement_context: string | null;
  region: string | null; variant: string | null;
  confidence: string; verified_at: string | null;
};
export type PublicDetailSource = {
  id: string; publisher: string; title: string | null; url: string;
  source_type: string; published_at: string | null; accessed_at: string; region: string | null;
};
export type PublicDetailEvidence = {
  spec_id: string; key: string; region: string | null; variant: string | null;
  source_id: string; claimed_value: string; is_primary: boolean; is_conflicting: boolean;
};

export type DetailParameterItem = {
  key: string; field: string; label: string; value: string | null;
  state: "KNOWN" | "NOT_DISCLOSED" | "NOT_APPLICABLE" | "CONFLICT";
  provenance: "LEGACY_UNVERIFIED" | "STRUCTURED_VERIFIED" | "UNKNOWN";
  region: string | null; variant: string | null; measurementContext: string | null;
  unit: string | null; verifiedAt: string | null;
};
type LegacyParameters = { specGroups: { key: string; label: string; items: { field: string; label: string; value: string }[] }[] };

export function buildDetailParameterGroups(product: LegacyParameters, specs: PublicDetailSpec[]) {
  const groups = new Map<string, { key: string; label: string; items: DetailParameterItem[] }>();
  const group = (key: string, label: string) => {
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    return groups.get(key)!;
  };
  for (const legacy of product.specGroups) group(legacy.key, legacy.label);
  const ordered = [...specs].sort((a, b) => a.admin_order - b.admin_order || a.key.localeCompare(b.key)
    || (a.region ?? "").localeCompare(b.region ?? "") || (a.variant ?? "").localeCompare(b.variant ?? ""));
  for (const spec of ordered) {
    if (!["KNOWN", "NOT_DISCLOSED", "NOT_APPLICABLE", "CONFLICT"].includes(spec.state)) throw new Error("Public product detail read failed.");
    const typed = spec.value_type === "number" ? spec.value_number : spec.value_type === "boolean" ? spec.value_boolean
      : spec.value_type === "text" ? spec.value_text : spec.value_json;
    if (spec.state === "KNOWN" && (typed === null || typed === undefined)) throw new Error("Public product detail read failed.");
    const value = typed === null || typed === undefined ? null : typeof typed === "boolean" ? (typed ? "Yes" : "No")
      : typeof typed === "object" ? JSON.stringify(typed) : String(typed);
    group(spec.group_key, spec.group_key).items.push({
      key: spec.key, field: spec.key.split(".").slice(1).join("."), label: spec.label, value,
      state: spec.state, provenance: value === null ? "UNKNOWN" : "STRUCTURED_VERIFIED",
      region: spec.region, variant: spec.variant, measurementContext: spec.measurement_context,
      unit: spec.canonical_unit, verifiedAt: spec.verified_at,
    });
  }
  // Legacy rows do not carry a verifiable region/measurement context. Keep
  // them explicitly attributed, even when a structured key/value matches.
  for (const legacy of product.specGroups) for (const item of legacy.items) {
    const state = item.value === "Not disclosed" ? "NOT_DISCLOSED" : item.value === "Not applicable" ? "NOT_APPLICABLE" : "KNOWN";
    group(legacy.key, legacy.label).items.push({ key: `${legacy.key}.${item.field}`, field: item.field, label: item.label,
      value: item.value, state, provenance: state === "KNOWN" ? "LEGACY_UNVERIFIED" : "UNKNOWN",
      region: null, variant: null, measurementContext: null, unit: null, verifiedAt: null });
  }
  return [...groups.values()].filter(item => item.items.length);
}

// Always pass the anonymous public SSR client, never a browser session or an
// administrative key. A missing projection is an outage, not absent facts.
export async function getPublicProductDetail(client: SupabaseClient, slug: string) {
  const product = await getPublishedDeviceBySlug(client, slug);
  if (!product) return null;
  async function rows<T>(table: string, columns: string): Promise<T[]> {
    const collected: T[] = [];
    const pageSize = 1000;
    let expected: number | undefined;
    for (let start = 0; ; ) {
      let query = client.from(table).select(columns, { count: "exact" })
        .eq("device_slug", slug).order(table === "public_device_detail_evidence" ? "spec_id" : "id");
      if (table === "public_device_detail_evidence") query = query.order("source_id").order("claimed_value");
      const { data, error, count } = await query.range(start, start + pageSize - 1);
      if (error || !Array.isArray(data) || count === null || count === undefined || count < 0
        || (expected !== undefined && count !== expected)) throw new Error("Public product detail read failed.");
      expected = count;
      collected.push(...data as T[]);
      if (collected.length === count) return collected;
      if (!data.length || collected.length > count) throw new Error("Public product detail read failed.");
      start += data.length;
    }
  }
  const specs = await rows<PublicDetailSpec>("public_device_detail_specs", detailSpecColumns);
  const sources = await rows<PublicDetailSource>("public_device_detail_sources", detailSourceColumns);
  const evidence = await rows<PublicDetailEvidence>("public_device_detail_evidence", detailEvidenceColumns);
  return { product, specs, sources, evidence };
}
