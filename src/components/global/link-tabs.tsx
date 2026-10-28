"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type LinkTab = { href: string; label: ReactNode; active: boolean };

// A capsule tab strip (the look of shadcn's TabsList / TabsTrigger) made of plain links with `aria-current`.
// Not Radix Tabs: `TabsTrigger asChild` + `next/link` fails to slot on client-side navigation (see the portal's
// note in its CLAUDE.md), and each tab here is a route of its own.
export function LinkTabs({ label, tabs, className }: { label: string; tabs: LinkTab[]; className?: string }) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "inline-flex h-9 w-fit max-w-full items-center overflow-x-auto rounded-lg bg-muted p-[3px] text-muted-foreground",
        className
      )}
    >
      {tabs.map((tab, i) => (
        <Link
          key={i}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "inline-flex h-[calc(100%-1px)] items-center justify-center rounded-md border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors hover:text-foreground focus-visible:outline-1 focus-visible:outline-ring",
            tab.active && "border-border bg-background text-foreground dark:border-input dark:bg-input/30"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
