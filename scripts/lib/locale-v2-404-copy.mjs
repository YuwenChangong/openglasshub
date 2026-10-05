export const notFoundContracts = Object.freeze({
  'zh-CN': {
    heading: '页面未找到',
    description: '你访问的页面不存在，或当前预览环境还没有这条内容。',
    lead: '链接可能已失效、内容尚未发布，或者你访问的是预览环境里不存在的地址。',
    actions: ['返回首页', '查看论坛', '查看热点', '进入搜索'],
  },
  en: {
    heading: 'Page not found',
    description: 'This page does not exist, or this content is not yet available in the current preview environment.',
    lead: 'The link may have expired, the content may not be published yet, or this address may not exist in the preview environment.',
    actions: ['Return home', 'View forum', 'View news', 'Search'],
  },
});

export function observeNotFound(document) {
  return {
    locale: document.documentElement.lang,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content,
    heading: document.querySelector('.not-found-page h1')?.textContent.trim(),
    lead: document.querySelector('.not-found-page__lead')?.textContent.trim(),
    actions: [...document.querySelectorAll('.not-found-page__actions a')].map(a => a.textContent.trim()),
    destinations: [...document.querySelectorAll('.not-found-page__actions a')].map(a => a.getAttribute('href')),
  };
}

export function verifyNotFound(actual, locale, check) {
  const expected = notFoundContracts[locale];
  if (!expected) throw new RangeError('Unsupported 404 locale');
  check(actual.status === 404, '404_STATUS');
  check(!actual.location, '404_NO_REDIRECT');
  check(actual.locale === locale, '404_REQUEST_LOCALE');
  check(actual.heading === expected.heading, '404_BILINGUAL_COPY');
  check(actual.title === `${expected.heading} | OpenGlass Hub`, '404_TITLE_COPY');
  check(actual.description === expected.description, '404_DESCRIPTION_COPY');
  check(actual.lead === expected.lead, '404_BODY_COPY');
  check(JSON.stringify(actual.actions) === JSON.stringify(expected.actions), '404_ACTION_COPY');
  check(JSON.stringify(actual.destinations) === JSON.stringify(['/', '/feed/', '/news/', '/search/']), '404_ACTION_DESTINATIONS');
}
