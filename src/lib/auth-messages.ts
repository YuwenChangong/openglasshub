export type AuthLocale = "zh-CN" | "en";

export interface AuthMessages {
  loginHeading: string;
  signupHeading: string;
  email: string;
  password: string;
  newPassword: string;
  confirmPassword: string;
  login: string;
  signup: string;
  signupNoticeLead: string;
  signupNoticeTerms: string;
  signupNoticePrivacyLead: string;
  signupNoticePrivacy: string;
  signupNoticeGuidelinesLead: string;
  signupNoticeGuidelines: string;
  consentSentence: string;
  terms: string;
  privacy: string;
  guidelines: string;
  legalJoin: string;
  privacyLead: string;
  consentEnd: string;
  pendingCheckInbox: string;
  resend: string;
  requestReset: string;
  updatePassword: string;
  retry: string;
  logout: string;
  invalidCredentials: string;
  unavailable: string;
  expiredRecovery: string;
  eligibility(minimumAge: number): string;
  cooldown(seconds: number): string;
  legalRequired: string;
  consentHeading: string;
  confirmContinue: string;
  recording: string;
  checkingAuth: string;
  checkingConsent: string;
  checkingRecovery: string;
  redirecting: string;
  signedIn: string;
  signedOutConsent: string;
  goToLogin: string;
  myProfile: string;
  editProfile: string;
  continue: string;
  processing: string;
  sending: string;
  updating: string;
  switchToLogin: string;
  switchToSignup: string;
  backToLogin: string;
  forgotPassword: string;
  resetHeading: string;
  resetIntro: string;
  resetSuccess: string;
  resetMismatch: string;
  resetEmpty: string;
  shortPassword: string;
  resetFailed: string;
  resetRequestFailed: string;
  resendFailed: string;
  resendLimit: string;
  emailUnconfirmed: string;
  accountMayExist: string;
  callbackHeading: string;
  callbackPending: string;
  callbackWaiting: string;
  callbackMissing: string;
  callbackFailed: string;
  consentUnavailable: string;
  consentExpired: string;
  consentRateLimited: string;
  consentTimedOut: string;
  navigationFailed: string;
  configurationUnavailable: string;
}

const messages: Record<AuthLocale, AuthMessages> = {
  "zh-CN": {
    signupNoticeLead: "注册即表示你同意", signupNoticeTerms: "《服务条款》", signupNoticePrivacyLead: "，并已阅读", signupNoticePrivacy: "《隐私政策》", signupNoticeGuidelinesLead: "和", signupNoticeGuidelines: "《社区准则》",
    loginHeading: "登录", signupHeading: "注册", email: "邮箱", password: "密码", newPassword: "新密码", confirmPassword: "确认新密码",
    login: "登录", signup: "注册", consentSentence: "我已阅读并同意", terms: "服务条款", privacy: "隐私政策", guidelines: "社区准则",
    legalJoin: "和", privacyLead: "，并已阅读并知悉", consentEnd: "。", pendingCheckInbox: "如已提出请求，请检查邮箱及垃圾箱。",
    resend: "重新发送验证邮件", requestReset: "发送重置邮件", updatePassword: "更新密码", retry: "重试", logout: "退出登录",
    invalidCredentials: "邮箱或密码错误。", unavailable: "暂时无法完成请求，请稍后重试。", expiredRecovery: "重置链接无效或已过期，请重新发起忘记密码流程。",
    eligibility: (minimumAge) => `我确认已满 ${minimumAge} 周岁。`, cooldown: (seconds) => `${seconds} 秒后可重新发送`,
    legalRequired: "请分别确认年龄资格及政策条款后继续。", consentHeading: "政策确认", confirmContinue: "确认并继续", recording: "正在记录确认...",
    checkingAuth: "正在检查登录状态...", checkingConsent: "正在检查政策确认状态...", checkingRecovery: "正在验证重置会话...", redirecting: "正在前往目标页面...",
    signedIn: "当前已登录。", signedOutConsent: "登录后才能记录政策确认。", goToLogin: "前往登录", myProfile: "我的主页", editProfile: "编辑资料", continue: "继续前往",
    processing: "处理中...", sending: "发送中...", updating: "更新中...", switchToLogin: "切换到登录", switchToSignup: "切换到注册", backToLogin: "返回登录",
    forgotPassword: "忘记密码？", resetHeading: "重置密码", resetIntro: "请设置新密码。", resetSuccess: "密码已更新，请重新登录。", resetMismatch: "两次输入的密码不一致。",
    resetEmpty: "新密码不能为空。", shortPassword: "密码长度至少为 8 位。", resetFailed: "更新密码失败，请重新进入邮件中的链接后再试。",
    resetRequestFailed: "暂时无法请求重置邮件，请稍后再试。", resendFailed: "暂时无法重新请求验证邮件，请稍后再试。", resendLimit: "今天请求次数已达上限，请明天再试。",
    emailUnconfirmed: "请先完成邮箱验证后再登录。", accountMayExist: "如果账号已存在，请登录或重新请求验证邮件。",
    callbackHeading: "确认登录", callbackPending: "正在完成登录确认...", callbackWaiting: "仍在等待会话建立。请稍候或重新打开确认链接。",
    callbackMissing: "当前还没有建立登录会话，请稍候或重新打开确认链接。", callbackFailed: "登录确认失败。",
    consentUnavailable: "暂时无法记录政策确认。请稍后重试，或退出后重新登录。", consentExpired: "登录状态已失效，请重新登录后继续。",
    consentRateLimited: "操作过于频繁，请稍后再试。", consentTimedOut: "检查或记录政策确认超时，请重试或退出后重新登录。",
    navigationFailed: "暂时无法前往目标页面，请重试或退出后重新登录。", configurationUnavailable: "登录服务暂不可用，请稍后重试。",
  },
  en: {
    signupNoticeLead: "By signing up, you agree to the ", signupNoticeTerms: "Terms of Service", signupNoticePrivacyLead: " and have read the ", signupNoticePrivacy: "Privacy Policy", signupNoticeGuidelinesLead: " and ", signupNoticeGuidelines: "Community Guidelines",
    loginHeading: "Log in", signupHeading: "Sign up", email: "Email", password: "Password", newPassword: "New password", confirmPassword: "Confirm password",
    login: "Log in", signup: "Sign up", consentSentence: "I have read and agree to the", terms: "Terms of Service", privacy: "Privacy Policy", guidelines: "Community Guidelines",
    legalJoin: "and the", privacyLead: ", and have read and acknowledge the", consentEnd: ".", pendingCheckInbox: "If you made a request, check your inbox and spam folder.",
    resend: "Request another verification email", requestReset: "Request reset email", updatePassword: "Update password", retry: "Retry", logout: "Log out",
    invalidCredentials: "Incorrect email or password.", unavailable: "Unable to complete the request. Please try again later.", expiredRecovery: "This reset link is invalid or expired. Request a new one.",
    eligibility: (minimumAge) => `I confirm I am at least ${minimumAge} years old.`, cooldown: (seconds) => `Try again in ${seconds}s`,
    legalRequired: "Confirm your age eligibility and the policies to continue.", consentHeading: "Policy confirmation", confirmContinue: "Confirm and continue", recording: "Recording confirmation...",
    checkingAuth: "Checking sign-in status...", checkingConsent: "Checking policy confirmation...", checkingRecovery: "Checking reset session...", redirecting: "Opening your destination...",
    signedIn: "You are signed in.", signedOutConsent: "Log in to confirm the policies.", goToLogin: "Go to login", myProfile: "My profile", editProfile: "Edit profile", continue: "Continue",
    processing: "Processing...", sending: "Requesting...", updating: "Updating...", switchToLogin: "Switch to login", switchToSignup: "Switch to sign up", backToLogin: "Back to login",
    forgotPassword: "Forgot password?", resetHeading: "Reset password", resetIntro: "Set a new password.", resetSuccess: "Password updated. Log in again.", resetMismatch: "Passwords do not match.",
    resetEmpty: "Enter a new password.", shortPassword: "Password must be at least 8 characters.", resetFailed: "Could not update your password. Open a new reset link and try again.",
    resetRequestFailed: "Could not request a reset email. Please try again later.", resendFailed: "Could not request another verification email. Please try later.", resendLimit: "Today's request limit has been reached. Try tomorrow.",
    emailUnconfirmed: "Verify your email before logging in.", accountMayExist: "If the account exists, log in or request another verification email.",
    callbackHeading: "Confirming login", callbackPending: "Completing login confirmation...", callbackWaiting: "Still waiting for a session. Please wait or reopen the confirmation link.",
    callbackMissing: "No login session is available yet. Please wait or reopen the confirmation link.", callbackFailed: "Login confirmation failed.",
    consentUnavailable: "Could not record policy confirmation. Retry or log out and log in again.", consentExpired: "Your session expired. Log in again to continue.",
    consentRateLimited: "Too many requests. Please try later.", consentTimedOut: "Policy confirmation timed out. Retry or log in again.",
    navigationFailed: "Could not open the destination. Retry or log in again.", configurationUnavailable: "Login is temporarily unavailable. Please try later.",
  },
};

export function getAuthMessages(locale: AuthLocale): AuthMessages {
  return messages[locale];
}
