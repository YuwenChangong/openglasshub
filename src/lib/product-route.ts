export function isValidProductSegment(value: string) {
  return value.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function getProductDetailHref(product: { brandKey: string; slug: string }) {
  if (!isValidProductSegment(product.brandKey) || !isValidProductSegment(product.slug)) throw new Error("Invalid public product identity.");
  return `/products/${encodeURIComponent(product.brandKey)}/${encodeURIComponent(product.slug)}/`;
}
