import { useMemo, useState } from "react";
import { resolveLocale, type LocaleContext } from "../../lib/i18n/locale";
import { useLocale } from "../i18n/useLocale";

interface SharePostButtonProps {
  localeContext?: LocaleContext;
  postPath: string;
}

export default function SharePostButton({ postPath, localeContext = resolveLocale({ acceptLanguage: "zh-CN" }) }: SharePostButtonProps) {
  const { messages } = useLocale(localeContext);
  const text = messages.community;
  const [copied, setCopied] = useState(false);

  const absoluteUrl = useMemo(() => {
    if (typeof window === "undefined") return postPath;
    return new URL(postPath, window.location.origin).toString();
  }, [postPath]);

  async function handleCopy() {
    const textToCopy = absoluteUrl;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
      return;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = textToCopy;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      } catch {
        setCopied(false);
      }
    }
  }

  return (
    <button type="button" className="community-action-button" onClick={handleCopy} title={absoluteUrl}>
      {copied ? text.copied : text.share}
    </button>
  );
}
