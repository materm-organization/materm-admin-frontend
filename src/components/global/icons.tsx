import Image from "next/image";

import { cn } from "@/lib/utils";

// Small dedicated brand/vector-icon map — kept separate from direct
// lucide-react imports so it's obvious at a glance which icons are "system"
// icons vs. one-off brand assets. Only the app logo is needed today.
//
// The Materm logo (mark + wordmark) is the same artwork as the portal's
// `materm-logo-white.svg`. An SVG used through <img> cannot follow the theme, so there are two files and the
// `dark:` variant switches between them.
export const Icons = {
  logo: ({ className }: { className?: string }) => (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)}>
      <Image
        src="/brand/materm-logo-dark.svg"
        alt=""
        width={286}
        height={230}
        unoptimized
        priority
        className="block size-full object-contain dark:hidden"
      />
      <Image
        src="/brand/materm-logo-white.svg"
        alt=""
        width={286}
        height={230}
        unoptimized
        priority
        className="hidden size-full object-contain dark:block"
      />
    </span>
  ),
};
