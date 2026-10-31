"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { DataTable } from "@/components/global/data-table";
import { ErrorState } from "@/components/global/states/error-state";
import { FetchingBar } from "@/components/global/states/fetching-bar";
import { NoPermission } from "@/components/layout/no-permission";
import { LocaleEditSheet } from "@/components/protected/locales/locale-edit-sheet";
import { dependentsOf, formatDateExample } from "@/components/protected/locales/locale-rules";
import { Badge } from "@/components/ui/badge";
import { ConflictDialog } from "@/components/global/conflict-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useLocales, useMutationUpdateLocale } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { isConflictError, isNoPermissionError } from "@/lib/api-error";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { Locale } from "@/types/locales";

// SCR-12 (doc/07 section 3.7): the (unpaginated) language table with an activate switch per row and an edit
// sheet. The default language is shown as such, cannot be switched off (409 DEFAULT_LOCALE_PROTECTED) and has no
// fallback. Switching a language off that others fall back to asks first (doc/05 section 10.7).
export function LocalesList() {
  const t = useTranslations("locales");
  const { data, isLoading, isFetching, error, refetch } = useLocales();
  const toggle = useMutationUpdateLocale();
  const { toastError } = useApiErrorHandler();
  const canEdit = useCan(PERMISSION_KEYS.CMS_LOCALES, PERMISSION_ACTIONS.UPDATE);

  const [editing, setEditing] = useState<Locale | null>(null);
  const [confirmOff, setConfirmOff] = useState<Locale | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);

  const locales = useMemo(() => data?.data ?? [], [data]);

  const setActive = async (locale: Locale, isActive: boolean) => {
    try {
      await toggle.mutateAsync({ code: locale.code, payload: { is_active: isActive }, etag: locale.etag });
      toast.success(t(isActive ? "toast.activated" : "toast.deactivated", { name: locale.name }));
    } catch (e) {
      if (isConflictError(e)) {
        // Somebody else changed the row: offer to load what the server has now.
        setConflict(true);
      } else {
        toastError(e, t("toast.error"));
      }
      throw e;
    }
  };

  const columns = useMemo<ColumnDef<Locale>[]>(
    () => [
      {
        id: "code",
        accessorKey: "code",
        header: t("columns.code"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        id: "name",
        accessorKey: "name",
        header: t("columns.name"),
        cell: ({ row }) => (
          <span className="flex items-center gap-2 font-medium">
            {row.original.flag ? <span aria-hidden>{row.original.flag}</span> : null}
            {row.original.name}
            {row.original.is_default ? <Badge>{t("defaultBadge")}</Badge> : null}
          </span>
        ),
      },
      { id: "native_name", accessorKey: "native_name", header: t("columns.nativeName") },
      { id: "short_label", accessorKey: "short_label", header: t("columns.shortLabel") },
      { id: "sort_order", accessorKey: "sort_order", header: t("columns.order") },
      {
        id: "fallback",
        header: t("columns.fallback"),
        cell: ({ row }) =>
          row.original.fallback_code ? (
            <span className="font-mono text-xs">{row.original.fallback_code}</span>
          ) : (
            "—"
          ),
      },
      {
        id: "date",
        header: t("columns.dateExample"),
        cell: ({ row }) => {
          const f = row.original.date_formats;
          return f?.short && f.months?.length ? formatDateExample(f.short, f.months) : "—";
        },
      },
      {
        id: "active",
        header: t("columns.active"),
        cell: ({ row }) => {
          const l = row.original;
          const pendingThis = toggle.isPending && toggle.variables?.code === l.code;
          return (
            <span className="flex items-center gap-2" title={l.is_default ? t("defaultCannotOff") : undefined}>
              <Switch
                aria-label={t("activeSwitch", { name: l.name })}
                checked={l.is_active}
                disabled={!canEdit || l.is_default || pendingThis}
                onCheckedChange={(next) => {
                  if (!next && dependentsOf(locales, l.code).length > 0) setConfirmOff(l);
                  else void setActive(l, next).catch(() => undefined);
                }}
              />
              <span className="text-xs text-muted-foreground">{l.is_active ? t("on") : t("off")}</span>
            </span>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(row.original)}
            aria-label={t("editLabel", { name: row.original.name })}
          >
            <PencilIcon />
            {canEdit ? t("editButton") : t("viewButton")}
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, canEdit, locales, toggle.isPending, toggle.variables]
  );

  if (error && isNoPermissionError(error)) return <NoPermission />;
  if (error && !data) return <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} />;

  return (
    <div className="space-y-2">
      <FetchingBar active={isFetching && !isLoading} />
      <DataTable
        columns={columns}
        data={locales}
        getRowId={(row) => row.code}
        isLoading={isLoading}
        skeletonRowCount={4}
        emptyTitle={t("empty")}
      />
      <p className="text-xs text-muted-foreground">{t("note")}</p>

      {editing ? (
        <LocaleEditSheet
          key={`${editing.code}|${locales.find((l) => l.code === editing.code)?.etag ?? ""}`}
          locale={locales.find((l) => l.code === editing.code) ?? editing}
          locales={locales}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <ConflictDialog
        open={conflict}
        onOpenChange={setConflict}
        isReloading={reloading}
        onReload={async () => {
          setReloading(true);
          try {
            await refetch();
          } finally {
            setReloading(false);
          }
        }}
      />

      <ConfirmDialog
        open={confirmOff !== null}
        onOpenChange={(open) => (!open ? setConfirmOff(null) : undefined)}
        title={t("deactivate.title", { name: confirmOff?.name ?? "" })}
        description={t("deactivate.description", {
          dependents: confirmOff ? dependentsOf(locales, confirmOff.code).map((l) => l.name).join(", ") : "",
        })}
        confirmLabel={t("deactivate.confirm")}
        destructive
        onConfirm={() => (confirmOff ? setActive(confirmOff, false) : undefined)}
      />
    </div>
  );
}
