import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { notFoundContracts, observeNotFound, verifyNotFound } from './lib/locale-v2-404-copy.mjs';

function snapshot(locale) {
  const expected = notFoundContracts[locale];
  return { status:404, location:null, locale, title:`${expected.heading} | OpenGlass Hub`, description:expected.description,
    heading:expected.heading, lead:expected.lead, actions:expected.actions, destinations:['/', '/feed/', '/news/', '/search/'] };
}
const check = (condition, name) => assert.ok(condition, name);
for (const locale of ['zh-CN', 'en']) test(`${locale} verifies the whole 404 copy family`, () => {
  const names = [];
  verifyNotFound(snapshot(locale), locale, (condition,name) => { check(condition,name); names.push(name); });
  assert.equal(names.length, 9);
});
test('rejects success status and accidental redirects', () => {
  assert.throws(() => verifyNotFound({...snapshot('en'),status:200},'en',check), /404_STATUS/);
  assert.throws(() => verifyNotFound({...snapshot('en'),location:'/404/'},'en',check), /404_NO_REDIRECT/);
});
test('Chinese copy in an English shell reproduces the exact old RED', () => {
  assert.throws(() => verifyNotFound({...snapshot('zh-CN'),locale:'en'},'en',check), /404_BILINGUAL_COPY/);
});
test('a correct heading cannot hide stale title, body or actions', () => {
  for (const [key, name] of [['title','404_TITLE_COPY'],['description','404_DESCRIPTION_COPY'],['lead','404_BODY_COPY'],['actions','404_ACTION_COPY'],['destinations','404_ACTION_DESTINATIONS']]) {
    const stale = key === 'destinations' ? ['/404/'] : snapshot('zh-CN')[key];
    assert.throws(() => verifyNotFound({...snapshot('en'),[key]:stale},'en',check), new RegExp(name));
  }
});
test('the observer reads 404 content rather than a shell heading or link', () => {
  const dom = new JSDOM('<html lang="en"><head><title>Page not found | OpenGlass Hub</title><meta name="description" content="Missing"></head><body><h1>Shell title</h1><a href="/other/">Other link</a><section class="not-found-page"><h1>Page not found</h1><p class="not-found-page__lead">Missing body</p><div class="not-found-page__actions"><a href="/">Return home</a></div></section></body></html>');
  try {
    const actual = observeNotFound(dom.window.document);
    assert.equal(actual.heading, 'Page not found');
    assert.equal(actual.lead, 'Missing body');
    assert.deepEqual(actual.actions, ['Return home']);
    assert.deepEqual(actual.destinations, ['/']);
  } finally { dom.window.close(); }
});
