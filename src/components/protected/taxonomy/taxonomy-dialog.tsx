"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SaveIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ConflictDialog } from "@/components/global/conflict-dialog";
import { RevisionsTab } from "@/components/global/revisions/revisions-tab";
import { ErrorState } from "@/components/global/states/error-state";
import { NoPermission } from "@/components/layout/no-permission";
import {
  MAX_DESCRIPTION,
  MAX_NAME,
  buildCreatePayload,
  buildUpdatePayload,
  draftFromRow,
  emptyTaxonomyDraft,
  isChanged,
  rowSnapshot,
  validate,
  type TaxonomyDraft,
} from "@/components/protected/taxonomy/taxonomy-draft";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import {
  useMutationCreateCategory,
  useMutationCreateTag,
  useMutationUpdateCategory,
  useMutationUpdateTag,
} from "@/hooks/use-taxonomy";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, isNoPermissionError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { newIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import { CategoriesAPI, TagsAPI } from "@/services/taxonomy.api";
import type { ApiFieldError } from "@/types/api";
import type { Category, Tag, TaxonomyKind } from "@/types/taxonomy";

type Locales = Array<{ code: string; name: string; is_default: boolean }>;

type Props = {
  kind: TaxonomyKind;
  // null = create; a row = edit (the dialog reads the row itself to get its ETag).
  target: { id: number } | "new";
  locales: Locales;
  defaultLocale: string;
  nextSortOrder: number;
  canUpdate: boolean;
  canTranslate: boolean;
  onClose: () => void;
};

export function TaxonomyDialog(props: Props) {
  const t = useTranslations("taxonomy.dialog");
  const { kind, target, onClose } = props;
  const creating = target === "new";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{creating ? t(`${kind}.createTitle`) : t(`${kind}.editTitle`)}</DialogTitle>
          <DialogDescription>{creating ? t("createDescription") : t("editDescription")}</DialogDescription>
        </DialogHeader>
        {creating ? <Editor {...props} row={null} etag={undefined} reload={async () => undefined} /> : <Loader {...props} id={(target as { id: number }).id} />}
      </DialogContent>
    </Dialog>
  );
}

function Loader(props: Props & { id: number }) {
  const { kind, id } = props;
  const query = useQuery({
    queryKey: [kind === "categories" ? API_ENDPOINTS.CATEGORIES.DETAIL(id) : API_ENDPOINTS.TAGS.DETAIL(id)],
    queryFn: () => (kind === "categories" ? CategoriesAPI.Get(id) : TagsAPI.Get(id)),
  });
  if (query.error && isNoPermissionError(query.error)) return <NoPermission />;
  if (query.error && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  if (!query.data) return <Skeleton className="h-48 w-full" />;
  const row = query.data.data.data as Category | Tag;
  return <Editor {...props} row={row} etag={query.data.etag} reload={() => query.refetch()} />;
}

function Editor({ kind, row, etag, locales, defaultLocale, nextSortOrder, canUpdate, canTranslate, onClose, reload }: Props & { row: Category | Tag | null; etag: string | undefined; reload: () => Promise<unknown> }) {
  const t = useTranslations("taxonomy.dialog");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const creating = row === null;
  const codes = locales.map((l) => l.code);
  const createCategory = useMutationCreateCategory();
  const createTag = useMutationCreateTag();
  const updateCategory = useMutationUpdateCategory();
  const updateTag = useMutationUpdateTag();
  const pending = createCategory.isPending || createTag.isPending || updateCategory.isPending || updateTag.isPending;
  const translateOnly = !creating && canTranslate && !canUpdate;
  const canEdit = creating ? canUpdate : canUpdate || canTranslate;

  const saved = row ? draftFromRow(row, codes) : emptyTaxonomyDraft(codes, nextSortOrder);
  const [draft, setDraft] = useState<TaxonomyDraft>(saved);
  const [issues, setIssues] = useState<ApiFieldError[]>([]);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [tab, setTab] = useState("details");
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [warning, setWarning] = useState<string | null>(null);
  const id = useId();
  const dirty = isChanged(saved, draft, kind);

  const setTr = (code: string, patch: Partial<TaxonomyDraft["translations"][string]>) => {
    setDraft((d) => ({ ...d, translations: { ...d.translations, [code]: { ...d.translations[code], ...patch } } }));
    setIssues([]);
  };
  const err = (path: string) => {
    const issue = issues.find((i) => i.path === path);
    return issue ? translateFieldError(tErrors, issue) : undefined;
  };

  const save = async (): Promise<boolean> => {
    const found = validate(kind, draft, defaultLocale, creating ? "create" : "edit");
    if (found.length) {
      setIssues(found);
      return false;
    }
    try {
      if (creating) {
        const payload = buildCreatePayload(kind, draft);
        if (kind === "categories") await createCategory.mutateAsync({ payload: payload as never, idempotencyKey });
        else await createTag.mutateAsync({ payload: payload as never, idempotencyKey });
        toast.success(t("created"));
        onClose();
        return true;
      }
      const payload = buildUpdatePayload(kind, saved, draft, defaultLocale, { translateOnly });
      if (Object.keys(payload).length === 0) return true;
      const result =
        kind === "categories"
          ? await updateCategory.mutateAsync({ id: row.id, payload: payload as never, etag })
          : await updateTag.mutateAsync({ id: row.id, payload: payload as never, etag });
      const warnings = (result.data.data as Category).warnings ?? [];
      if (warnings.some((w) => w.code === "category_in_use")) setWarning(t("categoryInUse"));
      toast.success(t("saved"));
      // The answer carries the new ETag: re-seed the cache the dialog reads from.
      queryClient.setQueryData([kind === "categories" ? API_ENDPOINTS.CATEGORIES.DETAIL(row.id) : API_ENDPOINTS.TAGS.DETAIL(row.id)], { data: result.data, etag: result.etag });
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

  const form = (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if ((creating || dirty) && canEdit) void save();
      }}
    >
      {translateOnly ? (
        <Alert>
          <AlertDescription>{t("translateOnly")}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-key`}>{t("key")}</Label>
        <Input
          id={`${id}-key`}
          className="font-mono"
          value={draft.key}
          readOnly={!creating}
          disabled={creating ? pending : false}
          autoComplete="off"
          aria-invalid={Boolean(err("/key"))}
          onChange={(e) => {
            setDraft((d) => ({ ...d, key: e.target.value }));
            setIssues([]);
          }}
        />
        <p className={cn("text-xs", err("/key") ? "text-destructive" : "text-muted-foreground")} role={err("/key") ? "alert" : undefined}>
          {err("/key") ?? (creating ? t(`${kind}.keyHelp`) : t("keyImmutable"))}
        </p>
      </div>

      {locales.map((l) => {
        const tr = draft.translations[l.code];
        const nonDefaultSlugOk = !translateOnly || !l.is_default;
        return (
          <fieldset key={l.code} className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">
              {l.name} {l.is_default ? <span className="text-xs font-normal text-muted-foreground">({t("default")})</span> : null}
            </legend>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-${l.code}-name`}>{t("name")}{l.is_default ? <span aria-hidden className="ml-0.5 text-destructive">*</span> : null}</Label>
              <Input
                id={`${id}-${l.code}-name`}
                name={`name-${l.code}`}
                value={tr.name}
                disabled={!canEdit || pending}
                autoComplete="off"
                aria-invalid={Boolean(err(`/translations/${l.code}/name`))}
                onChange={(e) => setTr(l.code, { name: e.target.value })}
              />
              <p className={cn("flex justify-between text-xs", err(`/translations/${l.code}/name`) ? "text-destructive" : "text-muted-foreground")}>
                <span role={err(`/translations/${l.code}/name`) ? "alert" : undefined}>{err(`/translations/${l.code}/name`)}</span>
                <span>{[...tr.name.trim()].length} / {MAX_NAME}</span>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-${l.code}-slug`}>{t("slug")}</Label>
              <Input
                id={`${id}-${l.code}-slug`}
                name={`slug-${l.code}`}
                className="font-mono"
                value={tr.slug}
                disabled={!canEdit || pending || !nonDefaultSlugOk}
                autoComplete="off"
                placeholder={draft.key || undefined}
                aria-invalid={Boolean(err(`/translations/${l.code}/slug`))}
                onChange={(e) => setTr(l.code, { slug: e.target.value })}
              />
              <p className={cn("text-xs", err(`/translations/${l.code}/slug`) ? "text-destructive" : "text-muted-foreground")} role={err(`/translations/${l.code}/slug`) ? "alert" : undefined}>
                {err(`/translations/${l.code}/slug`) ?? t("slugHelp")}
              </p>
            </div>
            {kind === "categories" ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-${l.code}-desc`}>{t("descriptionLabel")}</Label>
                <Textarea
                  id={`${id}-${l.code}-desc`}
                  name={`description-${l.code}`}
                  rows={2}
                  value={tr.description}
                  disabled={!canEdit || pending}
                  aria-invalid={Boolean(err(`/translations/${l.code}/description`))}
                  onChange={(e) => setTr(l.code, { description: e.target.value })}
                />
                <p className={cn("flex justify-between text-xs", err(`/translations/${l.code}/description`) ? "text-destructive" : "text-muted-foreground")}>
                  <span role={err(`/translations/${l.code}/description`) ? "alert" : undefined}>{err(`/translations/${l.code}/description`)}</span>
                  <span>{[...tr.description.trim()].length} / {MAX_DESCRIPTION}</span>
                </p>
              </div>
            ) : null}
          </fieldset>
        );
      })}

      {kind === "categories" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-sort`}>{t("sortOrder")}</Label>
            <Input
              id={`${id}-sort`}
              inputMode="numeric"
              value={draft.sortOrder}
              disabled={!canEdit || pending || translateOnly}
              aria-invalid={Boolean(err("/sort_order"))}
              onChange={(e) => {
                setDraft((d) => ({ ...d, sortOrder: e.target.value }));
                setIssues([]);
              }}
            />
            {err("/sort_order") ? <p role="alert" className="text-xs text-destructive">{err("/sort_order")}</p> : null}
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch id={`${id}-active`} checked={draft.isActive} disabled={!canEdit || pending || translateOnly} onCheckedChange={(v) => setDraft((d) => ({ ...d, isActive: v }))} />
            <Label htmlFor={`${id}-active`} className="font-normal">{t("active")}</Label>
          </div>
        </div>
      ) : null}

      {warning ? <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{warning}</p> : null}

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
            <RevisionsTab
              resource={kind}
              id={row.id}
              canRestore={canUpdate && !row.deleted_at}
              etag={etag}
              currentSnapshot={rowSnapshot(kind, row)}
              onRefresh={reload}
              onRestored={({ data, etag: nextEtag }) => {
                queryClient.setQueryData([kind === "categories" ? API_ENDPOINTS.CATEGORIES.DETAIL(row.id) : API_ENDPOINTS.TAGS.DETAIL(row.id)], { data: { success: true, data }, etag: nextEtag });
                void queryClient.invalidateQueries({ queryKey: [kind === "categories" ? API_ENDPOINTS.CATEGORIES.LIST : API_ENDPOINTS.TAGS.LIST] });
                toast.success(t("restored"));
                setTab("details");
                setDraft(draftFromRow(data as unknown as Category, codes));
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
