import { useSyncExternalStore } from "react";
import { EN } from "./i18n-en";

/**
 * Internationalisation minimale : le texte français sert de clé, le
 * dictionnaire anglais le traduit. Les variables s'écrivent {nom}.
 */
export type Lang = "fr" | "en";
export type LangSetting = Lang | "auto";

const KEY = "od-lang";
const listeners = new Set<() => void>();

function detect(): Lang {
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

function readSetting(): LangSetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === "fr" || v === "en" ? v : "auto";
  } catch {
    return "auto";
  }
}

let setting: LangSetting = readSetting();
let lang: Lang = setting === "auto" ? detect() : setting;
document.documentElement.lang = lang;

export function getLang(): Lang {
  return lang;
}

export function getLangSetting(): LangSetting {
  return setting;
}

export function setLang(next: LangSetting) {
  setting = next;
  try {
    if (next === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // stockage indisponible
  }
  lang = next === "auto" ? detect() : next;
  document.documentElement.lang = lang;
  for (const l of listeners) l();
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lang,
  );
}

export function t(fr: string, vars?: Record<string, string | number | null | undefined>): string {
  const base = lang === "en" ? (EN[fr] ?? fr) : fr;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/** Locale à utiliser pour les dates et nombres. */
export function locale(): string {
  return lang === "en" ? "en-GB" : "fr-FR";
}
