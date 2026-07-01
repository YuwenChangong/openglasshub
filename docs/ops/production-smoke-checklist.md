# Production Smoke Checklist

## Public route checks

- `GET /` -> `200`
- `GET /feed/` -> `200`
- `GET /circles/` -> `200`

## Unauthenticated API checks

- `GET /api/forum/reports` -> `405`
- `GET /api/admin/reports` with no bearer -> `401`
- `GET /api/admin/moderation/lexicon-health` with no bearer -> `401`

## Auth checks

- Ordinary bearer on `GET /api/admin/reports` -> `403`
- Admin bearer on `GET /api/admin/moderation/lexicon-health` -> `200`

## Lexicon health expectations

- `bindingPresent=true`
- `source=r2`
- `fallbackUsed=false`
- `entryCount=17036`
- No raw lexicon terms exposed in the response body

## Notes

- Use a disposable QA admin token only when an authenticated smoke check is required.
- Never print bearer tokens in logs or screenshots.
