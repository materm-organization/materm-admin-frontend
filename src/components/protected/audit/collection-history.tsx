"use client";

import { HistoryIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntityAuditLogs } from "@/hooks/use-audit";
import { isNoPermissionError } from "@/lib/api-error";

// The three entity types whose History is a COLLECTION tab: `entity_id=0` means "every row of this type" (the backend accepts 0
// for exactly these three; `read` on the entity's own permission key is enough). `cms.ui_string` also holds the bundle syncs.
export type CollectionHistoryType = "cms.locale" | "cms.ui_string" | "cms.ui_strings_bundle";

// i18n keys cannot hold dots (next-intl reads them as nesting).
const LABEL_KEY = { "cms.locale": "locale", "cms.ui_string": "uiString", "cms.ui_strings_bundle": "bundle" } as const;

// Action, time, actor and summary of the trail, exactly as the server returns it. Nothing is filtered on the client (no entity_id / key
// filter) and the request carries nothing but the tab shape, so a reader of the entity (without `ops.audit:read`) is not refused.
export function CollectionHistory({ entityType, limit = 20 }: { entityType: CollectionHistoryType; limit?: number }) {
  const t = useTranslations("audit.collection");
  const format = useFormatter();
  const { data, isLoading, error, refetch, isFetching } = useEntityAuditLogs({ entity_type: entityType, entity_id: 0, limit });

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (error && isNoPermissionError(error)) return <NoPermission className="min-h-40 py-8" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} className="min-h-40 py-8" />;

  const rows = data?.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <ul className="divide-y rounded-md border text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span>
            <span className="font-mono text-xs">{row.action}</span>
            {row.summary ? <span className="text-muted-foreground"> — {row.summary}</span> : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.actor_name ?? "—"} · {format.dateTime(new Date(row.occurred_at), { dateStyle: "medium", timeStyle: "short" })}
          </span>
        </li>
      ))}
    </ul>
  );
}

// A "History" button that opens the trail in a side sheet (the list pages have no tabs). Nothing is requested before it is opened.
export function CollectionHistorySheet({ entityType }: { entityType: CollectionHistoryType }) {
  const t = useTranslations("audit.collection");
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline">
          <HistoryIcon /> {t("button")}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t(`title.${LABEL_KEY[entityType]}`)}</SheetTitle>
          <SheetDescription>{t(`description.${LABEL_KEY[entityType]}`)}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">{open ? <CollectionHistory entityType={entityType} /> : null}</div>
      </SheetContent>
    </Sheet>
  );
}
