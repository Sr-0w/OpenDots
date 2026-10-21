import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { locale, t } from "./i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 45) return t("à l’instant");
  if (diff < 3600) return t("il y a {n} min", { n: Math.round(diff / 60) });
  const sameDay = new Date().toDateString() === d.toDateString();
  if (sameDay) return d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  if (diff < 6 * 86400) return d.toLocaleDateString(locale(), { weekday: "short" });
  return d.toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
}

/** Aperçu texte brut d'un message Markdown. */
export function plainPreview(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>~]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
