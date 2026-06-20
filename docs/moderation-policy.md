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
- `微信登录问题` => not auto-reject
- normal AR / AI / XR glasses discussion => allow

## Visibility rules

- Only `status=published` and `moderation_status=published` content is public
- Pending or rejected content is hidden from guests and other users
- Owners may see their own pending content where the route supports it
- Admin moderation queue is the manual backstop

## Operational notes

- Do not expose raw OpenAI responses or category scores to users
- Do not expose full sensitive term lists to the client
- Do not claim full video-stream moderation
