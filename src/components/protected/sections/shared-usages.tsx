"use client";

import { AlertTriangleIcon, EyeIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { StatusBadge } from "@/components/global/status/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useSharedSectionUsages } from "@/hooks/use-shared-sections";
import { useCan } from "@/hooks/use-permission";
import { isNoPermissionError } from "@/lib/api-error";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { SharedSectionReference, SharedSectionUsages, SharedUsagePage } from "@/types/shared-sections";

// The pages that use a shared section (05 18.7), as the reader thinks of them: title, address, state of the page, whether the section is in its live rows
// and / or its unpublished draft, hidden or not, in the trash. The link to the page editor needs `cms.pages:read` (the list itself needs only `cms.sections:read`).
export function SharedUsageList({ usages, onPreview }: { usages: SharedSectionUsages; onPreview?: (pageId: number) => void }) {
  const t = useTranslations("sharedSections.usages");
  const canOpenPages = useCan(PERMISSION_KEYS.CMS_PAGES, PERMISSION_ACTIONS.READ);
  // SS-20: "Preview in this page" = the ordinary page preview link (`cms.pages:read` and `update` or `review`); the page must not be in the trash.
  const canPreviewPages = useCan(PERMISSION_KEYS.CMS_PAGES, [PERMISSION_ACTIONS.UPDATE, PERMISSION_ACTIONS.REVIEW]) && canOpenPages;
  if (usages.pages.length === 0) return <p className="text-sm text-muted-foreground" data-testid="usages-empty">{t("empty")}</p>;
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-md border text-sm" data-testid="usage-list">
        {usages.pages.map((p) => (
          <UsageRow key={p.page_id} page={p} canOpen={canOpenPages} onPreview={onPreview && canPreviewPages && !p.deleted_at ? onPreview : undefined} />
        ))}
      </ul>
      {usages.truncated ? <p className="text-xs text-muted-foreground">{t("truncated", { shown: usages.pages.length, total: usages.total_pages })}</p> : null}
    </div>
  );
}

function UsageRow({ page, canOpen, onPreview }: { page: SharedUsagePage; canOpen: boolean; onPreview?: (pageId: number) => void }) {
  const t = useTranslations("sharedSections.usages");
  const title = page.title ?? `#${page.page_id}`;
  const live = page.sections.filter((s) => s.where === "live");
  const draft = page.sections.filter((s) => s.where === "draft");
  const hidden = page.sections.some((s) => !s.is_visible);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 px-3 py-2" data-testid={`usage-page-${page.page_id}`}>
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {canOpen && !page.deleted_at ? (
            <Link href={`/admin/pages/${page.page_id}`} className="underline-offset-4 hover:underline">{title}</Link>
          ) : (
            <span>{title}</span>
          )}
          <span className="font-mono text-xs font-normal text-muted-foreground">{page.path}</span>
        </p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {live.length > 0 ? <span>{t("inLive", { count: live.length })}</span> : null}
          {draft.length > 0 ? <span>{t("inDraft", { count: draft.length })}</span> : null}
          {hidden ? <Badge variant="secondary" className="text-[10px]">{t("hidden")}</Badge> : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={page.status} hasUnpublishedChanges={page.has_unpublished_changes} trashed={Boolean(page.deleted_at)} />
        {page.live_on_site ? <Badge variant="outline" className="text-[10px]" data-testid="live-on-site">{t("liveOnSite")}</Badge> : null}
        {onPreview ? (
          <Button type="button" variant="outline" size="sm" data-testid={`preview-in-page-${page.page_id}`} onClick={() => onPreview(page.page_id)}>
            <EyeIcon />
            {t("previewInPage")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

// Loads the usages of one shared section; used by the Usage tab, the sheet of the list and the confirmations.
export function SharedUsages({ id, onPreview }: { id: number; onPreview?: (pageId: number) => void }) {
  const t = useTranslations("sharedSections.usages");
  const query = useSharedSectionUsages(id);
  if (query.isPending) return <Skeleton className="h-24 w-full" />;
  if (query.error && isNoPermissionError(query.error)) return <NoPermission className="min-h-40 py-8" />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} className="min-h-40 py-8" />;
  return (
    <div className="space-y-2">
      {onPreview && query.data.data.pages.length === 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="preview-none">
          <Button type="button" variant="outline" size="sm" disabled>
            <EyeIcon />
            {t("previewInPage")}
          </Button>
          {t("previewNone")}
        </div>
      ) : null}
      <SharedUsageList usages={query.data.data} onPreview={onPreview} />
    </div>
  );
}

// "Used in N pages" of the list: opens this sheet (05 18.7).
export function SharedUsagesSheet({ section, open, onOpenChange }: { section: { id: number; name: string } | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("sharedSections.usages");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="usages-sheet">
        <SheetHeader>
          <SheetTitle>{t("sheetTitle", { name: section?.name ?? "" })}</SheetTitle>
          <SheetDescription>{t("sheetDescription")}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">{section ? <SharedUsages id={section.id} /> : null}</div>
      </SheetContent>
    </Sheet>
  );
}

// Inside the publish confirmation (doc/07 3.14): the change reaches every page that shows the section.
export function SharedPublishExtra({ id }: { id: number }) {
  const t = useTranslations("sharedSections.confirm");
  const query = useSharedSectionUsages(id);
  if (query.isPending) return <Skeleton className="h-10 w-full" />;
  if (query.error) return null;
  const live = query.data.data.pages.filter((p) => p.live_on_site);
  return (
    <section className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm" data-testid="publish-shared-extra">
      <h3 className="font-semibold">{t("publishTitle", { count: live.length })}</h3>
      {live.length > 0 ? (
        <ul className="list-disc space-y-0.5 ps-5" data-testid="publish-shared-pages">
          {live.map((p) => (
            <li key={p.page_id}>{p.title ?? `#${p.page_id}`} <span className="font-mono text-xs text-muted-foreground">{p.path}</span></li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t("publishNone")}</p>
      )}
    </section>
  );
}

// Inside the unpublish confirmation (SS-4): who loses the section on the website, and that those pages can not be published until it is back.
// The confirm button is always available (unpublish never fails because of references).
export function SharedUnpublishExtra({ id }: { id: number }) {
  const t = useTranslations("sharedSections.confirm");
  const query = useSharedSectionUsages(id);
  if (query.isPending) return <Skeleton className="h-10 w-full" />;
  if (query.error) return null;
  const live = query.data.data.pages.filter((p) => p.live_on_site);
  const all = query.data.data.pages.filter((p) => !p.deleted_at);
  if (all.length === 0) return <div className="text-sm" data-testid="unpublish-shared-none">{t("unpublishNone")}</div>;
  return (
    <div className="space-y-1 text-sm" data-testid="unpublish-shared-extra">
      <div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200">
        <AlertTriangleIcon className="size-4" aria-hidden />
        {t("unpublishTitle", { count: live.length })}
      </div>
      {live.length > 0 ? (
        <div>
          <ul className="list-disc space-y-0.5 ps-5" data-testid="unpublish-shared-pages">
            {live.map((p) => (
              <li key={p.page_id}>{p.title ?? `#${p.page_id}`} <span className="font-mono text-xs">{p.path}</span></li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-muted-foreground">{t("unpublishBlocked")}</p>
    </div>
  );
}

// The rows of the 409 `ENTITY_REFERENCED` (`shared_section_in_use`, 05 18.6) of a delete. A page in the trash has to be restored first.
export function SharedReferencesList({ references, total }: { references: SharedSectionReference[]; total: number }) {
  const t = useTranslations("sharedSections.delete.blocked");
  const canOpenPages = useCan(PERMISSION_KEYS.CMS_PAGES, PERMISSION_ACTIONS.READ);
  return (
    <div className="space-y-2">
      <ul className="max-h-60 list-disc space-y-1 overflow-y-auto ps-5 text-sm" data-testid="references-list">
        {references.map((r, i) => (
          <li key={`${r.id}-${r.kind}-${r.section_id}-${i}`} data-testid="reference-row">
            {canOpenPages && !r.page_trashed ? (
              <Link href={`/admin/pages/${r.id}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 underline underline-offset-2">
                {r.title ?? `#${r.id}`}
                <ExternalLinkIcon className="size-3" aria-hidden />
              </Link>
            ) : (
              <span>{r.title ?? `#${r.id}`}</span>
            )}{" "}
            <span className="text-muted-foreground">{r.kind === "draft_section_ref" ? t("inDraft") : t("inPage")}</span>
            {r.page_trashed ? <span className="ms-1 text-destructive">{t("pageInTrash")}</span> : null}
          </li>
        ))}
      </ul>
      {total > references.length ? <p className="text-xs text-muted-foreground">{t("more", { count: total - references.length })}</p> : null}
    </div>
  );
}
