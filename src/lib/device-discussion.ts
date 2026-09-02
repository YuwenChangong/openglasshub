import { deviceLibrary, type DeviceLibraryEntry } from "../data/devices";

export type DeviceDiscussionContext = {
  device: DeviceLibraryEntry;
  slug: string;
  searchQuery: string;
  feedHref: string;
  startPostHref: string;
  circlesHref: string;
  libraryHref: string;
  productHref: string;
  suggestedTitle: string;
  suggestedBody: string;
};

function sanitizeDeviceSlug(rawValue: string | null | undefined) {
  const value = String(rawValue ?? "").trim().toLowerCase();
  if (!value || value.length > 80) return null;
  if (!/^[a-z0-9-]+$/.test(value)) return null;
  return value;
}

export function getDeviceDiscussionContext(rawSlug: string | null | undefined): DeviceDiscussionContext | null {
  const slug = sanitizeDeviceSlug(rawSlug);
  if (!slug) return null;

  const device = deviceLibrary.find((entry) => entry.slug === slug);
  if (!device) return null;

  const searchQuery = device.name;
  const feedParams = new URLSearchParams({
    compose: "1",
    device: slug,
  });
  const postParams = new URLSearchParams({
    device: slug,
  });
  const productHref = "/products/";

  return {
    device,
    slug,
    searchQuery,
    feedHref: `/feed/?${feedParams.toString()}`,
    startPostHref: `/posts/new/?${postParams.toString()}`,
    circlesHref: "/circles/",
    libraryHref: "/products/",
    productHref,
    suggestedTitle: `Thoughts on ${device.name}`,
    suggestedBody: `Has anyone tried ${device.name}? I'm interested in how it feels for daily use, display quality, comfort, and app support.`,
  };
}
