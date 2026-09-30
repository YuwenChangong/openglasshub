export type TurnstileWidgetId = string | number;

export interface TurnstileOptions {
  sitekey: string;
  size?: "normal" | "compact" | "invisible" | "flexible";
  theme?: "auto" | "light" | "dark";
  appearance?: "always" | "execute" | "interaction-only";
  execution?: "render" | "execute";
  "response-field"?: boolean;
  callback?: (token: string) => void;
  "error-callback"?: (code: string) => void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  "unsupported-callback"?: () => void;
}

export interface TurnstileApi {
  render(container: string | HTMLElement, options: TurnstileOptions): TurnstileWidgetId;
  reset(widgetId?: TurnstileWidgetId): void;
  execute?(widgetId?: TurnstileWidgetId): void;
  remove(widgetId: TurnstileWidgetId): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
