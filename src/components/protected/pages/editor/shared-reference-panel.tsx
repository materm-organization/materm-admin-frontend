"use client";

import { AlertTriangleIcon, EyeOffIcon, ExternalLinkIcon, Link2Icon, UnlinkIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ErrorState } from "@/components/global/states/error-state";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { StatusBadge } from "@/components/global/status/status-badge";
import { SchemaForm } from "@/components/schema-form/schema-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useSectionType } from "@/hooks/use-section-types";
import { useSharedSection } from "@/hooks/use-shared-sections";
import type { usePageWrites } from "@/hooks/use-page-sections";
import { isConflictError } from "@/lib/api-error";
import type { Locale } from "@/types/locales";
import type { SectionSummary } from "@/types/pages";

const NO_CHANGE = () => undefined;

// SCR-20 (doc/07 3.14, 05 18.9): the right side for a section that REFERENCES a shared section. It never mounts `SectionEditor` (the page section has no
// props or variant of its own: a PATCH of them is a 422 `not_applicable`). It shows the shared section's working copy READ ONLY, the visibility switch
// (the only thing of the reference that can change), "Edit source" (SCR-22 in a new tab) and "Detach to a copy". Nothing here can hold unsaved edits.
export function SharedReferencePanel({
  section,
  writes,
  locales,
  locale,
  onLocaleChange,
  canUpdate,
  canReadShared,
  readOnly,
  onDetach,
  onConflict,
}: {
  section: SectionSummary;
  writes: ReturnType<typeof usePageWrites>;
  locales: Locale[];
  locale: string;
  onLocaleChange: (code: string) => void;
  canUpdate: boolean;
  // `cms.sections:read` (the shared section itself is read with the same key as the page's sections).
  canReadShared: boolean;
  // The page is in the trash.
  readOnly: boolean;
  onDetach: (section: SectionSummary) => void;
  onConflict: () => void;
}) {
  const t = useTranslations("pages.editor.sharedPanel");
  const tTypes = useTranslations("publishing.sectionTypes");
  const { toastError } = useApiErrorHandler();
  const ref = section.shared_section ?? null;
  const sharedId = section.shared_section_id ?? 0;
  const query = useSharedSection(sharedId, canReadShared && sharedId > 0);
  const shared = query.data?.data.data;
  const typeQuery = useSectionType(shared?.section_type.key ?? section.section_type.key, shared?.section_type.version ?? section.section_type.version);
  const type = typeQuery.data;
  const [toggling, setToggling] = useState(false);
  const mutable = canUpdate && !readOnly;
  const typeName = tTypes.has(section.section_type.key) ? tTypes(section.section_type.key) : section.section_type.name;

  const setVisible = async (visible: boolean) => {
    setToggling(true);
    try {
      await writes.updateSection(section.id, { is_visible: visible });
    } catch (error) {
      if (isConflictError(error)) onConflict();
      else toastError(error, t("toggleFailed"));
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="shared-reference-panel" id="shared-reference-panel" tabIndex={-1}>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{typeName}</h2>
          <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
            <Link2Icon className="size-3" aria-hidden />
            {t("badge")}
          </span>
          {shared ? <StatusBadge status={shared.status} hasUnpublishedChanges={shared.has_unpublished_changes} trashed={Boolean(shared.deleted_at)} /> : null}
        </div>
        <p className="text-sm font-medium" data-testid="shared-reference-name">{shared?.name ?? ref?.name ?? ""}</p>
        <p className="text-sm text-muted-foreground">{t("note")}</p>
      </div>

      {ref && ref.deleted_at ? (
        <Alert variant="destructive" data-testid="shared-trashed-alert">
          <AlertTriangleIcon />
          <AlertTitle>{t("trashed.title")}</AlertTitle>
          <AlertDescription>{t("trashed.body")}</AlertDescription>
        </Alert>
      ) : ref && !ref.live ? (
        <Alert data-testid="shared-not-live-alert" className="border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangleIcon />
          <AlertTitle>{t("notLive.title")}</AlertTitle>
          <AlertDescription className="text-amber-950/90 dark:text-amber-100/90">{section.is_visible ? t("notLive.visible") : t("notLive.hidden")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {canReadShared && sharedId > 0 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/sections/${sharedId}`} target="_blank" rel="noopener" data-testid="edit-source-link">
              <ExternalLinkIcon />
              {t("editSource")}
            </Link>
          </Button>
        ) : null}
        {mutable ? (
          <Button type="button" variant="outline" size="sm" data-testid="detach-button" onClick={() => onDetach(section)}>
            <UnlinkIcon />
            {t("detach")}
          </Button>
        ) : null}
        {mutable ? (
          <div className="flex items-center gap-2">
            <Switch id={`visible-${section.id}`} checked={!section.is_visible} disabled={toggling} onCheckedChange={(hidden) => void setVisible(!hidden)} />
            <Label htmlFor={`visible-${section.id}`} className="font-normal">
              <EyeOffIcon className="size-4" aria-hidden />
              {t("hiddenSwitch")}
            </Label>
          </div>
        ) : null}
      </div>

      {!canReadShared ? (
        <Alert>
          <AlertDescription>{t("noRead")}</AlertDescription>
        </Alert>
      ) : query.error && !shared ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
      ) : !shared || !type || locales.length === 0 ? (
        <EditorSkeleton />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground" data-testid="shared-readonly-note">{t("readOnly")}</p>
          <SchemaForm sectionType={type} value={shared.props} onChange={NO_CHANGE} locales={locales} mode="draft" locale={locale} onLocaleChange={onLocaleChange} disabled />
        </div>
      )}
    </div>
  );
}
