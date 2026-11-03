"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, PowerIcon, SaveIcon, TriangleAlertIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ConflictDialog } from "@/components/global/conflict-dialog";
import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import { WebhookActivity } from "@/components/protected/webhooks/webhook-activity";
import { WebhookEventsField } from "@/components/protected/webhooks/webhook-events-field";
import { WebhookStatusBadge } from "@/components/protected/webhooks/webhook-status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { useMutationCreateWebhook, useMutationUpdateWebhook } from "@/hooks/use-webhooks";
import { isConflictError, isNoPermissionError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { newIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import {
  MAX_NAME,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  buildCreatePayload,
  buildUpdatePayload,
  draftFromWebhook,
  emptyDraft,
  isChanged,
  isNotConfigured,
  issueFor,
  paramText,
  validate,
  type WebhookDraft,
} from "@/lib/webhooks";
import { WebhooksAPI, etagOfWebhook } from "@/services/webhooks.api";
import type { ApiFieldError } from "@/types/api";
import type { Webhook } from "@/types/webhooks";

export type IssuedSecret = { kind: "created" | "rotated"; name: string; secret: string | null };

type Props = {
  target: { id: number } | "new";
  canCreate: boolean;
  canUpdate: boolean;
  canExecute: boolean;
  // The create flow hands the one-time secret to the page (which shows it in the OneTimeSecretDialog) and closes the dialog.
  onIssued: (issued: IssuedSecret) => void;
  // Rotate / test are confirmed and run by the page; the dialog only asks (rotate is offered only while nothing is unsaved).
  onRotate: (webhook: Webhook, etag: string) => void;
  onTest: (webhook: Webhook) => void;
  onClose: () => void;
};

export function WebhookDialog(props: Props) {
  const t = useTranslations("webhooks.dialog");
  const creating = props.target === "new";
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{creating ? t("createTitle") : t("editTitle")}</DialogTitle>
          <DialogDescription>{creating ? t("createDescription") : t("editDescription")}</DialogDescription>
        </DialogHeader>
        {creating ? <Editor {...props} row={null} etag={undefined} reload={async () => undefined} /> : <Loader {...props} id={(props.target as { id: number }).id} />}
      </DialogContent>
    </Dialog>
  );
}

function Loader(props: Props & { id: number }) {
  const query = useQuery({ queryKey: [API_ENDPOINTS.WEBHOOKS.DETAIL(props.id)], queryFn: () => WebhooksAPI.Get(props.id) });
  if (query.error && isNoPermissionError(query.error)) return <NoPermission className="min-h-40 py-8" />;
  if (query.error && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} className="min-h-40 py-8" />;
  if (!query.data) return <Skeleton className="h-48 w-full" />;
  // Re-key on the ETag: after a save or a rotate the editor starts again from what the server holds.
  return <Editor key={query.data.etag} {...props} row={query.data.data.data} etag={query.data.etag} reload={() => query.refetch()} />;
}

function Editor({ row, etag, canCreate, canUpdate, canExecute, onIssued, onRotate, onTest, onClose, reload }: Props & { row: Webhook | null; etag: string | undefined; reload: () => Promise<unknown> }) {
  const t = useTranslations("webhooks.dialog");
  const tw = useTranslations("webhooks");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const creating = row === null;
  const create = useMutationCreateWebhook();
  const update = useMutationUpdateWebhook();
  const pending = create.isPending || update.isPending;
  const canEdit = creating ? canCreate : canUpdate;

  const saved = row ? draftFromWebhook(row) : emptyDraft();
  const [draft, setDraft] = useState<WebhookDraft>(saved);
  const [issues, setIssues] = useState<ApiFieldError[]>([]);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [unconfigured, setUnconfigured] = useState(false);
  const [tab, setTab] = useState("details");
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const id = useId();
  const dirty = isChanged(saved, draft);
  const detailKey = row ? [API_ENDPOINTS.WEBHOOKS.DETAIL(row.id)] : null;

  const set = (patch: Partial<WebhookDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setIssues([]);
  };

  // The text of one field error, in plain words (no resolved address is ever part of an answer or of these texts).
  const fieldText = (field: "name" | "url" | "events" | "is_active" | "timeout_ms"): string | undefined => {
    const issue = issueFor(issues, field);
    if (!issue) return undefined;
    const key = `fieldErrors.${field}.${issue.code}`;
    if (tw.has(key)) return tw(key, { allowed: paramText(issue.params?.allowed), min: MIN_TIMEOUT_MS, max: MAX_TIMEOUT_MS });
    return translateFieldError(tErrors, issue);
  };

  const save = async (): Promise<boolean> => {
    const found = validate(draft);
    if (found.length) {
      setIssues(found);
      return false;
    }
    setUnconfigured(false);
    try {
      if (creating) {
        let captured: string | null = null;
        const result = await create.mutateAsync({ payload: buildCreatePayload(draft), idempotencyKey, onSecret: (s) => (captured = s) });
        toast.success(t("created"));
        onIssued({ kind: "created", name: result.data.data.name, secret: captured });
        return true;
      }
      const payload = buildUpdatePayload(saved, draft);
      if (Object.keys(payload).length === 0) return true;
      const result = await update.mutateAsync({ id: row.id, payload, etag: etagOfWebhook(row, etag) });
      toast.success(t("saved"));
      // The answer carries the new ETag: re-seed the cache the dialog reads from (the editor re-keys on it).
      queryClient.setQueryData(detailKey!, { data: result.data, etag: result.etag });
      return true;
    } catch (error) {
      if (isConflictError(error)) setConflict(true);
      else if (isNotConfigured(error)) setUnconfigured(true);
      else {
        const parsed = parseApiError(error);
        if (parsed.fieldErrors.length) setIssues(parsed.fieldErrors);
        else toastError(error, t("saveFailed"));
      }
      return false;
    }
  };
  useUnsavedChangesGuard(dirty, { onSave: save });

  // "Turn back on" (a webhook the system switched off): `PATCH is_active: true` clears the reason and the failure count.
  const turnOn = async () => {
    if (!row) return;
    try {
      const result = await update.mutateAsync({ id: row.id, payload: { is_active: true }, etag: etagOfWebhook(row, etag) });
      toast.success(t("turnedOn"));
      queryClient.setQueryData(detailKey!, { data: result.data, etag: result.etag });
    } catch (error) {
      if (isConflictError(error)) setConflict(true);
      else toastError(error, t("saveFailed"));
    }
  };

  const nameError = fieldText("name");
  const urlError = fieldText("url");
  const timeoutError = fieldText("timeout_ms");

  const form = (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if ((creating || dirty) && canEdit) void save();
      }}
    >
      {row?.disabled_reason === "auto_24h_failure" ? (
        <Alert variant="destructive" data-testid="webhook-auto-disabled">
          <TriangleAlertIcon />
          <AlertTitle className="leading-snug">{t("autoDisabledTitle")}</AlertTitle>
          <AlertDescription className="leading-snug">
            <p>{t("autoDisabledText", { count: row.consecutive_failures })}</p>
            {canUpdate ? (
              <Button type="button" size="sm" variant="outline" className="mt-2" disabled={pending} onClick={() => void turnOn()}>
                {update.isPending ? <Spinner /> : <PowerIcon />} {t("turnBackOn")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {unconfigured ? (
        <Alert variant="destructive" data-testid="webhook-not-configured">
          <TriangleAlertIcon />
          <AlertDescription className="leading-snug">{tw("notConfigured")}</AlertDescription>
        </Alert>
      ) : null}

      <fieldset disabled={!canEdit || pending} className="min-w-0 space-y-4 border-0 p-0">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>
            {t("name")}
            <span aria-hidden className="ml-0.5 text-destructive">*</span>
          </Label>
          <Input id={`${id}-name`} value={draft.name} autoComplete="off" aria-invalid={Boolean(nameError)} onChange={(e) => set({ name: e.target.value })} />
          <p className={cn("flex justify-between text-xs", nameError ? "text-destructive" : "text-muted-foreground")}>
            <span role={nameError ? "alert" : undefined}>{nameError ?? t("nameHelp")}</span>
            <span>{[...draft.name.trim()].length} / {MAX_NAME}</span>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-url`}>
            {t("url")}
            <span aria-hidden className="ml-0.5 text-destructive">*</span>
          </Label>
          <Input
            id={`${id}-url`}
            value={draft.url}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://hooks.example.com/materm"
            className="font-mono text-sm"
            aria-invalid={Boolean(urlError)}
            onChange={(e) => set({ url: e.target.value })}
          />
          <p className={cn("text-xs leading-snug", urlError ? "text-destructive" : "text-muted-foreground")} role={urlError ? "alert" : undefined}>
            {urlError ?? t("urlHelp")}
          </p>
        </div>

        <WebhookEventsField value={draft.events} onChange={(events) => set({ events })} disabled={!canEdit || pending} error={fieldText("events")} />

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-timeout`}>{t("timeout")}</Label>
          <Input
            id={`${id}-timeout`}
            value={draft.timeout}
            inputMode="numeric"
            autoComplete="off"
            className="max-w-40"
            aria-invalid={Boolean(timeoutError)}
            onChange={(e) => set({ timeout: e.target.value })}
          />
          <p className={cn("text-xs leading-snug", timeoutError ? "text-destructive" : "text-muted-foreground")} role={timeoutError ? "alert" : undefined}>
            {timeoutError ?? t("timeoutHelp", { min: MIN_TIMEOUT_MS, max: MAX_TIMEOUT_MS })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Switch id={`${id}-active`} checked={draft.isActive} onCheckedChange={(v) => set({ isActive: v })} />
          <Label htmlFor={`${id}-active`} className="font-normal">{t("active")}</Label>
          <span className="text-xs text-muted-foreground">{t("activeHelp")}</span>
        </div>
      </fieldset>

      {row ? (
        <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="webhook-secret-section">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 leading-snug">
              <p className="font-medium">{t("secret")}</p>
              <p className="text-muted-foreground">
                {t("secretHint")} <span className="font-mono" data-testid="webhook-secret-hint">{row.secret_hint ? `••••${row.secret_hint}` : "-"}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canExecute ? (
                <Button type="button" variant="outline" size="sm" disabled={dirty || pending} onClick={() => onTest(row)}>
                  {t("test")}
                </Button>
              ) : null}
              {canUpdate ? (
                <Button type="button" variant="outline" size="sm" disabled={dirty || pending} onClick={() => onRotate(row, etagOfWebhook(row, etag))}>
                  <KeyRoundIcon /> {t("rotate")}
                </Button>
              ) : null}
            </div>
          </div>
          {dirty ? <p className="text-xs text-muted-foreground">{t("saveFirst")}</p> : <p className="text-xs leading-snug text-muted-foreground">{t("secretHelp")}</p>}
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            <div className="flex gap-1">
              <dt className="text-muted-foreground">{t("status")}</dt>
              <dd><WebhookStatusBadge webhook={row} /></dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-muted-foreground">{t("failures")}</dt>
              <dd data-testid="webhook-failures">{row.consecutive_failures}</dd>
            </div>
            <div className="flex gap-1 sm:col-span-2">
              <dt className="text-muted-foreground">{t("lastSuccess")}</dt>
              <dd>{row.last_success_at ? format.dateTime(new Date(row.last_success_at), { dateStyle: "medium", timeStyle: "short" }) : t("never")}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>{t("close")}</Button>
        {canEdit ? (
          <Button type="submit" disabled={(!creating && !dirty) || pending}>
            {pending ? <Spinner /> : <SaveIcon />} {creating ? t("create") : t("save")}
          </Button>
        ) : null}
      </DialogFooter>
    </form>
  );

  return (
    <>
      {creating ? (
        form
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="details">{t("tabs.details")}</TabsTrigger>
            <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="pt-3">{form}</TabsContent>
          <TabsContent value="history" className="pt-3">
            <WebhookActivity webhookId={row.id} />
          </TabsContent>
        </Tabs>
      )}
      <ConflictDialog
        open={conflict}
        onOpenChange={setConflict}
        isReloading={reloading}
        onReload={async () => {
          setReloading(true);
          try {
            await reload();
            setConflict(false);
            onClose();
          } finally {
            setReloading(false);
          }
        }}
      />
    </>
  );
}
