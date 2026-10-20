import { SignInForm } from "@/components/auth/signin-form";
import { LanguageSwitcher } from "@/components/global/language-switcher";
import { ModeToggle } from "@/components/global/mode-toggle";
import AnimationContainer from "@/components/global/animation-container";
import { Icons } from "@/components/global/icons";
import { Globe } from "@/components/ui/globe";

// Public page, outside the `(protected)` route group (Globe backdrop + logo
// + animated card) — see `src/app/auth/layout.tsx` for the grid background
// it sits on. Standalone theme + language toggles kept in the corner — no
// other chrome to hang them off.
export default function SignInPage() {
  return (
    <div className="relative">
      {/* Absolutely positioned overlay, not a flex sibling — the div below
          is kept separate so its layout math (and therefore the
          Card's width) isn't perturbed by the extra toggles. */}
      <div className="absolute right-4 top-4 z-20 flex gap-2">
        <LanguageSwitcher />
        <ModeToggle />
      </div>
      <div className="flex flex-col items-start max-w-sm mx-auto h-dvh overflow-hidden md:pt-20">
        <Globe />
        <AnimationContainer className="w-full justify-center flex flex-col items-center space-y-2">
          <Icons.logo className="w-16 h-16" />
          <SignInForm />
        </AnimationContainer>
      </div>
    </div>
  );
}
