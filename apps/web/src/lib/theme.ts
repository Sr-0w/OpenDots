import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem("od-theme", theme);
  } catch {
    // stockage indisponible
  }
  for (const l of listeners) l();
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    current,
  );
  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
