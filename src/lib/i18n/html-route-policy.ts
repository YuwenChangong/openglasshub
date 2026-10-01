const assetExtension = /\.(?:js|mjs|css|map|json|xml|txt|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|mp4|webm|pdf|webmanifest)$/i;

export function isLocaleHtmlRoute(pathname: string): boolean {
  if (!pathname.startsWith("/") || /^\/(?:api|_astro|_image|_server-islands)(?:\/|$)/.test(pathname)) return false;
  return !assetExtension.test(pathname.replace(/\/$/, ""));
}
