import { MoonIcon, SunIcon } from "lucide-react";

// Pure-CSS cross-fade: both icons are always mounted, `dark:` utilities
// animate the swap instead of popping. Shared by the
// standalone `<ModeToggle />` and the authenticated shell's dropdown item so
// the animation markup only lives in one place.
export function ThemeToggleIcon() {
  return (
    <>
      <SunIcon className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </>
  );
}
