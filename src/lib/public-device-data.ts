import type { SupabaseClient } from "@supabase/supabase-js";

export const publicDeviceColumns = "slug,brand_key,brand_name,name,short_description,long_description,positioning,release_year,availability,type_label,status_label,media,product_image_url,official_image_url,image_alt,product_url,official_product_url,buy_url,category,route_label,route_description,best_for,not_ideal_for,key_limitations,key_specs,full_specs";

type JsonRecord = Record<string, unknown>;
type PublicRow = JsonRecord & { slug: string; brand_key: string; brand_name: string; name: string; short_description: string; long_description: string };

const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const specText = (value: unknown): string | null => typeof value === "string" ? text(value)
  : typeof value === "number" && Number.isFinite(value) ? String(value)
  : typeof value === "boolean" ? String(value) : null;

function specGroups(value: unknown) {
  return Object.entries(record(value)).flatMap(([key, group]) => {
    const items = Object.entries(record(group)).flatMap(([field, candidate]) => {
      const value = specText(candidate);
      return value ? [{ field, label: field, value }] : [];
    });
    return items.length ? [{ key, label: key, items }] : [];
  });
}

type DeviceSpecs = { specGroups?: ReturnType<typeof specGroups> };
const canonicalUiSpecs: Record<string, { paths: readonly string[]; unit?: string }> = {
  display_type: { paths: ["display.display_technology"] },
  resolution: { paths: ["display.resolution_per_eye"], unit: "(per eye)" },
  weight: { paths: ["basic.weight_g"], unit: "g" },
  field_of_view: { paths: ["display.fov_deg"], unit: "deg" },
  refresh_rate_hz: { paths: ["display.refresh_rate_hz"], unit: "Hz" },
  eye_brightness_nits: { paths: ["display.eye_brightness"], unit: "nits" },
  panel_or_projector_brightness_nits: { paths: ["display.panel_or_projector_brightness"], unit: "nits" },
  chipset: { paths: ["compute.soc"] },
  camera: { paths: ["camera.camera_sensor", "camera.camera_mp", "camera.camera_present"] },
  battery_life: { paths: ["power.typical_runtime", "battery.official_typical_runtime"] },
};

export function getPublicDeviceSpecValue(product: DeviceSpecs, field: string): string | null {
  const mapping = canonicalUiSpecs[field];
  for (const path of mapping?.paths ?? []) {
    const [groupKey, specField] = path.split(".");
    const value = product.specGroups?.find((group) => group.key === groupKey)?.items.find((item) => item.field === specField)?.value;
    if (!value) continue;
    if (/^(?:Not disclosed|Not applicable|No|TBD)$/i.test(value.trim())) return value;
    const unit = path === "camera.camera_mp" ? "MP" : mapping.unit;
    if (!unit) return value;
    const hasUnit = unit === "g" ? /\b(?:g|grams?)\b/i.test(value)
      : unit === "deg" ? /\u00b0|\bdeg(?:rees)?\b/i.test(value)
      : unit === "(per eye)" ? /per[ -]eye/i.test(value)
      : new RegExp(`\\b${unit}\\b`, "i").test(value);
    return hasUnit ? value : `${value} ${unit}`;
  }
  for (const group of product.specGroups ?? []) {
    const value = group.items.find((item) => item.field === field)?.value;
    if (value) return value;
  }
  return null;
}

function mapPublicDevice(row: PublicRow) {
  const media = record(row.media);
  const imageAlt = text(media.imageAlt) ?? text(row.image_alt) ?? row.name;
  const imageBackground = media.imageBackground === "light" || media.imageBackground === "transparent" ? media.imageBackground : "dark";
  const imageFit = media.imageFit === "cover" ? "cover" : "contain";
  const placeholderType = ["glasses", "headset", "frame", "wordmark"].includes(String(media.placeholderType)) ? String(media.placeholderType) : "wordmark";
  const detailMedia = { imageUrl: text(row.product_image_url) ?? text(row.official_image_url), imageAlt, imageBackground, imageFit, hasConfirmedImage: media.hasConfirmedImage === true, placeholderType };
  const groups = specGroups(row.full_specs);
  const previewSpecs = Array.isArray(row.key_specs) ? row.key_specs.flatMap((candidate) => {
    const item = record(candidate), field = text(item.field), label = text(item.label), value = specText(item.value);
    return field && label && value !== null ? [{ field, label, value }] : [];
  }) : groups.flatMap((group) => group.items).slice(0, 5);
  return {
    slug: row.slug, brandKey: row.brand_key, brandName: row.brand_name, brandLabel: row.brand_name, brandMarkText: row.brand_name, brandTone: "xreal",
    name: row.name, title: row.name, shortDescription: row.short_description, longDescription: row.long_description, positioning: text(row.positioning) ?? text(row.route_description) ?? "",
    releaseYear: text(row.release_year), availability: text(row.availability), typeLabel: text(row.type_label) ?? text(row.route_label) ?? "", statusLabel: text(row.status_label), infoStatusLabel: null,
    category: text(row.category) ?? "", routeLabel: text(row.route_label) ?? "", routeDescription: text(row.route_description) ?? "", bestFor: strings(row.best_for), notIdealFor: strings(row.not_ideal_for), keyLimitations: strings(row.key_limitations),
    productImageUrl: detailMedia.imageUrl, officialImageUrl: text(row.official_image_url), officialProductUrl: text(row.official_product_url) ?? text(row.product_url), buyUrl: text(row.buy_url), brandWebsiteUrl: null,
    media: detailMedia, cardMedia: detailMedia, detailMedia, specGroups: groups, previewSpecs, keySpecs: previewSpecs, cardSpecs: previewSpecs.slice(0, 4), quickSpecs: groups.flatMap((group) => group.items).slice(0, 6), knownSpecCount: groups.flatMap((group) => group.items).length,
    detailSummary: [row.short_description, row.long_description].filter(Boolean), externalLinks: [text(row.official_product_url) ?? text(row.product_url), text(row.buy_url)].filter(Boolean).map((url) => ({ label: "官方链接", url: url as string })),
  };
}

function failure() { return new Error("Public device read failed."); }

export async function listPublishedDevices(client: SupabaseClient) {
  const { data, error } = await client.from("devices").select(publicDeviceColumns).eq("publication_status", "published").order("brand_key", { ascending: true });
  if (error) throw failure();
  return (data ?? []).map((row) => mapPublicDevice(row as PublicRow));
}

export async function getPublishedDeviceBySlug(client: SupabaseClient, slug: string) {
  if (!slug) return null;
  const { data, error } = await client.from("devices").select(publicDeviceColumns).eq("publication_status", "published").eq("slug", slug).maybeSingle();
  if (error) throw failure();
  return data ? mapPublicDevice(data as PublicRow) : null;
}
