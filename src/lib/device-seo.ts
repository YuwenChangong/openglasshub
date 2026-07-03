import {
  deviceCategoryLabels,
  deviceLibrary,
  type DeviceLibraryEntry,
} from "../data/devices.ts";

const SITE_URL = "https://openglasshub.pages.dev";
const SITE_NAME = "OpenGlass Hub";

function trimDescription(value: string, limit = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function toAbsoluteUrl(pathname: string) {
  return new URL(pathname, SITE_URL).toString();
}

function getOfficialSourceUrls(device: DeviceLibraryEntry) {
  return (device.source_links ?? [])
    .filter((source) => source.type === "official")
    .map((source) => source.url)
    .filter((url, index, values) => /^https?:\/\//i.test(url) && values.indexOf(url) === index);
}

export function getDeviceLibraryCanonicalUrl() {
  return toAbsoluteUrl("/devices/");
}

export function getDeviceCanonicalUrl(slug: string) {
  return toAbsoluteUrl(`/devices/${slug}/`);
}

export function getDeviceLibraryMetaDescription() {
  return "A conservative AR/AI glasses and XR device library with comparison, verification notes, and community discussion links.";
}

export function getDeviceMetaDescription(device: DeviceLibraryEntry) {
  return trimDescription(device.short_description, 160);
}

export function buildDeviceLibraryStructuredData() {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Device Library | ${SITE_NAME}`,
    description: getDeviceLibraryMetaDescription(),
    url: getDeviceLibraryCanonicalUrl(),
    mainEntity: {
      "@type": "ItemList",
      name: "OpenGlass Hub Device Library",
      numberOfItems: deviceLibrary.length,
      itemListElement: deviceLibrary.map((device, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: getDeviceCanonicalUrl(device.slug),
        name: device.name,
      })),
    },
  };
}

export function buildDeviceStructuredData(device: DeviceLibraryEntry) {
  const officialSources = getOfficialSourceUrls(device);
  const structuredData: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: device.name,
    description: getDeviceMetaDescription(device),
    url: getDeviceCanonicalUrl(device.slug),
    category: deviceCategoryLabels[device.category],
    brand: {
      "@type": "Brand",
      name: device.brand,
    },
  };

  if (officialSources.length === 1) {
    structuredData.sameAs = officialSources[0];
  } else if (officialSources.length > 1) {
    structuredData.sameAs = officialSources;
  }

  return structuredData;
}
