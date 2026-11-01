"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SaveIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { ConflictDialog } from "@/components/global/conflict-dialog";
import { RevisionsTab } from "@/components/global/revisions/revisions-tab";
import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import {
  MAX_NOTE,
  STATUS_CODES,
  buildCreatePayload,
  buildUpdatePayload,
  checkPayload,
  draftFromRow,
  emptyRedirectDraft,
  isChanged,
  rowSnapshot,
  validate,
  type RedirectDraft,
} from "@/components/protected/redirects/redirect-draft";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationCreateRedirect, useMutationUpdateRedirect, useRedirectCheck } from "@/hooks/use-redirects";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, isNoPermissionError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { newIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import { RedirectsAPI } from "@/services/redirects.api";
import type { ApiFieldError } from "@/types/api";
import type { Redirect, RedirectCheckIssue } from "@/types/redirects";

const ALL = "__all__";
type LocaleOption = { code: string; name: string };

type Props = {
  target: { id: number } | "new";
  locales: LocaleOption[];
  // May this user edit the form (create right for a new one, update right for an existing one).
  canEdit: boolean;
  canRestore: boolean;
  onClose: () => void;
};

export function RedirectDialog(props: Props) {
  const t = useTranslations("redirects.dialog");
  const creating = props.target === "new";
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
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
  const query = useQuery({ queryKey: [API_ENDPOINTS.REDIRECTS.DETAIL(props.id)], queryFn: () => RedirectsAPI.Get(props.id) });
  if (query.error && isNoPermissionError(query.error)) return <NoPermission className="min-h-40 py-8" />;
  if (query.error && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} className="min-h-40 py-8" />;
  if (!query.data) return <Skeleton className="h-48 w-full" />;
  return <Editor {...props} row={query.data.data.data} etag={query.data.etag} reload={() => query.refetch()} />;
}

function Editor({ row, etag, locales, canEdit, canRestore, onClose, reload }: Props & { row: Redirect | null; etag: string | undefined; reload: () => Promise<unknown> }) {
  const t = useTranslations("redirects.dialog");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const creating = row === null;
  const create = useMutationCreateRedirect();
  const update = useMutationUpdateRedirect();
  const pending = create.isPending || update.isPending;

  const saved = row ? draftFromRow(row) : emptyRedirectDraft();
  const [draft, setDraft] = useState<RedirectDraft>(saved);
  const [issues, setIssues] = useState<ApiFieldError[]>([]);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [tab, setTab] = useState("details");
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [warnings, setWarnings] = useState<string[]>([]);
  const id = useId();
  const dirty = isChanged(saved, draft);

  // Live check (FR-SEO-06): 400 ms after the last keystroke, only when the form's own rules pass and something changed.
  const [debounced, setDebounced] = useState<RedirectDraft>(draft);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(draft), 400);
    return () => clearTimeout(timer);
  }, [draft]);
  const payload = canEdit && (creating || dirty) ? checkPayload(debounced, row?.id) : null;
  const check = useRedirectCheck(payload);
  const settled = isChanged(debounced, draft) === false;
  const result = settled && payload ? check.data : undefined;
  const checkErrors = result?.errors ?? [];
  const checkWarnings = result?.warnings ?? [];

  const set = (patch: Partial<RedirectDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setIssues([]);
  };
  const err = (path: string) => {
    const issue = issues.find((i) => i.path === path);
    return issue ? translateFieldError(tErrors, issue) : undefined;
  };
  const issueText = (kind: "errors" | "warnings", i: RedirectCheckIssue) => {
    const key = `check.${kind}.${i.code}`;
    const p = i.params ?? {};
    const values: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(p)) values[k] = Array.isArray(v) ? v.join(" > ") : typeof v === "string" || typeof v === "number" ? v : "";
    return t.has(key) ? t(key, values) : i.message ?? i.code;
  };

  const save = async (): Promise<boolean> => {
    const found = validate(draft);
    if (found.length) {
      setIssues(found);
      return false;
    }
    try {
      if (creating) {
        const result = await create.mutateAsync({ payload: buildCreatePayload(draft), idempotencyKey });
        if ((result.data.data.warnings ?? []).some((w) => w.code === "page_published")) toast.warning(t("check.warnings.page_published", { path: draft.sourcePath }));
        toast.success(t("created"));
        onClose();
        return true;
      }
      const body = buildUpdatePayload(saved, draft);
      if (Object.keys(body).length === 0) return true;
      const result = await update.mutateAsync({ id: row.id, payload: body, etag });
      setWarnings((result.data.data.warnings ?? []).map((w) => t(`check.warnings.${w.code}`, { path: String(w.params?.path ?? draft.sourcePath) })));
      toast.success(t("saved"));
      queryClient.setQueryData([API_ENDPOINTS.REDIRECTS.DETAIL(row.id)], { data: result.data, etag: result.etag });
      return true;
    } catch (error) {
      if (isConflictError(error)) setConflict(true);
      else {
        const parsed = parseApiError(error);
        if (parsed.fieldErrors.length) setIssues(parsed.fieldErrors);
        else toastError(error, t("saveFailed"));
      }
      return false;
    }
  };
  useUnsavedChangesGuard(dirty, { onSave: save });

  const blocked = checkErrors.length > 0;
  const form = (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if ((creating || dirty) && canEdit && !blocked) void save();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-source`}>{t("source")}</Label>
        <Input id={`${id}-source`} className="font-mono" value={draft.sourcePath} disabled={!canEdit || pending} autoComplete="off" placeholder="/old-address" aria-invalid={Boolean(err("/source_path"))} onChange={(e) => set({ sourcePath: e.target.value })} />
        <p className={cn("text-xs", err("/source_path") ? "text-destructive" : "text-muted-foreground")} role={err("/source_path") ? "alert" : undefined}>
          {err("/source_path") ?? t("sourceHelp")}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-target`}>{t("target")}</Label>
        <Input id={`${id}-target`} className="font-mono" value={draft.target} disabled={!canEdit || pending} autoComplete="off" placeholder="/new-address" aria-invalid={Boolean(err("/target"))} onChange={(e) => set({ target: e.target.value })} />
        <p className={cn("text-xs", err("/target") ? "text-destructive" : "text-muted-foreground")} role={err("/target") ? "alert" : undefined}>
          {err("/target") ?? t("targetHelp")}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-status`}>{t("statusCode")}</Label>
          <Select value={String(draft.statusCode)} disabled={!canEdit || pending} onValueChange={(v) => set({ statusCode: Number(v) as RedirectDraft["statusCode"] })}>
            <SelectTrigger id={`${id}-status`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_CODES.map((c) => (
                <SelectItem key={c} value={String(c)}>{c} - {t(`statusHelp.${c}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err("/status_code") ? <p role="alert" className="text-xs text-destructive">{err("/status_code")}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-locale`}>{t("language")}</Label>
          <Select value={draft.localeCode === "" ? ALL : draft.localeCode} disabled={!canEdit || pending} onValueChange={(v) => set({ localeCode: v === ALL ? "" : v })}>
            <SelectTrigger id={`${id}-locale`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("allLanguages")}</SelectItem>
              {locales.map((l) => (
                <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err("/locale_code") ? <p role="alert" className="text-xs text-destructive">{err("/locale_code")}</p> : null}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-note`}>{t("note")}</Label>
        <Textarea id={`${id}-note`} rows={2} value={draft.note} disabled={!canEdit || pending} aria-invalid={Boolean(err("/note"))} onChange={(e) => set({ note: e.target.value })} />
        <p className={cn("flex justify-between text-xs", err("/note") ? "text-destructive" : "text-muted-foreground")}>
          <span role={err("/note") ? "alert" : undefined}>{err("/note")}</span>
          <span>{[...draft.note.trim()].length} / {MAX_NOTE}</span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Switch id={`${id}-active`} checked={draft.isActive} disabled={!canEdit || pending} onCheckedChange={(v) => set({ isActive: v })} />
        <Label htmlFor={`${id}-active`} className="font-normal">{t("active")}</Label>
      </div>

      <div aria-live="polite" className="space-y-2" data-testid="redirect-check">
        {payload && (check.isFetching || !settled) ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" /> {t("check.running")}</p> : null}
        {checkErrors.map((e, i) => (
          <Alert key={`e${i}`} variant="destructive" role="alert"><AlertDescription>{issueText("errors", e)}</AlertDescription></Alert>
        ))}
        {checkWarnings.map((w, i) => (
          <Alert key={`w${i}`} role="status"><AlertDescription>{issueText("warnings", w)}</AlertDescription></Alert>
        ))}
        {result && result.valid && checkWarnings.length === 0 ? <p className="text-xs text-muted-foreground">{t("check.ok")}</p> : null}
        {check.isError ? <p className="text-xs text-muted-foreground">{t("check.unavailable")}</p> : null}
        {warnings.map((w) => <p key={w} role="status" className="text-sm text-amber-700 dark:text-amber-400">{w}</p>)}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>{t("close")}</Button>
        {canEdit ? (
          <Button type="submit" disabled={(!creating && !dirty) || pending || blocked}>
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
            <RevisionsTab
              resource="redirects"
              id={row.id}
              canRestore={canRestore}
              etag={etag}
              currentSnapshot={rowSnapshot(row)}
              onRefresh={reload}
              onRestored={({ data, etag: nextEtag }) => {
                queryClient.setQueryData([API_ENDPOINTS.REDIRECTS.DETAIL(row.id)], { data: { success: true, data }, etag: nextEtag });
                void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.REDIRECTS.LIST] });
                toast.success(t("restored"));
                setTab("details");
                setDraft(draftFromRow(data as unknown as Redirect));
              }}
            />
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
