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
import { AuthorActivity } from "@/components/protected/authors/author-activity";
import {
  MAX_BIO,
  MAX_DISPLAY_NAME,
  MAX_JOB_TITLE,
  buildCreatePayload,
  buildUpdatePayload,
  draftFromAuthor,
  emptyAuthorDraft,
  isChanged,
  rowSnapshot,
  validate,
  type AuthorDraft,
} from "@/components/protected/authors/author-draft";
import { AuthorUserField } from "@/components/protected/authors/author-user-field";
import { PostMediaField } from "@/components/protected/posts/post-media-field";
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
import { useMutationCreateAuthor, useMutationUpdateAuthor } from "@/hooks/use-authors";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { isConflictError, isNoPermissionError, parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { newIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import { AuthorsAPI } from "@/services/authors.api";
import type { ApiFieldError } from "@/types/api";
import type { Author } from "@/types/authors";

type Locales = Array<{ code: string; name: string; is_default: boolean }>;

type Props = {
  target: { id: number } | "new";
  locales: Locales;
  defaultLocale: string;
  canCreate: boolean;
  canUpdate: boolean;
  canTranslate: boolean;
  onClose: () => void;
};

export function AuthorDialog(props: Props) {
  const t = useTranslations("authors.dialog");
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
  const query = useQuery({ queryKey: [API_ENDPOINTS.AUTHORS.DETAIL(props.id)], queryFn: () => AuthorsAPI.Get(props.id) });
  if (query.error && isNoPermissionError(query.error)) return <NoPermission className="min-h-40 py-8" />;
  if (query.error && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} className="min-h-40 py-8" />;
  if (!query.data) return <Skeleton className="h-48 w-full" />;
  return <Editor {...props} row={query.data.data.data} etag={query.data.etag} reload={() => query.refetch()} />;
}

function Editor({ row, etag, locales, defaultLocale, canCreate, canUpdate, canTranslate, onClose, reload }: Props & { row: Author | null; etag: string | undefined; reload: () => Promise<unknown> }) {
  const t = useTranslations("authors.dialog");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const creating = row === null;
  const codes = locales.map((l) => l.code);
  const create = useMutationCreateAuthor();
  const update = useMutationUpdateAuthor();
  const pending = create.isPending || update.isPending;
  // A translate-only caller edits the bio / job title of the languages that are not the default one, nothing else (doc/05 15.3).
  const translateOnly = !creating && canTranslate && !canUpdate;
  const canEdit = creating ? canCreate : canUpdate || canTranslate;
  const trashed = Boolean(row?.deleted_at);

  const saved = row ? draftFromAuthor(row, codes) : emptyAuthorDraft(codes);
  const [draft, setDraft] = useState<AuthorDraft>(saved);
  const [issues, setIssues] = useState<ApiFieldError[]>([]);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [tab, setTab] = useState("details");
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const id = useId();
  const dirty = isChanged(saved, draft);
  const detailKey = row ? [API_ENDPOINTS.AUTHORS.DETAIL(row.id)] : null;

  const set = (patch: Partial<AuthorDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setIssues([]);
  };
  const setTr = (code: string, patch: Partial<AuthorDraft["translations"][string]>) => {
    setDraft((d) => ({ ...d, translations: { ...d.translations, [code]: { ...d.translations[code], ...patch } } }));
    setIssues([]);
  };
  const err = (path: string) => {
    const issue = issues.find((i) => i.path === path);
    if (!issue) return undefined;
    // 409 on /user_id: the user already has an author.
    if (path === "/user_id" && issue.code === "duplicate") return t("userTaken");
    return translateFieldError(tErrors, issue);
  };

  const save = async (): Promise<boolean> => {
    const found = validate(draft);
    if (found.length) {
      setIssues(found);
      return false;
    }
    try {
      if (creating) {
        await create.mutateAsync({ payload: buildCreatePayload(draft), idempotencyKey });
        toast.success(t("created"));
        onClose();
        return true;
      }
      const payload = buildUpdatePayload(saved, draft, defaultLocale, { translateOnly });
      if (Object.keys(payload).length === 0) return true;
      const result = await update.mutateAsync({ id: row.id, payload, etag });
      toast.success(t("saved"));
      // The answer carries the new ETag: re-seed the cache the dialog reads from.
      queryClient.setQueryData(detailKey!, { data: result.data, etag: result.etag });
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
        if ((creating || dirty) && canEdit && !trashed) void save();
      }}
    >
      {translateOnly ? (
        <Alert>
          <AlertDescription>{t("translateOnly")}</AlertDescription>
        </Alert>
      ) : null}
      {trashed ? (
        <Alert>
          <AlertDescription>{t("trashed")}</AlertDescription>
        </Alert>
      ) : null}
      <fieldset disabled={!canEdit || pending || trashed} className="min-w-0 space-y-4 border-0 p-0">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>
            {t("displayName")}
            <span aria-hidden className="ml-0.5 text-destructive">*</span>
          </Label>
          <Input
            id={`${id}-name`}
            value={draft.displayName}
            disabled={translateOnly}
            autoComplete="off"
            aria-invalid={Boolean(err("/display_name"))}
            onChange={(e) => set({ displayName: e.target.value })}
          />
          <p className={cn("flex justify-between text-xs", err("/display_name") ? "text-destructive" : "text-muted-foreground")}>
            <span role={err("/display_name") ? "alert" : undefined}>{err("/display_name") ?? t("displayNameHelp")}</span>
            <span>{[...draft.displayName.trim()].length} / {MAX_DISPLAY_NAME}</span>
          </p>
        </div>

        <AuthorUserField
          id={`${id}-user`}
          userId={draft.userId}
          user={draft.user}
          disabled={!canEdit || pending || translateOnly || trashed}
          error={err("/user_id")}
          onChange={(userId, user) => set({ userId, user })}
        />

        <div className="space-y-1.5">
          <Label>{t("avatar")}</Label>
          <PostMediaField
            id={`${id}-avatar`}
            mediaId={draft.avatarId}
            onChange={(avatarId) => set({ avatarId })}
            disabled={!canEdit || pending || translateOnly || trashed}
            defaultLocale={defaultLocale}
            pickerTitle={t("avatarPicker")}
            label={t("avatar")}
            ratio="1/1"
          />
          {err("/avatar_media_id") ? <p role="alert" className="text-xs text-destructive">{err("/avatar_media_id")}</p> : <p className="text-xs text-muted-foreground">{t("avatarHelp")}</p>}
        </div>

        <div className="flex items-center gap-2">
          <Switch id={`${id}-active`} checked={draft.isActive} disabled={translateOnly} onCheckedChange={(v) => set({ isActive: v })} />
          <Label htmlFor={`${id}-active`} className="font-normal">{t("active")}</Label>
          <span className="text-xs text-muted-foreground">{t("activeHelp")}</span>
        </div>

        {locales.map((l) => {
          const tr = draft.translations[l.code] ?? { bio: "", jobTitle: "" };
          // A translator may not write the default language.
          const locked = translateOnly && l.is_default;
          const bioErr = err(`/translations/${l.code}/bio`);
          const jobErr = err(`/translations/${l.code}/job_title`);
          return (
            <fieldset key={l.code} disabled={locked} className="min-w-0 space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium leading-snug">
                {l.name} {l.is_default ? <span className="text-xs font-normal text-muted-foreground">({t("default")})</span> : null}
              </legend>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-${l.code}-job`}>{t("jobTitle")}</Label>
                <Input id={`${id}-${l.code}-job`} name={`job_title-${l.code}`} value={tr.jobTitle} autoComplete="off" aria-invalid={Boolean(jobErr)} onChange={(e) => setTr(l.code, { jobTitle: e.target.value })} />
                <p className={cn("flex justify-between text-xs", jobErr ? "text-destructive" : "text-muted-foreground")}>
                  <span role={jobErr ? "alert" : undefined}>{jobErr}</span>
                  <span>{[...tr.jobTitle.trim()].length} / {MAX_JOB_TITLE}</span>
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-${l.code}-bio`}>{t("bio")}</Label>
                <Textarea id={`${id}-${l.code}-bio`} name={`bio-${l.code}`} rows={3} value={tr.bio} aria-invalid={Boolean(bioErr)} onChange={(e) => setTr(l.code, { bio: e.target.value })} />
                <p className={cn("flex justify-between text-xs", bioErr ? "text-destructive" : "text-muted-foreground")}>
                  <span role={bioErr ? "alert" : undefined}>{bioErr}</span>
                  <span>{[...tr.bio.trim()].length} / {MAX_BIO}</span>
                </p>
              </div>
            </fieldset>
          );
        })}
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>{t("close")}</Button>
        {canEdit && !trashed ? (
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
            <TabsTrigger value="activity">{t("tabs.activity")}</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="pt-3">{form}</TabsContent>
          <TabsContent value="history" className="pt-3">
            <RevisionsTab
              resource="authors"
              id={row.id}
              canRestore={canUpdate && !row.deleted_at}
              etag={etag}
              currentSnapshot={rowSnapshot(row) as unknown as Record<string, unknown>}
              onRefresh={reload}
              onRestored={({ data, etag: nextEtag }) => {
                queryClient.setQueryData(detailKey!, { data: { success: true, data }, etag: nextEtag });
                void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.AUTHORS.LIST] });
                toast.success(t("restored"));
                setTab("details");
                setDraft(draftFromAuthor(data as unknown as Author, codes));
              }}
            />
          </TabsContent>
          <TabsContent value="activity" className="pt-3">
            <AuthorActivity authorId={row.id} />
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
