"use client";

import { useSyncExternalStore } from "react";

import { useTheme } from "next-themes";

import { ThemeToggleIcon } from "@/components/global/theme-toggle-icon";
import { Toggle } from "@/components/ui/toggle";

const noopSubscribe = () => () => {};

// Same `useSyncExternalStore` hydration-safety pattern as
// `useHasAccessToken` (hooks/use-auth.ts): server and the client's first
// hydration pass must agree, so both return `false` here regardless of the
// real mount state — `true` is only observable once React actually commits
// on the client, past hydration.
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

// Standalone toggle entry point for a surface with no other chrome to hang
// it off (e.g. the sign-in page). The authenticated shell uses a
// DropdownMenuItem inside nav-user.tsx instead — never both on the same
// screen.
export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  // next-themes only knows the resolved theme after mount (it reads
  // localStorage/system preference client-side); rendering `pressed` off
  // `theme` directly makes the server's guess ("system" -> not dark) diverge
  // from the client's first real render whenever the stored/system theme is
  // actually dark, which React reports as a hydration mismatch on this
  // button's `aria-pressed`/`data-state`. `useMounted()` keeps `pressed`
  // `false` through hydration on both sides; the flip to the real value
  // happens as a normal post-mount update, not during hydration.
  const mounted = useMounted();

  return (
    <Toggle
      aria-label="Toggle theme"
      className="relative"
      pressed={mounted && theme === "dark"}
      onPressedChange={(pressed) => setTheme(pressed ? "dark" : "light")}
    >
      <ThemeToggleIcon />
    </Toggle>
  );
}
