/// <reference types="astro/client" />
import type { LocaleContext } from "./lib/i18n/locale";

declare global {
  namespace App {
    interface Locals { localeContext: LocaleContext }
  }
}
