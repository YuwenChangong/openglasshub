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
      if (table === "public_device_detail_evidence") query = query.order("source_id");
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
