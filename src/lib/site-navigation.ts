export type NavKey = "home" | "forum" | "news" | "products" | "launcher";

export const mainNav = [
  { key: "home", label: "首页", href: "/" },
  { key: "forum", label: "论坛", href: "/feed/" },
  { key: "news", label: "热点", href: "/news/" },
  { key: "products", label: "产品", href: "/products/" },
  { key: "launcher", label: "Gaze Launcher", href: "/gaze-launcher/" },
] as const;

export const productLinks = [
  {
    label: "设备库",
    href: "/devices/",
    description: "按品牌查看主流 AR/AI 眼镜资料与适用场景。",
  },
  {
    label: "选购指南",
    href: "/guides/",
    description: "围绕预算、用途与风险边界做购买判断。",
  },
  {
    label: "开发者",
    href: "/developers/",
    description: "汇总 SDK、平台入口和开发约束参考。",
  },
] as const;

export const forumTabs = [
  { key: "feed", label: "动态", href: "/feed/" },
  { key: "circles", label: "圈子", href: "/circles/" },
  { key: "new-post", label: "发帖", href: "/posts/new/" },
] as const;

export const hiddenPublicCircleSlugs = new Set(["rls-test-circle", "rls-test", "test-circle"]);

export function isPublicVisibleCircle(input: { slug?: string | null; name?: string | null }) {
  const slug = input.slug?.toLowerCase() ?? "";
  const name = input.name?.toLowerCase() ?? "";
  if (hiddenPublicCircleSlugs.has(slug)) return false;
  if (name.includes("rls test")) return false;
  return true;
}

export function inferNavKey(pathname: string): NavKey {
  if (pathname === "/" || pathname === "") return "home";
  if (pathname.startsWith("/feed") || pathname.startsWith("/forum") || pathname.startsWith("/circles") || pathname.startsWith("/posts")) {
    return "forum";
  }
  if (pathname.startsWith("/news")) return "news";
  if (pathname.startsWith("/products") || pathname.startsWith("/devices") || pathname.startsWith("/guides") || pathname.startsWith("/developers")) {
    return "products";
  }
  if (pathname.startsWith("/gaze-launcher") || pathname.startsWith("/gaze-os")) return "launcher";
  return "home";
}
