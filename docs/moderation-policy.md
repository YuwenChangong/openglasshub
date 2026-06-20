# Moderation Policy

## Decision model

- `allow`: content can publish or save
- `review`: content must not become public; send to pending review or block save
- `reject`: content must not publish; reject immediately or hide

## Local sensitive lexicon categories

- `off_platform_contact`
- `spam_or_promotion`
- `scam_or_resource_lure`
- `suspicious_external_link`
- `fake_download_or_private_access`
- `sexual_content`
- `violence_or_threat`
- `hate_or_harassment`
- `illegal_goods_or_services`
- `personal_data_or_doxxing`
- `political_sensitive`
- `vulgar_abuse`
- `low_quality_spam`
- `platform_policy_custom`

## OpenGlass custom rules

Priority examples:

- `加微信` + `资料/入口/私聊` => reject
- `完整资料入口` + contact lure => reject
- `私下交易 / 卖号 / 破解教程` => reject
- `人口贩卖` => reject
- `嫖娼 / 卖淫` => review or reject
- `微信登录问题` => not auto-reject
- normal AR / AI / XR glasses discussion => allow

Critical term note:

- Final blocker QA first confirmed `嫖娼` and `卖淫` were naturally covered by imported lexicon data
- Final blocker QA also found `人口贩卖` was not naturally covered by upstream imports and was added as an OpenGlass custom deny rule
- To keep the Cloudflare worker bundle within deployment limits, `嫖娼` and `卖淫` are now also pinned in OpenGlass custom review rules instead of relying on the giant upstream dictionary at runtime

## Visibility rules

- Only `status=published` and `moderation_status=published` content is public
- Pending or rejected content is hidden from guests and other users
- Owners may see their own pending content where the route supports it
- Admin moderation queue is the manual backstop

## Operational notes

- Do not expose raw OpenAI responses or category scores to users
- Do not expose full sensitive term lists to the client
- Do not claim full video-stream moderation

## Provider unavailable policy

- `MODERATION_PROVIDER_UNAVAILABLE_POLICY=review_all`
  - provider unavailable keeps text content in `review`
  - safest fail-closed mode
- `MODERATION_PROVIDER_UNAVAILABLE_POLICY=local_only_safe`
  - degraded beta mode only
  - provider unavailable can allow low-risk text only when local lexicon says `allow`
  - degraded allow must be marked as local degraded metadata
  - media, avatar, banner, circle cover, and visual moderation do not local-only public allow
- `MODERATION_PROVIDER_UNAVAILABLE_POLICY=block_sensitive`
  - provider unavailable still blocks profile/circle text saves and keeps post/comment text in review

Degraded local-only mode is not equivalent to full OpenAI moderation. Full OpenAI GO still requires OpenAI provider health success.

If the policy env is unset, non-`main` Cloudflare Pages preview branches default to `local_only_safe`. Production-like branches default to `review_all`.
