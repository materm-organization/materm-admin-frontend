"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import {
  MAX_PATH,
  MAX_TITLE,
  buildCreatePayload,
  emptyCreateDraft,
  pathFromTitle,
  validateCreate,
  type CreateDraft,
  type CreateProblems,
} from "@/components/protected/pages/page-draft";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useMutationCreatePage, usePageTemplates } from "@/hooks/use-pages";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import type { ApiFieldError } from "@/types/api";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; defaultLocale: string };

// SCR-19 "New page" (doc/07 section 3.11): a template (its description and the sections it starts with), the title in
// the default language and the address (filled from the title until it is edited). On success the new page (a draft,
// with the sections its template requires) opens. One Idempotency-Key per open of the dialog.
export function PageCreateDialog({ open, onOpenChange, defaultLocale }: Props) {
  const t = useTranslations("pages.create");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {open ? <CreateForm onClose={() => onOpenChange(false)} defaultLocale={defaultLocale} open={open} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onClose, defaultLocale, open }: { onClose: () => void; defaultLocale: string; open: boolean }) {
  const t = useTranslations("pages.create");
  const tErr = useTranslations("errors");
  const router = useRouter();
  const ids = { template: useId(), title: useId(), path: useId() };
  const { toastError } = useApiErrorHandler();
  const templates = usePageTemplates();
  const create = useMutationCreatePage();
  const key = useIdempotencyKey(open);

  const list = useMemo(() => templates.data?.data ?? [], [templates.data]);
  const [draft, setDraft] = useState<CreateDraft | null>(null);
  // The default template is chosen as soon as the registry is here.
  const current: CreateDraft = draft ?? emptyCreateDraft(list);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ApiFieldError[]>([]);
  const problems: CreateProblems = validateCreate(current);
  const template = list.find((x) => x.key === current.template);

  const update = (patch: Partial<CreateDraft>) => {
    setServerErrors([]);
    setDraft({ ...current, ...patch });
  };
  const serverError = (path: string) => serverErrors.find((e) => e.path === path || (path === "title" && e.path.endsWith("/title")));
  const fieldError = (name: "template" | "title" | "path"): string | null => {
    const server = name === "path" ? serverError("/path") : name === "template" ? serverError("/template") : serverError("title");
    if (server) return server.code === "duplicate" ? t("errors.pathTaken") : translateFieldError(tErr, server);
    const problem = problems[name];
    if (!submitted || !problem) return null;
    return t(`errors.${name}.${problem}`);
  };

  const submit = async () => {
    setSubmitted(true);
    if (Object.keys(problems).length > 0) return;
    try {
      const result = await create.mutateAsync({ payload: buildCreatePayload(current, defaultLocale), idempotencyKey: key });
      toast.success(t("created"));
      onClose();
      router.push(`/admin/pages/${result.data.data.id}`);
    } catch (error) {
      const parsed = parseApiError(error);
      if ((parsed.status === 422 || parsed.status === 409) && parsed.fieldErrors.length > 0) setServerErrors(parsed.fieldErrors);
      else toastError(error, t("failed"));
    }
  };

  if (templates.error && isNoPermissionError(templates.error)) return <NoPermission className="min-h-40 py-8" />;
  if (templates.error && !templates.data) return <ErrorState error={templates.error} onRetry={() => void templates.refetch()} isRetrying={templates.isFetching} className="min-h-40 py-8" />;
  if (templates.isLoading) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>;

  const required = template?.required ?? [];
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={ids.template}>{t("template")}</Label>
        <Select value={current.template} onValueChange={(value) => update({ template: value })} disabled={create.isPending}>
          <SelectTrigger id={ids.template} className="w-full" aria-invalid={Boolean(fieldError("template"))}>
            <SelectValue placeholder={t("templatePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {list.map((x) => (
              <SelectItem key={x.key} value={x.key}>
                {t.has(`templates.${x.key}.name`) ? t(`templates.${x.key}.name`) : x.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {template ? (
          <div className="rounded-md border bg-muted/30 p-3 text-sm" data-testid="template-summary">
            <p>{t.has(`templates.${template.key}.description`) ? t(`templates.${template.key}.description`) : template.description}</p>
            <p className="mt-2 text-muted-foreground">
              {t("startsWith")}{" "}
              <span className="font-medium text-foreground">
                {template.initial_sections.map((s) => template.allowed_sections.find((a) => a.section_type_key === s.section_type_key)?.name ?? s.section_type_key).join(", ")}
              </span>
            </p>
            {required.length > 0 ? (
              <p className="text-muted-foreground">
                {t("mustHave")}{" "}
                <span className="font-medium text-foreground">
                  {required
                    .map((r) => (r.kind === "group" ? t("heroGroup") : (template.allowed_sections.find((a) => a.section_type_key === r.section_type_keys[0])?.name ?? r.section_type_keys[0])))
                    .join(", ")}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
        {fieldError("template") ? <p className="text-sm text-destructive">{fieldError("template")}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.title}>{t("titleLabel", { locale: defaultLocale.toUpperCase() })}</Label>
        <Input
          id={ids.title}
          value={current.title}
          maxLength={MAX_TITLE + 20}
          autoComplete="off"
          disabled={create.isPending}
          aria-invalid={Boolean(fieldError("title"))}
          onChange={(e) => {
            const title = e.target.value;
            // The address follows the title until the author edits it.
            update({ title, ...(current.pathEdited ? {} : { path: pathFromTitle(title) }) });
          }}
        />
        {fieldError("title") ? <p className="text-sm text-destructive">{fieldError("title")}</p> : <p className="text-xs text-muted-foreground">{t("titleHint")}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.path}>{t("pathLabel")}</Label>
        <Input
          id={ids.path}
          value={current.path}
          maxLength={MAX_PATH + 20}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          disabled={create.isPending}
          aria-invalid={Boolean(fieldError("path"))}
          onChange={(e) => update({ path: e.target.value, pathEdited: true })}
        />
        {fieldError("path") ? <p className="text-sm text-destructive">{fieldError("path")}</p> : <p className="text-xs text-muted-foreground">{t("pathHint")}</p>}
      </div>

      {serverErrors.length > 0 && !serverErrors.some((e) => ["/path", "/template"].includes(e.path) || e.path.endsWith("/title")) ? (
        <Alert variant="destructive">
          <AlertDescription>{serverErrors.map((e) => translateFieldError(tErr, e)).join(" ")}</AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" disabled={create.isPending} onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner /> : <PlusIcon />}
          {t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
