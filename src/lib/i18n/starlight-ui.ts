import type { ResolvedLocale } from "./locale.ts";
import { formatUiMessage } from "./catalog.ts";

const pairs = {
  "skipLink.label": ["跳转到内容", "Skip to content"],
  "search.label": ["搜索", "Search"],
  "search.ctrlKey": ["Ctrl", "Ctrl"],
  "search.cancelLabel": ["取消", "Cancel"],
  "search.devWarning": ["搜索索引仅在构建后可用。", "The search index is available only after a build."],
  "themeSelect.accessibleLabel": ["选择主题", "Select theme"],
  "themeSelect.dark": ["深色", "Dark"],
  "themeSelect.light": ["浅色", "Light"],
  "themeSelect.auto": ["自动", "Auto"],
  "languageSelect.accessibleLabel": ["选择语言", "Select language"],
  "menuButton.accessibleLabel": ["菜单", "Menu"],
  "sidebarNav.accessibleLabel": ["主导航", "Main"],
  "tableOfContents.onThisPage": ["本页内容", "On this page"],
  "tableOfContents.overview": ["概览", "Overview"],
  "i18n.untranslatedContent": ["此文档尚无经过审阅的所选语言版本，以下为原文。", "No reviewed edition is available in the selected language. The original document follows."],
  "page.editLink": ["编辑页面", "Edit page"],
  "page.lastUpdated": ["最后更新：", "Last updated:"],
  "page.previousLink": ["上一页", "Previous"],
  "page.nextLink": ["下一页", "Next"],
  "page.draft": ["此内容为草稿，不会包含在正式构建中。", "This content is a draft and is excluded from the production build."],
  "404.text": ["页面不存在。请检查地址或使用搜索。", "Page not found. Check the address or use search."],
  "aside.note": ["说明", "Note"],
  "aside.tip": ["提示", "Tip"],
  "aside.caution": ["注意", "Caution"],
  "aside.danger": ["危险", "Danger"],
  "fileTree.directory": ["目录", "Directory"],
  "builtWithStarlight.label": ["基于 Starlight 构建", "Built with Starlight"],
  "heading.anchorLabel": ["章节“{title}”", "Section titled “{title}”"],
} as const;

export function createStarlightUi(locale: ResolvedLocale): App.Locals["t"] {
  const dictionary = Object.fromEntries(Object.entries(pairs).map(([key, value]) => [key, value[locale === "en" ? 1 : 0]]));
  const translate = (input: string | string[], options: Record<string, unknown> = {}) => {
    const key = (Array.isArray(input) ? input : [input]).find((item) => Object.hasOwn(dictionary, item));
    if (!key) throw new Error("Unknown Starlight UI message key");
    const template = dictionary[key];
    const argumentsForTemplate: Record<string, string | number> = {};
    for (const match of template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
      const value = options[match[1]];
      if (typeof value !== "string" && typeof value !== "number") throw new Error("Missing Starlight UI message argument");
      argumentsForTemplate[match[1]] = value;
    }
    return formatUiMessage(template, argumentsForTemplate);
  };
  return Object.assign(translate, {
    all: () => ({ ...dictionary }),
    exists: (input: string | string[]) => (Array.isArray(input) ? input : [input]).some((key) => Object.hasOwn(dictionary, key)),
    dir: () => "ltr" as const,
  }) as unknown as App.Locals["t"];
}
