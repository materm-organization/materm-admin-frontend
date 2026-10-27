"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

import { Fragment } from "react";
import Link from "next/link";

import { useBreadcrumbDetail } from "@/components/layout/breadcrumb-context";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { buildBreadcrumbTrail } from "@/lib/constants/breadcrumb";

// Header: SidebarTrigger + a breadcrumb driven by the same route-config
// pattern as nav-main-items.ts (`Dashboard › Users › <item name>`: every level a link
// except the current one; a detail page names its own level via `useBreadcrumbTitle`).
export function AppHeader() {
  const t = useTranslations();
  const pathname = usePathname();
  const detail = useBreadcrumbDetail();
  const trail = buildBreadcrumbTrail(pathname, detail);

  return (
    // No `border-b` — with `variant="inset"` (see AppSidebar), this header
    // sits inside SidebarInset's own rounded+shadowed card, so a hard
    // divider line would cut across that rounded silhouette. `rounded-t-xl`
    // matches the card's top corners (SidebarInset isn't `overflow-hidden`,
    // so a square header would otherwise poke past the rounded outline);
    // `sticky` + `shadow-xs` are what separate it from scrolled content
    // instead of a border. `h-10` (not `h-14`) and the inner `px-4`-padded
    // wrapper are a deliberate compact-header sizing choice — adjust to
    // taste per project.
    <header className="sticky top-0 z-20 flex h-10 shrink-0 items-center justify-between gap-2 rounded-t-xl bg-background shadow-xs">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        {/* `data-[orientation=vertical]:h-4`, not plain `h-4` — the base
            Separator sets `data-[orientation=vertical]:h-full`, an
            attribute-selector rule that beats a plain `.h-4` class on
            specificity regardless of source order, so an unscoped `h-4`
            here would silently lose and the separator would stretch to the
            header's full height instead of the intended 16px. */}
        <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            {trail.map((crumb, index) => {
              const label = crumb.key ? t(crumb.key) : (crumb.title ?? "");
              return (
                <Fragment key={`${index}-${crumb.href ?? crumb.key ?? crumb.title ?? "item"}`}>
                  {index > 0 ? <BreadcrumbSeparator /> : null}
                  <BreadcrumbItem>
                    {crumb.loading ? (
                      <Skeleton className="h-4 w-[120px]" aria-label={t("common.loading")} />
                    ) : crumb.href ? (
                      <BreadcrumbLink asChild>
                        <Link href={crumb.href}>{label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );
}
