"use client";

import { CheckIcon, CopyIcon, ExternalLinkIcon, EyeIcon, TriangleAlertIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import {
  MAX_TTL_MINUTES,
  MIN_TTL_MINUTES,
  PRESET_TTL_MINUTES,
  classifyPreviewCreateError,
  parseTtlMinutes,
  safeHttpUrl,
  type PreviewCreateProblem,
} from "@/components/global/publishing/preview-link-errors";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFetchCurrentUser } from "@/hooks/use-auth";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { useMutationCreatePreviewLink, useMutationRevokePreviewLink, usePreviewLinks } from "@/hooks/use-preview-links";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";
import { PERMISSION_ACTIONS } from "@/lib/constants/permissions";
import { PUBLISHABLE_RESOURCES, type PublishableResource } from "@/lib/publishable-resources";
import type { PreviewLinkCreated, PreviewLinkItem } from "@/types/preview-links";

const LIST_LIMIT = 50;
const CUSTOM = "custom";

export type PreviewLinkDialogProps = {
  resource: PublishableResource;
  entityId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Unsaved edits in the host's form: the link is frozen from the SERVER's working copy, so they would not be in it.
  isDirty?: boolean;
  // The host's "save everything pending" (PublishBar's `flush`): true = it is all saved. Without it no "Save draft first".
  flush?: () => Promise<boolean>;
  // The host is saving right now.
  isSaving?: boolean;
};

// SCR-38 "Preview link" (doc/07 3.12 / 3.24, doc/05 12.9): choose the language and how long the link lives, issue it, show
// the address ONCE (read-only field, Copy, Open in a new tab), and list the active links of the entity with Revoke.
//
// The address holds the raw token, which the server never shows again. So it lives only in this component's state: never in
// the query cache (the mutation has `gcTime: 0` and is reset the moment its answer is copied here; the list rows have no
// url), storage, the admin app's URL, a toast or a log. The body is MOUNTED only while the dialog is open, so closing it
// drops the address; closing is refused while the request is in flight, so no answer can arrive after the dialog is gone.
export function PreviewLinkDialog(props: PreviewLinkDialogProps) {
  if (!props.open) return null;
  return <PreviewLinkDialogBody {...props} />;
}

function PreviewLinkDialogBody({ resource, entityId, onOpenChange, isDirty = false, flush, isSaving = false }: PreviewLinkDialogProps) {
  const t = useTranslations("publishing.previewLinks");
  const noun = useTranslations("publishing")(`noun.${resource}`);
  const format = useFormatter();
  const config = PUBLISHABLE_RESOURCES[resource];
  const ids = { language: useId(), custom: useId(), url: useId() };

  const locales = useLocales();
  const activeLocales = (locales.data?.data ?? []).filter((l) => l.is_active);
  const defaultLocale = activeLocales.find((l) => l.is_default) ?? activeLocales[0];
  // Without `cms.locales:read` the list is unavailable: the server then uses the default language.
  const localesUnavailable = locales.isError;
  const [localeChoice, setLocaleChoice] = useState<string | null>(null);
  const chosenLocale = localeChoice ?? defaultLocale?.code ?? null;

  const [preset, setPreset] = useState<string>("30");
  const [customText, setCustomText] = useState("");
  const customMinutes = preset === CUSTOM ? parseTtlMinutes(customText) : Number(preset);
  const customInvalid = preset === CUSTOM && customMinutes === null;

  const createMutation = useMutationCreatePreviewLink(resource, entityId);
  const [issued, setIssued] = useState<PreviewLinkCreated | null>(null);
  const [problem, setProblem] = useState<PreviewCreateProblem | null>(null);
  // Rate limit (429): no new request for this many seconds (Create stays disabled, then the timer lets it go).
  const [waitSeconds, setWaitSeconds] = useState<number | null>(null);
  const [savingFirst, setSavingFirst] = useState(false);
  const creating = createMutation.isPending;

  useEffect(() => {
    if (waitSeconds === null) return;
    const timer = window.setTimeout(() => setWaitSeconds(null), waitSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [waitSeconds]);

  // The list of active links. Revoke is for the owner or a holder of `update`.
  const canUpdate = useCan(config.permissionKey, PERMISSION_ACTIONS.UPDATE);
  const me = useFetchCurrentUser().data?.data.id;
  const links = usePreviewLinks(resource, entityId, { state: "active", limit: LIST_LIMIT });
  const [revoking, setRevoking] = useState<PreviewLinkItem | null>(null);
  const revokeMutation = useMutationRevokePreviewLink(resource, entityId);

  const waiting = waitSeconds !== null;
  // The language list must be known (or known to be unavailable) first, so the right language is sent.
  const canCreate = !creating && !savingFirst && !isSaving && !customInvalid && !waiting && !locales.isPending;

  const create = async () => {
    if (!canCreate || customMinutes === null) return;
    setProblem(null);
    try {
      const response = await createMutation.mutateAsync({
        ...(chosenLocale && !localesUnavailable ? { locale: chosenLocale } : {}),
        ttl_minutes: customMinutes,
      });
      // The only copy of the address: component state. The mutation (and its `data`) is dropped at once.
      setIssued(response.data);
      createMutation.reset();
    } catch (error) {
      createMutation.reset();
      const classified = classifyPreviewCreateError(error);
      if (classified.kind === "rate") {
        // The server did not say how long (no Retry-After): wait a minute rather than hammer it.
        const seconds = classified.retryAfter ?? 60;
        setProblem({ kind: "rate", retryAfter: seconds });
        setWaitSeconds(seconds);
      } else {
        setProblem(classified);
      }
      if (classified.kind === "locale") void locales.refetch();
    }
  };

  const saveFirst = async () => {
    if (!flush) return;
    setSavingFirst(true);
    try {
      const saved = await flush();
      if (!saved) toast.error(t("dirty.saveFailed"));
    } finally {
      setSavingFirst(false);
    }
  };

  const doRevoke = async () => {
    const target = revoking;
    if (!target) return;
    try {
      await revokeMutation.mutateAsync(target.id);
      toast.success(t("revoke.done"));
    } catch (error) {
      const parsed = parseApiError(error);
      // 403 / 5xx / network are toasted once by the global handler; 404 means somebody else got there first.
      if (parsed.status === 404) toast.info(t("revoke.gone"));
      else if (parsed.status !== 403 && !parsed.isNetworkError && !(parsed.status && parsed.status >= 500)) toast.error(t("revoke.failed"));
    } finally {
      setRevoking(null);
    }
  };

  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const localeName = (code: string | null) => {
    if (!code) return t("list.noLanguage");
    const found = (locales.data?.data ?? []).find((l) => l.code === code);
    return found ? `${found.native_name} (${found.code})` : code;
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          // Not while a link is being issued: its answer would arrive after the dialog (and the address) is gone.
          if (!next && !creating) onOpenChange(false);
        }}
      >
        <DialogContent className="max-h-[90svh] gap-5 overflow-y-auto sm:max-w-xl" data-testid="preview-link-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <EyeIcon className="size-4" />
              {t("title")}
            </DialogTitle>
            <DialogDescription>{t("description", { noun })}</DialogDescription>
          </DialogHeader>

          {issued ? (
            <IssuedLink issued={issued} onAnother={() => setIssued(null)} onDone={() => onOpenChange(false)} localeName={localeName} when={when} />
          ) : (
            <div className="space-y-4">
              {isDirty ? (
                <Alert className="border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100" data-testid="preview-dirty-warning">
                  <TriangleAlertIcon />
                  <AlertTitle className="line-clamp-none">{t("dirty.title")}</AlertTitle>
                  <AlertDescription className="space-y-2 text-amber-950/90 dark:text-amber-100/90">
                    <span className="block">{t("dirty.body")}</span>
                    {flush ? (
                      <Button type="button" size="sm" variant="outline" disabled={savingFirst || isSaving} onClick={() => void saveFirst()}>
                        {savingFirst || isSaving ? <Spinner /> : null}
                        {savingFirst || isSaving ? t("dirty.saving") : t("dirty.saveFirst")}
                      </Button>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor={ids.language}>{t("language.label")}</Label>
                {locales.isPending ? (
                  <Skeleton className="h-9 w-full" />
                ) : localesUnavailable || activeLocales.length === 0 ? (
                  <p id={ids.language} className="text-sm text-muted-foreground">
                    {t("language.defaultOnly")}
                  </p>
                ) : (
                  <Select value={chosenLocale ?? undefined} onValueChange={setLocaleChoice} disabled={creating}>
                    <SelectTrigger id={ids.language} className="w-full" data-testid="preview-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {activeLocales.map((l) => (
                        <SelectItem key={l.code} value={l.code}>
                          {l.native_name} ({l.code}){l.is_default ? ` - ${t("language.default")}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label id={`${ids.custom}-label`}>{t("expiry.label")}</Label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={preset}
                  onValueChange={(value) => value && setPreset(value)}
                  disabled={creating}
                  aria-labelledby={`${ids.custom}-label`}
                  className="flex-wrap"
                >
                  {PRESET_TTL_MINUTES.map((minutes) => (
                    <ToggleGroupItem key={minutes} value={String(minutes)} aria-label={t(`expiry.preset.${minutes}`)} className="flex-none px-3">
                      {t(`expiry.preset.${minutes}`)}
                    </ToggleGroupItem>
                  ))}
                  <ToggleGroupItem value={CUSTOM} className="flex-none px-3">{t("expiry.custom")}</ToggleGroupItem>
                </ToggleGroup>
                {preset === CUSTOM ? (
                  <div className="space-y-1">
                    <Label htmlFor={ids.custom} className="text-xs font-normal text-muted-foreground">
                      {t("expiry.customLabel", { min: MIN_TTL_MINUTES, max: MAX_TTL_MINUTES })}
                    </Label>
                    <Input
                      id={ids.custom}
                      type="number"
                      inputMode="numeric"
                      min={MIN_TTL_MINUTES}
                      max={MAX_TTL_MINUTES}
                      step={1}
                      value={customText}
                      onChange={(e) => setCustomText(e.target.value)}
                      aria-invalid={customInvalid && customText !== "" ? true : undefined}
                      aria-describedby={`${ids.custom}-hint`}
                      className="max-w-40"
                      disabled={creating}
                    />
                    <p id={`${ids.custom}-hint`} className={customInvalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"} role={customInvalid && customText !== "" ? "alert" : undefined}>
                      {customInvalid ? t("expiry.customInvalid", { min: MIN_TTL_MINUTES, max: MAX_TTL_MINUTES }) : t("expiry.customHint")}
                    </p>
                  </div>
                ) : null}
              </div>

              <p className="text-sm text-muted-foreground">{t("frozen")}</p>

              {problem ? <ProblemAlert problem={problem} noun={noun} /> : null}

              <div className="flex justify-end">
                <Button type="button" onClick={() => void create()} disabled={!canCreate} data-testid="preview-create">
                  {creating ? <Spinner /> : <EyeIcon />}
                  {creating ? t("creating") : t("create")}
                </Button>
              </div>
            </div>
          )}

          <section className="space-y-2 border-t pt-4" aria-labelledby={`${ids.url}-links`} data-testid="preview-links-list">
            <h3 id={`${ids.url}-links`} className="text-sm font-medium">
              {t("list.title")}
            </h3>
            {links.isPending ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : links.isError ? (
              <div role="alert" className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <span>{isNoPermissionError(links.error) ? t("list.forbidden") : t("list.error")}</span>
                {isNoPermissionError(links.error) ? null : (
                  <Button type="button" size="sm" variant="outline" onClick={() => void links.refetch()}>
                    {t("list.retry")}
                  </Button>
                )}
              </div>
            ) : links.data.data.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="preview-links-empty">
                {t("list.empty", { noun })}
              </p>
            ) : (
              <>
                <ul className="space-y-2">
                  {links.data.data.map((link) => {
                    const mine = me !== undefined && link.created_by?.id === me;
                    const canRevoke = canUpdate || mine;
                    return (
                      <li key={link.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between" data-testid={`preview-link-${link.id}`}>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary" className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                              {t(`list.state.${link.state}`)}
                            </Badge>
                            {link.is_stale ? (
                              <Badge variant="outline" className="border-amber-500/60 text-amber-900 dark:text-amber-200">
                                {t("list.stale")}
                              </Badge>
                            ) : null}
                            <span className="text-sm font-medium">{localeName(link.locale)}</span>
                          </div>
                          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            <dt>{t("list.expires")}</dt>
                            <dd>
                              <time dateTime={link.expires_at}>{when(link.expires_at)}</time>
                            </dd>
                            <dt>{t("list.frozen")}</dt>
                            <dd>
                              <time dateTime={link.revision.frozen_at}>{when(link.revision.frozen_at)}</time>
                            </dd>
                            <dt>{t("list.createdBy")}</dt>
                            <dd>
                              {link.created_by?.name ?? t("list.unknownUser")}
                              {mine ? ` (${t("list.you")})` : ""} - <time dateTime={link.created_at}>{when(link.created_at)}</time>
                            </dd>
                            <dt>{t("list.uses")}</dt>
                            <dd>{link.use_count}</dd>
                          </dl>
                        </div>
                        {canRevoke ? (
                          <Button type="button" size="sm" variant="outline" className="shrink-0 self-start" onClick={() => setRevoking(link)} aria-label={t("list.revokeFor", { id: link.id })}>
                            {t("list.revoke")}
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {links.data.meta && links.data.meta.total > links.data.data.length ? (
                  <p className="text-xs text-muted-foreground">{t("list.more", { shown: links.data.data.length, total: links.data.meta.total })}</p>
                ) : null}
              </>
            )}
          </section>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(next) => !next && setRevoking(null)}
        title={t("revoke.title")}
        description={t("revoke.description")}
        confirmLabel={t("revoke.confirm")}
        destructive
        isPending={revokeMutation.isPending}
        onConfirm={doRevoke}
      />
    </>
  );
}

// The result: the address, once.
function IssuedLink({
  issued,
  onAnother,
  onDone,
  localeName,
  when,
}: {
  issued: PreviewLinkCreated;
  onAnother: () => void;
  onDone: () => void;
  localeName: (code: string | null) => string;
  when: (iso: string) => string;
}) {
  const t = useTranslations("publishing.previewLinks");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const href = safeHttpUrl(issued.url);

  const copy = async () => {
    let ok = false;
    try {
      // The async clipboard API needs a secure context (https / localhost).
      await navigator.clipboard.writeText(issued.url);
      ok = true;
    } catch {
      // Plain-http LAN addresses: select the field and use the old command.
      inputRef.current?.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    setCopied(ok ? "yes" : "no");
    if (ok) window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-4" data-testid="preview-issued">
      <Alert className="border-emerald-500/50 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100">
        <CheckIcon />
        <AlertTitle className="line-clamp-none">{t("result.title")}</AlertTitle>
        <AlertDescription className="text-emerald-950/90 dark:text-emerald-100/90">
          {t("result.summary", { language: localeName(issued.locale), expires: when(issued.expires_at) })}
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label htmlFor={inputId}>{t("result.urlLabel")}</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            ref={inputRef}
            readOnly
            value={issued.url}
            onFocus={(e) => e.currentTarget.select()}
            spellCheck={false}
            autoComplete="off"
            data-testid="preview-url"
            className="font-mono text-xs"
          />
          <Button type="button" variant="outline" onClick={() => void copy()} data-testid="preview-copy">
            {copied === "yes" ? <CheckIcon /> : <CopyIcon />}
            {copied === "yes" ? t("result.copied") : t("result.copy")}
          </Button>
        </div>
        {copied === "no" ? (
          <p role="alert" className="text-xs text-destructive">
            {t("result.copyFailed")}
          </p>
        ) : null}
      </div>

      <Alert className="border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100" data-testid="preview-once-note">
        <TriangleAlertIcon />
        <AlertDescription className="text-amber-950/90 dark:text-amber-100/90">{t("result.note")}</AlertDescription>
      </Alert>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onAnother}>
          {t("result.another")}
        </Button>
        {href ? (
          <Button asChild variant="outline">
            <a href={href} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon />
              {t("result.open")}
            </a>
          </Button>
        ) : null}
        <Button type="button" onClick={onDone}>
          {t("result.done")}
        </Button>
      </div>
    </div>
  );
}

function ProblemAlert({ problem, noun }: { problem: PreviewCreateProblem; noun: string }) {
  const t = useTranslations("publishing.previewLinks.errors");
  let text: string;
  switch (problem.kind) {
    case "limit":
      text = t("limit", { max: problem.max, noun });
      break;
    case "ttl":
      text = t("ttl", { min: problem.min, max: problem.max });
      break;
    case "rate": {
      const seconds = problem.retryAfter ?? 60;
      text = seconds >= 60 ? t("rateMinutes", { minutes: Math.ceil(seconds / 60) }) : t("rateSeconds", { seconds });
      break;
    }
    default:
      text = t(problem.kind, { noun });
  }
  return (
    <Alert variant="destructive" role="alert" data-testid="preview-problem" data-problem={problem.kind}>
      <TriangleAlertIcon />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}
