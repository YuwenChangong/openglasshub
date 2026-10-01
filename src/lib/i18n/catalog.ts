import type { ResolvedLocale } from "./locale.ts";
import { shellMessages } from "./messages/shell.ts";
import { settingsMessages } from "./messages/settings.ts";
import { accountMessages } from "./messages/account.ts";

type MessageTree = { readonly [key: string]: string | MessageTree };

function argumentsFor(template: string): string[] {
  return [...new Set([...template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]))].sort();
}

function assertParity(left: MessageTree, right: MessageTree, prefix: string): void {
  const keys = Object.keys(left).sort();
  if (keys.join("\0") !== Object.keys(right).sort().join("\0")) {
    throw new Error(`UI message key mismatch: ${prefix}`);
  }
  for (const key of keys) {
    const a = left[key];
    const b = right[key];
    if (typeof a === "string" && typeof b === "string") {
      if (argumentsFor(a).join("\0") !== argumentsFor(b).join("\0")) {
        throw new Error(`UI message argument mismatch: ${prefix}.${key}`);
      }
    } else if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
      assertParity(a, b, `${prefix}.${key}`);
    } else {
      throw new Error(`UI message key type mismatch: ${prefix}.${key}`);
    }
  }
}

export function defineUiMessages<T extends Record<ResolvedLocale, MessageTree>>(messages: T): T {
  assertParity(messages["zh-CN"], messages.en, "ui");
  return messages;
}

const messages = defineUiMessages({
  "zh-CN": { shell: shellMessages["zh-CN"], settings: settingsMessages["zh-CN"], account: accountMessages["zh-CN"] },
  en: { shell: shellMessages.en, settings: settingsMessages.en, account: accountMessages.en },
});

export function getUiMessages(locale: ResolvedLocale) {
  if (locale !== "zh-CN" && locale !== "en") throw new RangeError("Unsupported UI locale");
  return messages[locale];
}

export function formatUiMessage(template: string, args: Record<string, string | number>): string {
  if (argumentsFor(template).join("\0") !== Object.keys(args).sort().join("\0")) {
    throw new Error("UI message argument mismatch");
  }
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, key: string) => String(args[key]));
}
