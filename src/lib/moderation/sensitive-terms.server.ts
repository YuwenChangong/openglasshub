export const moderationBlocklistPatterns = {
  spam: [
    /\bfree money\b/i,
    /\bearn \$?\d+\s*per day\b/i,
    /兼职刷单|日结返利|拉人送彩金|躺赚|稳赚不赔/i,
    /加(?:微|v|V|wx|WX)|vx[:：]?\s*[a-z0-9_-]{4,}/i,
  ],
  scam: [
    /保证盈利|内幕单|带单老师|一夜暴富|无风险套利/i,
    /\b(binance|okx|bybit).*(客服|充值|带单)\b/i,
    /\btelegram\b.*\bprofit\b/i,
  ],
  sexual: [
    /约炮|色情网|成人视频|裸聊|av电影|援交/i,
    /\bescort\b|\bsex cam\b|\badult hookup\b/i,
  ],
  harassment: [
    /去死|死全家|废物东西|傻逼|脑残|畜生/i,
    /\bkill yourself\b|\bstupid bitch\b|\bfucking idiot\b/i,
  ],
  violence: [
    /炸药出售|枪支代购|代开枪|雇凶|制作炸弹/i,
    /\bbuy (?:a )?gun\b|\bbuild a bomb\b/i,
  ],
  illegalGoods: [
    /代开发票|出售驾照|银行卡四件套|黑卡|走私药|冰毒|大麻出售/i,
    /\bfake passport\b|\bcounterfeit id\b/i,
  ],
  maliciousLink: [
    /\b(?:grabify|iplogger|bit\.ly|tinyurl\.com|ouo\.io|cutt\.ly)\b/i,
    /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/i,
    /\bdiscord\.gift\/[a-z0-9]{6,}\b/i,
  ],
} as const;

export const moderationReviewPatterns = {
  sensitiveReview: [
    /私聊我|联系我拿资料|加群获取|进群领取|点链接查看完整内容/i,
    /\bwhatsapp\b|\bt\.me\/\b|\btelegram\b|\bwechat\b/i,
    /\breferral\b|\bpromo code\b|\bclaim now\b/i,
  ],
  personalInfo: [
    /1[3-9]\d{9}/,
    /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
    /\b(?:discord|telegram|wechat|qq)[:：]?\s*[a-z0-9_-]{4,}\b/i,
  ],
} as const;

export const moderationAllowlistPatterns = [
  /\bAR\b/i,
  /\bAI\b/i,
  /\bXR\b/i,
  /\bglasses\b/i,
  /\bsmart glasses\b/i,
  /\bcrypto\b/i,
  /\btrading\b/i,
];

