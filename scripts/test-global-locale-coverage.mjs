import assert from "node:assert/strict";
import { readFile, access, realpath } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { parse } from "@astrojs/compiler";
import { getUiMessages } from "../src/lib/i18n/catalog.ts";

const expectedPaths = [
  "src/components/CommunityCTA.astro",
  "src/components/LatestUpdates.astro",
  "src/components/admin/AdminCirclesDashboard.tsx",
  "src/components/admin/AdminDevicesDashboard.tsx",
  "src/components/admin/AdminForumDashboard.tsx",
  "src/components/admin/AdminMediaDashboard.tsx",
  "src/components/admin/AdminModerationQueue.tsx",
  "src/components/admin/AdminNewsDashboard.tsx",
  "src/components/admin/AdminReportsPanel.tsx",
  "src/components/admin/AdminUsersDashboard.tsx",
  "src/components/auth/AuthCTA.tsx",
  "src/components/auth/AuthCallback.tsx",
  "src/components/auth/FeedSidebarAuthHint.tsx",
  "src/components/auth/ResetPasswordForm.tsx",
  "src/components/common/GlassConfirmDialog.tsx",
  "src/components/community/CircleCard.astro",
  "src/components/community/CommunityHeader.astro",
  "src/components/community/EmptyFeedState.astro",
  "src/components/community/GlobalSearchBox.tsx",
  "src/components/community/NewsCard.astro",
  "src/components/community/PostCard.astro",
  "src/components/community/PostMediaPreview.astro",
  "src/components/community/ProductCard.astro",
  "src/components/devices/DeviceLibraryExplorer.tsx",
  "src/components/forum/AuthPanel.tsx",
  "src/components/forum/CircleCoverEditor.tsx",
  "src/components/forum/CircleManageEntry.tsx",
  "src/components/forum/CircleOwnerDashboard.tsx",
  "src/components/forum/CommentForm.tsx",
  "src/components/forum/CommentsSection.tsx",
  "src/components/forum/CreateCircleForm.tsx",
  "src/components/forum/CreatePostForm.tsx",
  "src/components/forum/PostMediaGallery.tsx",
  "src/components/forum/PostModerationActions.tsx",
  "src/components/forum/PostSocialActions.tsx",
  "src/components/forum/SharePostButton.tsx",
  "src/components/legal/LegalPage.astro",
  "src/components/news/NewsPagination.tsx",
  "src/components/notifications/NotificationsPage.tsx",
  "src/components/profile/EditProfileForm.tsx",
  "src/components/profile/MyProfilePage.tsx",
  "src/components/profile/ProfilePostCard.tsx",
  "src/components/reports/ReportTrigger.tsx",
  "src/components/site/HeaderNotifications.tsx",
  "src/components/site/HeaderUserMenu.tsx",
  "src/components/site/SiteHeader.astro",
  "src/components/starlight/Header.astro",
  "src/components/starlight/ThemeProvider.astro",
  "src/components/starlight/ThemeSelect.astro",
  "src/content/editorial-translations/en/about/index.mdx",
  "src/content/editorial-translations/en/developers/index.mdx",
  "src/content/editorial-translations/en/guides/index.mdx",
  "src/layouts/CommunityLayout.astro",
  "src/layouts/ForumLayout.astro",
  "src/lib/i18n/catalog.ts",
  "src/lib/i18n/document-locale.ts",
  "src/lib/i18n/editorial-variants.ts",
  "src/lib/i18n/messages/account.ts",
  "src/lib/i18n/messages/admin.ts",
  "src/lib/i18n/messages/catalog.ts",
  "src/lib/i18n/messages/community.ts",
  "src/lib/i18n/messages/documents.ts",
  "src/lib/i18n/messages/shell.ts",
  "src/lib/i18n/starlight-ui.ts",
  "src/lib/site-navigation.ts",
  "src/pages/account-deletion/index.astro",
  "src/pages/admin/circles/index.astro",
  "src/pages/admin/devices/index.astro",
  "src/pages/admin/forum/index.astro",
  "src/pages/admin/media/index.astro",
  "src/pages/admin/moderation/index.astro",
  "src/pages/admin/news/index.astro",
  "src/pages/admin/reports/index.astro",
  "src/pages/admin/users/index.astro",
  "src/pages/auth/callback.astro",
  "src/pages/auth/reset-password/index.astro",
  "src/pages/circles/[slug].astro",
  "src/pages/circles/[slug]/manage.astro",
  "src/pages/circles/index.astro",
  "src/pages/circles/new.astro",
  "src/pages/community-guidelines/index.astro",
  "src/pages/contact/index.astro",
  "src/pages/developers/index.astro",
  "src/pages/devices/[slug].astro",
  "src/pages/devices/index.astro",
  "src/pages/feed/index.astro",
  "src/pages/forum/index.astro",
  "src/pages/gaze-launcher/index.astro",
  "src/pages/guides/[slug].astro",
  "src/pages/guides/index.astro",
  "src/pages/index.astro",
  "src/pages/login/index.astro",
  "src/pages/me/edit.astro",
  "src/pages/me/index.astro",
  "src/pages/news/[slug].astro",
  "src/pages/news/index.astro",
  "src/pages/notifications/index.astro",
  "src/pages/posts/[id].astro",
  "src/pages/posts/new.astro",
  "src/pages/privacy/index.astro",
  "src/pages/products/[brand].astro",
  "src/pages/products/index.astro",
  "src/pages/safety/index.astro",
  "src/pages/search/index.astro",
  "src/pages/terms/index.astro",
  "src/pages/u/[username].astro",
  "src/pages/users/[id].astro",
  "src/starlightRouteData.ts"
];
const manifest = JSON.parse(await readFile("tests/fixtures/locale-ui-coverage.json", "utf8"));
assert.equal(manifest.version, 1);
assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, "Source inventory must not be an empty placeholder");
assert.deepEqual(manifest.files.map(item => item.path).sort(), expectedPaths, "Every Task 10-18 source needs an explicit coverage owner and cases");
const allowedNamespaces = new Set(["shell", "account", "community", "catalog", "admin", "documents", "starlight"]);
const root = await realpath(process.cwd());
const sources = new Map();
for (const item of manifest.files) {
  assert.equal(path.posix.normalize(item.path), item.path);
  assert.ok(item.path.startsWith("src/") && !item.path.includes("\\"));
  assert.ok([".astro", ".tsx", ".ts", ".mdx"].includes(path.extname(item.path)));
  const relative = path.relative(root, await realpath(item.path));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Source must stay inside this repository");
  const source = await readFile(item.path, "utf8");
  assert.ok(source.trim().length > 0, item.path);
  sources.set(item.path, source);
  assert.ok(allowedNamespaces.has(item.namespace), item.path);
  assert.ok(item.cases.length > 0 && item.cases.every(value => typeof value === "string" && value.length > 0), item.path);
  assert.ok(item.evidence.length > 0, item.path);
  for (const proof of item.evidence) await access(proof);
  for (const exception of item.exceptions) assert.ok(["UGC", "editorial", "source-title", "locale-neutral-contract"].includes(exception), item.path);
}
assert.equal(sources.size, expectedPaths.length, "Every inventoried source must actually be read exactly once");
if (process.argv.includes("--inventory-only")) {
  console.log(`LOCALE_COVERAGE_INVENTORY=PASS FILES=${manifest.files.length} SCANNED_FILES=${sources.size} MISSING_FILES=0 DUPLICATE_FILES=0 UNCOVERED_REQUIRED_SURFACES=0`);
  process.exit(0);
}

// Audit literal UI nodes, not arbitrary source strings: UGC and authored bodies
// remain governed by their owning SSR/DOM evidence, rather than a language ban.
const untranslated = [], forbiddenTheme = [];
const visibleAttributes = new Set(["aria-label", "title", "placeholder", "alt"]);
function inspectLiteral(item, value, context) {
  const text = value.trim();
  if (!text) return;
  if (["Appearance", "System", "Light", "外观", "跟随系统", "浅色"].includes(text)) {
    forbiddenTheme.push({ path: item.path, context, text });
  }
  if (!item.exceptions.includes("editorial") && /\p{Script=Han}/u.test(text)) {
    untranslated.push({ path: item.path, context, text });
  }
}
for (const item of manifest.files) {
  const source = sources.get(item.path);
  if (item.path.endsWith(".tsx")) {
    const ast = ts.createSourceFile(item.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function walk(node) {
      if (ts.isJsxText(node)) inspectLiteral(item, node.text, "jsx-text");
      if (ts.isJsxAttribute(node) && visibleAttributes.has(node.name.getText(ast)) && node.initializer && ts.isStringLiteral(node.initializer)) {
        inspectLiteral(item, node.initializer.text, node.name.getText(ast));
      }
      ts.forEachChild(node, walk);
    }
    walk(ast);
  } else if (item.path.endsWith(".astro")) {
    const { ast } = await parse(source);
    function walk(node) {
      if (["script", "style"].includes(node.name)) return;
      if (node.type === "text") inspectLiteral(item, node.value, "astro-text");
      for (const attr of node.attributes ?? []) {
        if (visibleAttributes.has(attr.name) && attr.kind === "quoted") inspectLiteral(item, attr.value, attr.name);
      }
      for (const child of node.children ?? []) walk(child);
    }
    walk(ast);
  }
}
console.log(`LOCALE_COVERAGE_LITERAL_UI_AUDIT FORBIDDEN_LIGHT_UI_FINDINGS=${forbiddenTheme.length} UNTRANSLATED_REQUIRED_UI_FINDINGS=${untranslated.length} SCOPE=DIRECT_LITERAL_UI_NODES DYNAMIC_UI=OWNING_SSR_DOM_GATES`);
assert.deepEqual(forbiddenTheme, [], "Forbidden theme controls in required UI");
assert.deepEqual(untranslated, [], "Untranslated literal required UI; do not modify product under inventory authorization");
function leaves(value, prefix = "") {
  return Object.entries(value).flatMap(([key, entry]) => typeof entry === "string"
    ? [[prefix + key, entry]]
    : leaves(entry, prefix + key + "."));
}
const english = leaves(getUiMessages("en"));
const chinese = leaves(getUiMessages("zh-CN"));
assert.deepEqual(english.map(([key]) => key), chinese.map(([key]) => key));
for (const [key, value] of [...english, ...chinese]) assert.ok(value.trim().length > 0, key);
assert.ok(manifest.files.some(item => item.path.endsWith("AuthPanel.tsx") && item.cases.includes("required-captcha")), "Auth protection stays explicit");
assert.ok(manifest.files.some(item => item.path.endsWith("ThemeProvider.astro") && item.cases.includes("dark-only")));
console.log(`GLOBAL_LOCALE_COVERAGE=PASS SOURCE_FILES=${manifest.files.length} SCANNED_FILES=${sources.size} MISSING_FILES=0 DUPLICATE_FILES=0 UNCOVERED_REQUIRED_SURFACES=0 MESSAGE_LEAVES=${english.length} DOM_ACCEPTANCE=SEPARATE_GATE`);
