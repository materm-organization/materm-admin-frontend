"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { HistoryIcon, KeyRoundIcon, PencilIcon, PlusIcon, PowerIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, type SetStateAction } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { ListPage } from "@/components/global/list/list-page";
import { OneTimeSecretDialog } from "@/components/global/one-time-secret-dialog";
import { SingleSelectFilter, type SelectedType } from "@/components/global/single-select-filter";
import { WebhookDeliveriesSheet } from "@/components/protected/webhooks/webhook-deliveries-sheet";
import { WebhookDialog, type IssuedSecret } from "@/components/protected/webhooks/webhook-dialog";
import { WebhookStatusBadge } from "@/components/protected/webhooks/webhook-status";
import { WebhookTestDialog } from "@/components/protected/webhooks/webhook-test-dialog";
import { useWebhookText } from "@/components/protected/webhooks/webhook-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-permission";
import { useMutationDeleteWebhook, useMutationRotateWebhookSecret, useMutationUpdateWebhook, useWebhooks } from "@/hooks/use-webhooks";
import { isConflictError } from "@/lib/api-error";
import { PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ListParamsConfig } from "@/lib/list-params";
import { WEBHOOK_EVENTS, isNotConfigured } from "@/lib/webhooks";
import { etagOfWebhook } from "@/services/webhooks.api";
import type { Webhook, WebhooksQuery } from "@/types/webhooks";

const CONFIG = {
  filters: {
    is_active: z.enum(["true", "false"]).optional(),
    event: z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]]).optional(),
  },
  sortable: ["name", "created_at", "updated_at"],
  defaultSort: "-created_at",
  defaultLimit: 20,
} satisfies ListParamsConfig;

const facetValue = (value: string | undefined, options: SelectedType[]): SelectedType | null => {
  if (value === undefined) return null;
  return options.find((o) => o.value === value) ?? { value, name: value };
};
const pickFacet = (action: SetStateAction<SelectedType | null>, current: SelectedType | null): string | undefined => {
  const next = typeof action === "function" ? action(current) : action;
  return next?.value;
};

// SCR-43 (doc/07 section 3.27, doc/05 section 16): external webhooks, super_admin only. Save-live with `If-Match` (the `etag` of the row is a
// hash of the editable fields). The signing secret is shown ONCE, in the OneTimeSecretDialog, after create and after rotate; this page keeps
// it in `issued` only while that dialog is open and never puts it anywhere else.
export function WebhooksPage() {
  const t = useTranslations("webhooks");
  const text = useWebhookText();
  const format = useFormatter();
  const { toastError } = useApiErrorHandler();
  const list = useListParams(CONFIG);
  const filters = list.params.filters;
  const query = useWebhooks({ ...(list.query as WebhooksQuery) });

  const canCreate = useCan(PERMISSION_KEYS.OPS_WEBHOOKS, "create");
  const canUpdate = useCan(PERMISSION_KEYS.OPS_WEBHOOKS, "update");
  const canDelete = useCan(PERMISSION_KEYS.OPS_WEBHOOKS, "delete");
  const canExecute = useCan(PERMISSION_KEYS.OPS_WEBHOOKS, "execute");

  const del = useMutationDeleteWebhook();
  const rotate = useMutationRotateWebhookSecret();
  const update = useMutationUpdateWebhook();
  const [dialog, setDialog] = useState<{ id: number } | "new" | null>(null);
  const [toDelete, setToDelete] = useState<Webhook | null>(null);
  const [toRotate, setToRotate] = useState<{ row: Webhook; etag: string } | null>(null);
  const [testing, setTesting] = useState<Webhook | null>(null);
  const [deliveries, setDeliveries] = useState<Webhook | null>(null);
  const [issued, setIssued] = useState<IssuedSecret | null>(null);

  const rows = query.data?.data ?? [];
  const activeOptions = useMemo<SelectedType[]>(() => [{ value: "true", name: t("active") }, { value: "false", name: t("inactive") }], [t]);
  const eventOptions = useMemo<SelectedType[]>(() => WEBHOOK_EVENTS.map((e) => ({ value: e, name: text.event(e) })), [text]);

  const doDelete = async (row: Webhook) => {
    try {
      await del.mutateAsync({ id: row.id, etag: etagOfWebhook(row) });
      toast.success(t("toast.deleted"));
      setToDelete(null);
    } catch (error) {
      setToDelete(null);
      if (isConflictError(error)) {
        toast.error(t("toast.stale"));
        void query.refetch();
      } else toastError(error, t("toast.deleteFailed"));
    }
  };

  const doRotate = async (target: { row: Webhook; etag: string }) => {
    let captured: string | null = null;
    try {
      await rotate.mutateAsync({ id: target.row.id, etag: target.etag, onSecret: (s) => (captured = s) });
      setToRotate(null);
      setIssued({ kind: "rotated", name: target.row.name, secret: captured });
    } catch (error) {
      setToRotate(null);
      if (isConflictError(error)) {
        toast.error(t("toast.stale"));
        void query.refetch();
      } else if (isNotConfigured(error)) toast.error(t("notConfigured"));
      else toastError(error, t("toast.rotateFailed"));
    }
  };

  const turnOn = async (row: Webhook) => {
    try {
      await update.mutateAsync({ id: row.id, payload: { is_active: true }, etag: etagOfWebhook(row) });
      toast.success(t("toast.turnedOn"));
    } catch (error) {
      if (isConflictError(error)) {
        toast.error(t("toast.stale"));
        void query.refetch();
      } else toastError(error, t("toast.turnOnFailed"));
    }
  };

  const columns = useMemo<ColumnDef<Webhook>[]>(
    () => [
      {
        id: "name",
        header: t("columns.name"),
        enableSorting: true,
        cell: ({ row }) => {
          const w = row.original;
          return (
            <div className="min-w-0 max-w-sm leading-snug">
              {canUpdate || canExecute ? (
                <button type="button" className="text-left font-medium underline-offset-4 hover:underline" onClick={() => setDialog({ id: w.id })}>
                  {w.name}
                </button>
              ) : (
                <span className="font-medium">{w.name}</span>
              )}
              <p className="break-all font-mono text-xs text-muted-foreground" title={w.url}>{w.url}</p>
            </div>
          );
        },
      },
      {
        id: "events",
        header: t("columns.events"),
        cell: ({ row }) => (
          <div className="flex max-w-56 flex-wrap gap-1">
            {row.original.events.map((e) => (
              <Badge key={e} variant="outline" className="whitespace-nowrap">
                {text.event(e)}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: "status",
        header: t("columns.status"),
        cell: ({ row }) => <WebhookStatusBadge webhook={row.original} />,
      },
      {
        id: "failures",
        header: t("columns.failures"),
        cell: ({ row }) => <span className={row.original.consecutive_failures > 0 ? "font-medium text-destructive" : "text-muted-foreground"}>{row.original.consecutive_failures}</span>,
      },
      {
        id: "last_success",
        header: t("columns.lastSuccess"),
        cell: ({ row }) =>
          row.original.last_success_at ? (
            format.dateTime(new Date(row.original.last_success_at), { dateStyle: "medium", timeStyle: "short" })
          ) : (
            <span className="text-muted-foreground">{t("never")}</span>
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => {
          const w = row.original;
          return (
            <div className="flex justify-end gap-1">
              {canUpdate && w.disabled_reason === "auto_24h_failure" ? (
                <Button type="button" variant="outline" size="icon" className="size-8" aria-label={t("actions.turnOn", { name: w.name })} title={t("actions.turnOnShort")} disabled={update.isPending} onClick={() => void turnOn(w)}>
                  <PowerIcon />
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.deliveries", { name: w.name })} title={t("actions.deliveriesShort")} onClick={() => setDeliveries(w)}>
                <HistoryIcon />
              </Button>
              {canExecute ? (
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.test", { name: w.name })} title={t("actions.testShort")} onClick={() => setTesting(w)}>
                  <SendIcon />
                </Button>
              ) : null}
              {canUpdate ? (
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.edit", { name: w.name })} title={t("actions.editShort")} onClick={() => setDialog({ id: w.id })}>
                  <PencilIcon />
                </Button>
              ) : null}
              {canUpdate ? (
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.rotate", { name: w.name })} title={t("actions.rotateShort")} onClick={() => setToRotate({ row: w, etag: etagOfWebhook(w) })}>
                  <KeyRoundIcon />
                </Button>
              ) : null}
              {canDelete ? (
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("actions.delete", { name: w.name })} title={t("actions.deleteShort")} onClick={() => setToDelete(w)}>
                  <Trash2Icon />
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, text, format, canUpdate, canDelete, canExecute, update.isPending]
  );

  return (
    <>
      <ListPage<Webhook>
        title={t("title")}
        description={t("description")}
        list={list as unknown as Parameters<typeof ListPage<Webhook>>[0]["list"]}
        columns={columns}
        data={rows}
        meta={query.data?.meta}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        getRowId={(r) => String(r.id)}
        keywordPlaceholder={t("searchPlaceholder")}
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <SingleSelectFilter
              label={t("filters.status")}
              data={activeOptions}
              selectedValue={facetValue(filters.is_active, activeOptions)}
              setSelectedValue={(a) => list.setFilters({ is_active: pickFacet(a, facetValue(filters.is_active, activeOptions)) as never })}
            />
            <SingleSelectFilter
              label={t("filters.event")}
              data={eventOptions}
              selectedValue={facetValue(filters.event, eventOptions)}
              setSelectedValue={(a) => list.setFilters({ event: pickFacet(a, facetValue(filters.event, eventOptions)) as never })}
            />
          </div>
        }
        primaryAction={
          canCreate ? (
            <Button type="button" onClick={() => setDialog("new")}>
              <PlusIcon /> {t("create")}
            </Button>
          ) : undefined
        }
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHelp")}
      />

      {dialog ? (
        <WebhookDialog
          target={dialog}
          canCreate={canCreate}
          canUpdate={canUpdate}
          canExecute={canExecute}
          onIssued={(i) => {
            setDialog(null);
            setIssued(i);
          }}
          onRotate={(row, etag) => {
            setDialog(null);
            setToRotate({ row, etag });
          }}
          onTest={(row) => {
            setDialog(null);
            setTesting(row);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {testing ? (
        <WebhookTestDialog
          webhook={testing}
          onClose={() => setTesting(null)}
          onOpenDeliveries={() => {
            setDeliveries(testing);
            setTesting(null);
          }}
        />
      ) : null}
      {deliveries ? <WebhookDeliveriesSheet webhook={deliveries} canRetry={canExecute} onClose={() => setDeliveries(null)} /> : null}

      <ConfirmDialog
        open={toRotate !== null}
        onOpenChange={(open) => !open && setToRotate(null)}
        title={t("rotate.title", { name: toRotate?.row.name ?? "" })}
        description={t("rotate.description")}
        confirmLabel={t("rotate.confirm")}
        destructive
        isPending={rotate.isPending}
        onConfirm={() => (toRotate ? doRotate(toRotate) : undefined)}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("delete.title", { name: toDelete?.name ?? "" })}
        description={t("delete.description")}
        confirmLabel={t("delete.confirm")}
        destructive
        onConfirm={() => (toDelete ? doDelete(toDelete) : undefined)}
      />

      {/* The one-time secret: mounted only while it is pending, cleared by "Done". */}
      {issued ? (
        <OneTimeSecretDialog
          secret={issued.secret}
          onDone={() => setIssued(null)}
          title={issued.kind === "created" ? t("secret.createdTitle") : t("secret.rotatedTitle")}
          description={t("secret.description", { name: issued.name })}
          label={t("secret.label")}
          onceWarning={t("secret.onceWarning")}
          unavailable={t("secret.unavailable")}
        />
      ) : null}
    </>
  );
}
