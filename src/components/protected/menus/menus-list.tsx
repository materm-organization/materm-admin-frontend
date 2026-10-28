"use client";

import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMenus } from "@/hooks/use-menus";
import { isNoPermissionError } from "@/lib/api-error";

// SCR-17: the three system menus as cards (item count, last change). Creating / deleting menus is P3 and system
// menus can not be deleted (BR-18), so there is no button for either.
export function MenusList() {
  const t = useTranslations("menus");
  const format = useFormatter();
  const { data, error, isLoading, refetch, isFetching } = useMenus();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-wide">{t("title")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t("description")}</p>
      </div>
      {error && isNoPermissionError(error) ? (
        <NoPermission />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} />
      ) : isLoading || !data ? (
        <div className="grid gap-4 md:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-3">
          {data.data.map((menu) => (
            <li key={menu.key}>
              <Link href={`/admin/menus/${menu.key}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
                <Card className="h-full transition-colors hover:bg-accent/40">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      <span>{t.has(`names.${menu.key}`) ? t(`names.${menu.key}`) : menu.name}</span>
                      <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                    </CardTitle>
                    <CardDescription>{t.has(`descriptions.${menu.key}`) ? t(`descriptions.${menu.key}`) : menu.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{t("itemCount", { count: menu.item_count })}</Badge>
                      {menu.visible_item_count < menu.item_count ? (
                        <Badge variant="outline">{t("hiddenCount", { count: menu.item_count - menu.visible_item_count })}</Badge>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground">
                      {t("updated", { when: format.dateTime(new Date(menu.updated_at), { dateStyle: "medium", timeStyle: "short" }) })}
                      {menu.updated_by?.name ? ` · ${menu.updated_by.name}` : ""}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
