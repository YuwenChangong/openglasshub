import { isGazeLauncherPublicEnabled } from "../lib/gaze-launcher-visibility.ts";

type MarkdownNode = {
  type?: string;
  url?: string;
  children?: MarkdownNode[];
};

function isGazeLauncherRoute(url: string | undefined): boolean {
  if (!url) return false;
  const pathname = new URL(url, "https://openglasshub.pages.dev").pathname;
  return pathname === "/gaze-launcher" || pathname === "/gaze-launcher/";
}

export function isGazeLauncherDocumentationEntryPublic(
  slug: string | undefined,
  value: boolean = isGazeLauncherPublicEnabled(),
): boolean {
  return slug !== "reference/gaze-launcher-docs" || value;
}

export function applyGazeLauncherDocumentationLinkVisibility(
  tree: MarkdownNode,
  value: boolean = isGazeLauncherPublicEnabled(),
): void {
  if (value) return;

  const visit = (node: MarkdownNode) => {
    if (!node.children) return;

    node.children = node.children.flatMap((child) => {
      if (child.type === "link" && isGazeLauncherRoute(child.url)) {
        return child.children ?? [];
      }

      visit(child);
      return [child];
    });
  };

  visit(tree);
}

export default function remarkGazeLauncherVisibility() {
  return (tree: MarkdownNode) => applyGazeLauncherDocumentationLinkVisibility(tree);
}
