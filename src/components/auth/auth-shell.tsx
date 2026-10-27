import type { ReactNode } from "react";

import { Icons } from "@/components/global/icons";
import { LanguageSwitcher } from "@/components/global/language-switcher";
import { ModeToggle } from "@/components/global/mode-toggle";

// Frame of the public self-service pages (forgot / reset / accept invite): language + theme toggles in the
// corner (no other chrome to hang them on), the logo and the page's card, centred on the grid backdrop of
// `app/auth/layout.tsx`. The sign-in page keeps its own Globe layout.
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div className="absolute top-4 right-4 z-20 flex gap-2">
        <LanguageSwitcher />
        <ModeToggle />
      </div>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-12">
        <Icons.logo className="size-16" />
        {children}
      </div>
    </div>
  );
}
