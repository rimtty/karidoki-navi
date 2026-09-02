export type AuthAction = "login" | "signup" | "oauth" | "callback" | "logout";

type AuthErrorLike = {
  code?: string | null;
  message?: string | null;
};

const COMMON_MESSAGES: Record<string, string> = {
  email_address_invalid: "メールアドレスの形式を確認してください。",
  email_not_confirmed:
    "メールアドレスの確認が完了していません。受信した確認メールをご確認ください。",
  invalid_credentials: "メールアドレスまたはパスワードが正しくありません。",
  over_email_send_rate_limit:
    "確認メールの送信回数が上限に達しました。しばらく待ってからお試しください。",
  over_request_rate_limit:
    "試行回数が多すぎます。しばらく待ってからもう一度お試しください。",
  provider_disabled:
    "Googleログインは現在利用できません。メールアドレスでお試しください。",
  signup_disabled: "現在、新規登録を受け付けていません。",
  weak_password: "パスワードが安全ではありません。6文字以上で設定してください。",
  user_already_exists:
    "このメールアドレスはすでに登録されています。ログインしてください。",
  flow_state_expired:
    "認証の有効期限が切れました。もう一度ログインをお試しください。",
  bad_oauth_callback:
    "Googleログインを完了できませんでした。もう一度お試しください。",
  missing_config:
    "認証サービスの設定が未完了です。管理者が設定を確認してください。",
  missing_code: "認証情報を受け取れませんでした。もう一度ログインをお試しください。",
  callback_failed: "認証を完了できませんでした。もう一度ログインをお試しください。",
  validation_failed: "入力内容を確認してください。",
};

const MESSAGE_HINTS: Array<[string, string]> = [
  ["invalid login credentials", COMMON_MESSAGES.invalid_credentials],
  ["email not confirmed", COMMON_MESSAGES.email_not_confirmed],
  ["already registered", COMMON_MESSAGES.user_already_exists],
  ["user already registered", COMMON_MESSAGES.user_already_exists],
  ["password should be at least", COMMON_MESSAGES.weak_password],
  ["password is too weak", COMMON_MESSAGES.weak_password],
  ["provider is not enabled", COMMON_MESSAGES.provider_disabled],
  ["provider is disabled", COMMON_MESSAGES.provider_disabled],
  ["redirect url is not allowed", COMMON_MESSAGES.bad_oauth_callback],
  ["flow state", COMMON_MESSAGES.flow_state_expired],
  ["rate limit", COMMON_MESSAGES.over_request_rate_limit],
];

const FALLBACK_MESSAGES: Record<AuthAction, string> = {
  login: "ログインできませんでした。入力内容を確認して、もう一度お試しください。",
  signup:
    "新規登録できませんでした。入力内容を確認して、もう一度お試しください。",
  oauth:
    "Googleログインを開始できませんでした。メールアドレスでのログインもお試しください。",
  callback: "認証を完了できませんでした。もう一度ログインをお試しください。",
  logout: "ログアウトできませんでした。もう一度お試しください。",
};

export function getAuthErrorMessage(
  error: AuthErrorLike | null | undefined,
  action: AuthAction,
): string {
  if (!error) {
    return FALLBACK_MESSAGES[action];
  }

  const code = error.code?.toLowerCase();
  if (code && COMMON_MESSAGES[code]) {
    return COMMON_MESSAGES[code];
  }

  const message = error.message?.toLowerCase() ?? "";
  const hintedMessage = MESSAGE_HINTS.find(([hint]) => message.includes(hint));
  return hintedMessage?.[1] ?? FALLBACK_MESSAGES[action];
}

export function getAuthCallbackErrorMessage(code: string | null): string {
  return getAuthErrorMessage({ code }, "callback");
}
