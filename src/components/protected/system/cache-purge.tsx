"use client";

import { CheckCircle2Icon, EraserIcon, PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { useLocales } from "@/hooks/use-locales";
import { useMutationPurgeCache } from "@/hooks/use-system";
import { useCan } from "@/hooks/use-permission";
import { API_ERROR_CODES, parseApiError } from "@/lib/api-error";
import { translateApiError } from "@/lib/api-error-messages";
import {
  FIXED_PURGE_TAGS,
  MAX_PURGE_REASON,
  MAX_PURGE_TAGS,
  MENU_PURGE_TAGS,
  isAllowedPurgeTag,
} from "@/lib/cache-tags";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { cn } from "@/lib/utils";
import type { CachePurgeResult, CachePurgeScope } from "@/types/system";

// SCR-45 "clear cache" (doc/07 section 3.28, doc/05 section 11.8): asks the website to drop what it cached,
// either certain tags or everything. Shown only to those with `ops.system:execute` (the page itself needs only
// `read`). It goes through the outbox: the answer means "queued", the website follows within seconds.
export function CachePurgeSection() {
  const t = useTranslations("system.purge");
  const canExecute = useCan(PERMISSION_KEYS.OPS_SYSTEM, PERMISSION_ACTIONS.EXECUTE);
  const [open, setOpen] = useState(false);
  if (!canExecute) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <EraserIcon />
          {t("open")}
        </Button>
        {open ? <CachePurgeDialog onClose={() => setOpen(false)} /> : null}
      </CardContent>
    </Card>
  );
}

type Problem =
  | { kind: "rate"; seconds?: number }
  | { kind: "forbidden" }
  | { kind: "unavailable" }
  | { kind: "tags"; indexes: number[] }
  | { kind: "other"; message: string };

function CachePurgeDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("system.purge");
  const tErr = useTranslations("errors");
  const mutation = useMutationPurgeCache();
  const locales = useLocales();
  const scopeName = useId();
  const tagInputId = useId();
  const reasonId = useId();
  const [scope, setScope] = useState<CachePurgeScope>("tags");
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [result, setResult] = useState<CachePurgeResult | null>(null);

  // `ui:<code>` for the active languages (when the user may read them).
  const uiTags = (locales.data?.data ?? []).filter((l) => l.is_active).map((l) => `ui:${l.code}`);

  const toggle = (tag: string) => {
    setProblem(null);
    setTags((current) => (current.includes(tag) ? current.filter((x) => x !== tag) : current.length >= MAX_PURGE_TAGS ? current : [...current, tag]));
  };

  const addTag = (tag: string) => {
    setProblem(null);
    setTags((current) => (current.includes(tag) || current.length >= MAX_PURGE_TAGS ? current : [...current, tag]));
  };

  const addDraft = (event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    const tag = draft.trim();
    if (!tag) return;
    if (!isAllowedPurgeTag(tag)) {
      setDraftError(t("tagInvalid", { tag }));
      return;
    }
    setDraftError(null);
    setDraft("");
    addTag(tag);
  };

  const canSubmit = scope === "all" || tags.length > 0;

  const send = async () => {
    setProblem(null);
    try {
      const data = await mutation.mutateAsync(
        scope === "all" ? { scope: "all", ...(reason.trim() ? { reason: reason.trim() } : {}) } : { scope: "tags", tags, ...(reason.trim() ? { reason: reason.trim() } : {}) }
      );
      setResult(data.data);
      setConfirmAll(false);
    } catch (error) {
      setConfirmAll(false);
      const parsed = parseApiError(error);
      if (parsed.status === 429 || parsed.code === API_ERROR_CODES.RATE_LIMITED) setProblem({ kind: "rate", seconds: parsed.retryAfter });
      else if (parsed.status === 403) setProblem({ kind: "forbidden" });
      else if (parsed.status === 503) setProblem({ kind: "unavailable" });
      else if (parsed.status === 422) {
        const indexes = parsed.fieldErrors
          .map((fe) => /^\/tags\/(\d+)$/.exec(fe.path)?.[1])
          .filter((i): i is string => i !== undefined)
          .map(Number);
        if (indexes.length > 0) setProblem({ kind: "tags", indexes });
        else setProblem({ kind: "other", message: translateApiError(tErr, parsed) });
      } else setProblem({ kind: "other", message: translateApiError(tErr, parsed) });
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || mutation.isPending) return;
    if (scope === "all" && !confirmAll) {
      setConfirmAll(true);
      return;
    }
    void send();
  };

  const busy = mutation.isPending;

  return (
    <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
      <DialogContent className="md:max-w-xl">
        <DialogHeader>
          <DialogTitle>{result ? t("done.title") : confirmAll ? t("confirmAll.title") : t("dialog.title")}</DialogTitle>
          <DialogDescription>{result ? t("done.description") : confirmAll ? t("confirmAll.description") : t("dialog.description")}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3" data-testid="purge-result">
            <Alert>
              <CheckCircle2Icon />
              <AlertTitle>{t("done.queued", { id: result.event_id })}</AlertTitle>
              <AlertDescription>{result.scope === "all" ? t("done.all") : t("done.tags")}</AlertDescription>
            </Alert>
            <ul className="flex flex-wrap gap-1.5" aria-label={t("done.sent")}>
              {result.tags.map((tag) => (
                <li key={tag}>
                  <Badge variant="secondary" className="font-mono">
                    {tag}
                  </Badge>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                {t("done.close")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            {confirmAll ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>{t("confirmAll.warningTitle")}</AlertTitle>
                <AlertDescription>{t("confirmAll.warning")}</AlertDescription>
              </Alert>
            ) : (
              <>
                <fieldset className="space-y-2" disabled={busy}>
                  <legend className="mb-1 text-sm font-medium">{t("scope.label")}</legend>
                  <RadioGroup value={scope} onValueChange={(v) => { setScope(v as CachePurgeScope); setProblem(null); }} name={scopeName}>
                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <RadioGroupItem value="tags" className="mt-0.5" />
                      <span>
                        <span className="font-medium">{t("scope.tags")}</span>
                        <span className="block text-xs text-muted-foreground">{t("scope.tagsHint")}</span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <RadioGroupItem value="all" className="mt-0.5" />
                      <span>
                        <span className="font-medium">{t("scope.all")}</span>
                        <span className="block text-xs text-muted-foreground">{t("scope.allHint")}</span>
                      </span>
                    </label>
                  </RadioGroup>
                </fieldset>

                {scope === "tags" ? (
                  <div className="space-y-3">
                    <div>
                      <p className="mb-1.5 text-sm font-medium">{t("tags.pick")}</p>
                      <ul className="flex flex-wrap gap-1.5" aria-label={t("tags.pick")}>
                        {[...FIXED_PURGE_TAGS, ...MENU_PURGE_TAGS, ...uiTags].map((tag) => {
                          const on = tags.includes(tag);
                          return (
                            <li key={tag}>
                              <button
                                type="button"
                                aria-pressed={on}
                                disabled={busy}
                                onClick={() => toggle(tag)}
                                className={cn(
                                  "rounded-md border px-2 py-1 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                                  on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent"
                                )}
                              >
                                {tag}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={tagInputId}>{t("tags.custom")}</Label>
                      <div className="flex gap-2">
                        <Input
                          id={tagInputId}
                          value={draft}
                          placeholder="page:3"
                          className="font-mono"
                          disabled={busy}
                          aria-invalid={draftError ? true : undefined}
                          onChange={(e) => {
                            setDraft(e.target.value);
                            setDraftError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") addDraft(e);
                          }}
                        />
                        <Button type="button" variant="outline" disabled={busy || !draft.trim()} onClick={() => addDraft()}>
                          <PlusIcon />
                          {t("tags.add")}
                        </Button>
                      </div>
                      {draftError ? (
                        <p role="alert" className="text-sm text-destructive">
                          {draftError}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">{t("tags.customHint")}</p>
                      )}
                    </div>
                    <div>
                      <p className="mb-1.5 text-sm font-medium" aria-live="polite">
                        {t("tags.selected", { count: tags.length, max: MAX_PURGE_TAGS })}
                      </p>
                      {tags.length > 0 ? (
                        <ul className="flex flex-wrap gap-1.5" aria-label={t("tags.selectedList")}>
                          {tags.map((tag, index) => {
                            const bad = problem?.kind === "tags" && problem.indexes.includes(index);
                            return (
                              <li key={tag}>
                                <Badge variant={bad ? "destructive" : "secondary"} className="gap-1 font-mono">
                                  {tag}
                                  <button type="button" aria-label={t("tags.remove", { tag })} disabled={busy} onClick={() => toggle(tag)} className="rounded outline-none focus-visible:ring-2">
                                    <XIcon className="size-3" aria-hidden />
                                  </button>
                                </Badge>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">{t("tags.none")}</p>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label htmlFor={reasonId}>{t("reason.label")}</Label>
                  <Input id={reasonId} value={reason} maxLength={MAX_PURGE_REASON} disabled={busy} placeholder={t("reason.placeholder")} onChange={(e) => setReason(e.target.value)} />
                </div>
              </>
            )}

            {problem ? <ProblemAlert problem={problem} /> : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={confirmAll ? () => setConfirmAll(false) : onClose}
              >
                {confirmAll ? t("back") : t("cancel")}
              </Button>
              <Button type="submit" variant={confirmAll ? "destructive" : "default"} disabled={!canSubmit || busy}>
                {busy ? <Spinner /> : <EraserIcon />}
                {scope === "all" ? (confirmAll ? t("confirmAll.confirm") : t("submitAll")) : t("submitTags", { count: tags.length })}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProblemAlert({ problem }: { problem: Problem }) {
  const t = useTranslations("system.purge.problem");
  return (
    <Alert variant="destructive" role="alert" data-testid="purge-problem">
      <TriangleAlertIcon />
      <AlertTitle>{t(`${problem.kind}.title`)}</AlertTitle>
      <AlertDescription>
        {problem.kind === "rate"
          ? problem.seconds
            ? t("rate.bodyWait", { minutes: Math.max(1, Math.ceil(problem.seconds / 60)) })
            : t("rate.body")
          : problem.kind === "other"
            ? problem.message
            : t(`${problem.kind}.body`)}
      </AlertDescription>
    </Alert>
  );
}
