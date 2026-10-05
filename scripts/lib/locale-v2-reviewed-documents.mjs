import assert from 'node:assert/strict';

export const editorialDocumentCases = Object.freeze([
  { assertion: 'REVIEWED_ENGLISH_DOCUMENT', documentKey: 'guides/index', path: '/guides/index/', requestedLanguage: 'en',
    renderedLanguage: 'en', title: 'Buying guides', markers: ['Begin with the task', 'Browse the device library'] },
  { assertion: 'REVIEWED_CHINESE_DOCUMENT', documentKey: 'guides/index', path: '/guides/index/', requestedLanguage: 'zh-CN',
    renderedLanguage: 'zh-CN', title: '选购指南', markers: ['信息说明', '阅读文章'] },
  { assertion: 'ORIGINAL_DOCUMENT_FALLBACK_ALLOWED', documentKey: 'guides/ar-ai-xr-glasses-difference', path: '/guides/ar-ai-xr-glasses-difference/', requestedLanguage: 'en',
    renderedLanguage: 'zh-CN', title: 'AR 眼镜、AI 眼镜、XR 眼镜有什么区别？', markers: ['快速结论'] },
]);

const projectDocument = ({ markup, markers }) => {
  const root = markup === null ? document : new DOMParser().parseFromString(markup, 'text/html');
  const article = root.querySelector('article.detail-main');
  return { shellLocale: root.documentElement.lang, title: root.querySelector('h1')?.textContent.trim() ?? null,
    documentLanguage: article?.getAttribute('lang') ?? null,
    contentMarkers: markers.map(marker => article?.textContent.includes(marker) ?? false) };
};

export async function verifyEditorialDocumentFamily({ page, navigate, locale, readPreference, readAccountPreference, readAccountIdentity,
  observe, assertUnchanged, record = () => {} }) {
  for (const contract of editorialDocumentCases) {
    assert.equal(await readAccountIdentity(), true, 'DOCUMENT_ACCOUNT_IDENTITY');
    const beforeCookie = await readPreference(), beforeAccount = await readAccountPreference();
    assert.ok(['en', 'zh-CN'].includes(beforeAccount?.locale_preference) && Number.isInteger(beforeAccount?.revision)
      && beforeAccount.revision >= 0, 'DOCUMENT_ACCOUNT_BASELINE');
    const route = `${contract.path}?${new URLSearchParams({ lang: contract.requestedLanguage })}`;
    const response = await navigate(page, route, locale);
    const raw = await page.evaluate(projectDocument, { markup: await response.text(), markers: contract.markers });
    const rendered = await page.evaluate(projectDocument, { markup: null, markers: contract.markers });
    const matches = document => document.title === contract.title && document.documentLanguage === contract.renderedLanguage
      && document.contentMarkers.every(Boolean);
    const requested = new URL(response.request().url()), shown = new URL(page.url());
    observe(response.status() === 200 && requested.pathname === contract.path && shown.pathname === contract.path
      && requested.searchParams.get('lang') === contract.requestedLanguage && shown.searchParams.get('lang') === contract.requestedLanguage
      && matches(raw) && matches(rendered), contract.assertion);
    const afterCookie = await readPreference(), afterAccount = await readAccountPreference();
    assert.equal(await readAccountIdentity(), true, 'DOCUMENT_ACCOUNT_IDENTITY');
    const cookieAssertion = contract.assertion === 'ORIGINAL_DOCUMENT_FALLBACK_ALLOWED'
      ? 'ORIGINAL_FALLBACK_NO_GLOBAL_COOKIE_MUTATION' : 'DOCUMENT_LANG_DOES_NOT_MUTATE_GLOBAL_COOKIE';
    // Preference mutations invalidate subsequent state; unlike content observations these stay fail-fast.
    assertUnchanged(afterCookie, beforeCookie, cookieAssertion);
    assertUnchanged(afterAccount, beforeAccount, 'DOCUMENT_LANG_DOES_NOT_MUTATE_ACCOUNT_PREFERENCE');
    observe(raw.shellLocale === locale && rendered.shellLocale === locale, 'DOCUMENT_LANG_DOES_NOT_MUTATE_GLOBAL_LOCALE');
    record({ assertion: contract.assertion, documentKey: contract.documentKey, requestedLanguage: contract.requestedLanguage,
      documentRenderedLanguage: ['en', 'zh-CN'].includes(rendered.documentLanguage) ? rendered.documentLanguage : 'UNKNOWN',
      responseStatus: response.status(), rawDocumentMatches: matches(raw), renderedDocumentMatches: matches(rendered),
      globalLocaleBefore: beforeCookie?.preference ?? 'ABSENT', globalLocaleAfter: afterCookie?.preference ?? 'ABSENT',
      accountPreferenceBefore: beforeAccount, accountPreferenceAfter: afterAccount });
  }
}
