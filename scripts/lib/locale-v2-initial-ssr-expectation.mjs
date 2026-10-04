import assert from 'node:assert/strict';

// Frozen test inputs use assigned ISO alpha-2 codes, not emulator special codes.
const assignedCountries = new Set((
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' '));

function languageCandidate(header) {
  if (!header || Buffer.byteLength(header) > 2048) return undefined;
  const entries = header.split(',');
  if (entries.length > 20) return undefined;
  const candidates = [];
  for (const [index, entry] of entries.entries()) {
    const match = /^\s*(\*|[a-z]{2,8}(?:-[a-z0-9]{1,8})*)\s*(?:;\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/i.exec(entry);
    if (!match) return undefined;
    candidates.push({ tag: match[1].toLowerCase(), weight: match[2] === undefined ? 1 : Number(match[2]), index });
  }
  candidates.sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag, weight } of candidates) {
    if (!weight) continue;
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
    if (tag.split('-').includes('hant')) continue;
    if (tag === 'zh' || /^(zh-cn|zh-hans)(-|$)/.test(tag)) return 'zh-CN';
  }
}

// Independent test oracle: literals and precedence, never the application resolver.
export function expectedInitialSsrLocale({ current, savedPreference, countryAvailable, country, acceptLanguage, fallback = 'en' }) {
  assert.equal(fallback, 'en', 'INITIAL_SSR_ENGLISH_FALLBACK_REQUIRED');
  const preference = current !== undefined ? current : savedPreference;
  if (preference === 'zh-CN' || preference === 'en') return { locale: preference, source: current !== undefined ? 'current' : 'saved' };
  if (countryAvailable && assignedCountries.has(country)) {
    return { locale: country === 'CN' ? 'zh-CN' : 'en', source: 'country' };
  }
  const language = languageCandidate(acceptLanguage);
  return { locale: language ?? fallback, source: language ? 'accept_language' : 'fallback' };
}

export async function captureLocalLocaleCountry(worker) {
  const local = worker.raw?.runtimes?.find(runtime => runtime.mf)?.mf;
  const proxy = (await worker.raw?.proxy?.ready?.promise)?.proxyWorker;
  assert.ok(local?.getCf && proxy?.getCf, 'LOCAL_COUNTRY_INPUT_UNOBSERVABLE');
  const userCountry = (await local.getCf()).country;
  const proxyCountry = (await proxy.getCf()).country;
  assert.equal(userCountry, proxyCountry, 'LOCAL_COUNTRY_INPUT_INCONSISTENT');
  if (userCountry !== undefined) assert.equal(typeof userCountry, 'string', 'LOCAL_COUNTRY_INPUT_INVALID');
  return { available: assignedCountries.has(userCountry), value: userCountry, source: 'LOCAL_MINIFLARE_GETCF' };
}

function savedPreferenceFromCookie(header) {
  const value = header?.split(';').map(part => part.trim()).find(part => part.startsWith('ogh_preferences_v1='))?.slice('ogh_preferences_v1='.length);
  if (!value || Buffer.byteLength(value) > 512) return undefined;
  try {
    const record = JSON.parse(decodeURIComponent(value));
    if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
    if (Object.keys(record).sort().join(',') !== 'generation,preference,provenance,version') return undefined;
    if (record.version !== 1 || !['auto', 'en', 'zh-CN'].includes(record.preference) || !Number.isSafeInteger(record.generation) || record.generation < 0 || !['device_explicit', 'account_adopted'].includes(record.provenance)) return undefined;
    return record.preference;
  } catch { return undefined; }
}

export async function initialSsrExpectation(request, localCountry) {
  const headers = await request.allHeaders();
  const inputs = { current: undefined, savedPreference: savedPreferenceFromCookie(headers.cookie),
    countryAvailable: localCountry.available, country: localCountry.value,
    acceptLanguage: headers['accept-language'], fallback: 'en' };
  return { ...expectedInitialSsrLocale(inputs), inputs };
}
