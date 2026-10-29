"use client";

import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useCan } from "@/hooks/use-permission";
import { useSubmissionsSummary } from "@/hooks/use-submissions";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { cn } from "@/lib/utils";
import type { NavMainGroupConfig, NavMainSubConfig } from "@/lib/nav-main-items";

// Pure rendering of the already-filtered `items` array — all permission
// filtering happens upstream in AppSidebar via `buildNavMainItemsForUser`.
// Uses `bg-primary/5`/`bg-primary/10` active styling rather than shadcn's
// default `isActive`/`bg-sidebar-accent`. An entry is active for its own URL
// and for every page below it (`/admin/users/5` marks "Users"), judged on a
// whole-segment boundary (`/admin/users-x` does not match `/admin/users`);
// the dashboard `/admin` is the exception and matches EXACTLY, otherwise it
// would be a prefix of every admin URL and highlighted everywhere. A group
// opens by itself when one of its pages becomes active — also on a soft
// navigation — and the user can still collapse/expand it by hand until the
// next navigation. The group label is the literal, untranslated string "Menu".
export function isNavActive(pathname: string, url: string): boolean {
  if (url === "#") return false;
  if (url === "/admin") return pathname === url;
  return pathname === url || pathname.startsWith(`${url}/`);
}

// The count next to the "Messages" entry (doc/07 section 2.1): `GET /submissions/summary` every minute, only for a person who may read
// the inbox; hidden at 0 and while the number is unknown (loading, error), `99+` over 99.
function NavBadge({ query }: { query: NonNullable<NavMainSubConfig["badgeQuery"]> }) {
  const t = useTranslations("nav");
  const allowed = useCan(PERMISSION_KEYS.FORMS_SUBMISSIONS, PERMISSION_ACTIONS.READ);
  const summary = useSubmissionsSummary(allowed);
  const count = summary.data?.new ?? 0;
  if (!allowed || count <= 0) return null;
  return (
    <Badge variant="default" className="ms-auto px-1.5 py-0 text-[10px] font-semibold tabular-nums" data-testid="nav-badge" data-query={query} aria-label={t("newMessages", { count })}>
      {count > 99 ? "99+" : count}
    </Badge>
  );
}

export function NavMain({ items }: { items: NavMainGroupConfig[] }) {
  const t = useTranslations();
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();
  // Icon-rail mode (desktop only — mobile always uses the offcanvas sheet
  // with the full menu). SidebarMenuSub is hidden under
  // `group-data-[collapsible=icon]`, so a parent item's children would be
  // unreachable; those parents render as a flyout DropdownMenu instead.
  const isRail = state === "collapsed" && !isMobile;
  // The longest matching entry wins: `/admin/forms/submissions/5` marks "Messages", not also its URL prefix "Forms".
  const allUrls = items.flatMap((group) => [group.url, ...(group.items ?? []).map((sub) => sub.url)]);
  const isActivePath = (url: string) => isNavActive(pathname, url) && !allUrls.some((other) => other.length > url.length && isNavActive(pathname, other));
  // Hand-made open/closed state per group, dropped for the groups that hold the active page whenever the
  // pathname changes (so navigating INTO a group always opens it).
  const [manual, setManual] = useState<{ path: string; open: Record<string, boolean> }>({
    path: pathname,
    open: {},
  });
  if (manual.path !== pathname) {
    const keep: Record<string, boolean> = {};
    for (const item of items) {
      const holdsActive = (item.items ?? []).some((sub) => isActivePath(sub.url));
      if (!holdsActive && item.title in manual.open) keep[item.title] = manual.open[item.title];
    }
    setManual({ path: pathname, open: keep });
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Menu</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const hasActiveSub = (item.items ?? []).some((sub) => isActivePath(sub.url));
          const isOpen = manual.open[item.title] ?? hasActiveSub;

          if (isRail && item.items?.length) {
            return (
              <SidebarMenuItem key={item.title}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      tooltip={t(item.title)}
                      className={cn(
                        (isActivePath(item.url) || hasActiveSub) && "bg-primary/5 font-medium text-foreground",
                        "hover:text-mute"
                      )}
                    >
                      <item.icon size={17} />
                      <span>{t(item.title)}</span>
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="min-w-48 rounded-lg" side="right" align="start" sideOffset={4}>
                    <DropdownMenuLabel className="text-muted-foreground">{t(item.title)}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {item.items.map((sub) => (
                      <DropdownMenuItem
                        key={sub.url}
                        asChild
                        className={cn(isActivePath(sub.url) && "bg-primary/10 font-medium text-foreground")}
                      >
                        <Link href={sub.url} aria-current={isActivePath(sub.url) ? "page" : undefined}>
                          <span>{t(sub.title)}</span>
                          {sub.badgeQuery ? <NavBadge query={sub.badgeQuery} /> : null}
                          {sub.comingSoon && (
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-medium">
                              {t("common.comingSoon")}
                            </Badge>
                          )}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            );
          }

          return (
            <Collapsible
              key={item.title}
              asChild
              open={isOpen}
              onOpenChange={(next) =>
                setManual((m) => ({ path: m.path, open: { ...m.open, [item.title]: next } }))
              }
              className="group/collapsible"
            >
              <SidebarMenuItem>
                {item.items?.length ? (
                  <>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip={t(item.title)}
                        className={cn(
                          isActivePath(item.url) && "bg-primary/5 font-medium text-foreground",
                          "group hover:text-mute justify-between"
                        )}
                      >
                        <div className="flex flex-row items-center gap-2">
                          <item.icon size={17} />
                          <span>{t(item.title)}</span>
                        </div>
                        <span className="inline-flex shrink-0 transition-transform duration-200 ease-in-out group-data-[state=open]:rotate-90">
                          <ChevronRightIcon size={16} />
                        </span>
                        <span className="sr-only">Toggle menu</span>
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items.map((sub) => (
                          <SidebarMenuSubItem key={sub.url}>
                            <SidebarMenuSubButton
                              asChild
                              className={cn(
                                isActivePath(sub.url) && "bg-primary/10 font-medium text-foreground",
                                "hover:text-mute"
                              )}
                            >
                              <Link href={sub.url} aria-current={isActivePath(sub.url) ? "page" : undefined}>
                                <span>{t(sub.title)}</span>
                                {sub.badgeQuery ? <NavBadge query={sub.badgeQuery} /> : null}
                                {sub.comingSoon && (
                                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-medium">
                                    {t("common.comingSoon")}
                                  </Badge>
                                )}
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </>
                ) : (
                  <SidebarMenuButton
                    asChild
                    tooltip={t(item.title)}
                    className={cn(
                      isActivePath(item.url) && "bg-primary/5 font-medium text-foreground",
                      "hover:text-mute"
                    )}
                  >
                    <Link href={item.url} aria-current={isActivePath(item.url) ? "page" : undefined}>
                      <item.icon size={17} />
                      <span>{t(item.title)}</span>
                      {item.comingSoon && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-medium">
                          {t("common.comingSoon")}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                )}
              </SidebarMenuItem>
            </Collapsible>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
