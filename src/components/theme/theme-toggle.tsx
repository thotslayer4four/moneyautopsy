"use client";

import { useSyncExternalStore } from "react";
import { m } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const subscribe = () => () => {};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // resolvedTheme is undefined on the server; render a stable icon until mounted.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const isDark = mounted && resolvedTheme === "dark";

  return (
    <m.button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      whileTap={{ scale: 0.9 }}
      transition={{ duration: 0.15 }}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-border-strong bg-surface text-foreground-secondary transition-colors duration-200 hover:text-foreground"
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </m.button>
  );
}
