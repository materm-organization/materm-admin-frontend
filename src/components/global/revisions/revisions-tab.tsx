"use client";

import { useQueryClient } from "@tanstack/react-query";
import { EyeIcon, HistoryIcon, RotateCcwIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { ConflictDialog } from "@/components/global/conflict-dialog";
import { CustomPagination } from "@/components/global/custom-pagination";
import { EmptyMuted } from "@/components/global/empty";
import { ErrorState } from "@/components/global/states/error-state";
import { FetchingBar } from "@/components/global/states/fetching-bar";
import { NoPermission } from "@/components/layout/no-permission";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMutationRestoreRevision, useRevision, useRevisions } from "@/hooks/use-revisions";
import { API_ERROR_CODES, isConflictError, isGloballyToasted, isNoPermissionError, parseApiError } from "@/lib/api-error";
import { translateApiError, translateFieldError } from "@/lib/api-error-messages";
import { withEtag } from "@/lib/etag";
import {
  REVISION_RESOURCES,
  revisionsQueryKey,
  type RevisionEntityId,
  type RevisionResource,
} from "@/lib/revision-resources";
import { axiosInstance } from "@/lib/axios";
import type { ApiFieldError } from "@/types/api";
import type { RestoredFrom, RevisionSummary } from "@/types/revisions";

import { DiffView, SnapshotView } from "./diff-view";
import { humanizeSegment, pointerToSegments } from "./snapshot-diff";

export type RestoredRevision = {
  // The entity in the shape of its own GET (the API answers it with the restore).
  data: Record<string, unknown>;
  // The NEW ETag of the entity: put it in the editor's cache (`setQueryData`) instead of refetching.
  etag: string | undefined;
  restoredFrom: RestoredFrom | undefined;
};

export type RevisionsTabProps = {
  resource: RevisionResource;
  id: RevisionEntityId;
  // The user may restore (the editor decides from its permissions: `{key}:update`, `update_own` for media).
  canRestore: boolean;
  // Called after a successful restore: refresh / re-seed the entity's own queries here.
  onRestored: (result: RestoredRevision) => void | Promise<void>;
  // The entity's CURRENT ETag, as the editor holds it - the `If-Match` of a restore (mandatory, 428 without).
  // When omitted the tab asks `resolveEtag`, then the entity's own GET (menus, settings, categories, tags,
  // media assets); a resource without a single-entity read (ui-strings) needs one of the first two.
  etag?: string;
  resolveEtag?: () => Promise<string | undefined>;
  // "Load the latest version" of the ConflictDialog (after a 409 / 412): the editor refetches the entity.
  onRefresh?: () => void | Promise<unknown>;
  // The entity's current state in the SAME shape as a revision snapshot (05 11.7 item 3). With it the detail view can
  // answer "what would restoring this change?". Optional.
  currentSnapshot?: Record<string, unknown>;
  // Wording of the restore warning: save-live entities change the website at once (default); the publishable
  // ones (T1.4.7) become the working draft instead.
  restoreEffect?: "immediate" | "draft";
  pageSize?: number;
  className?: string;
};

async function fetchEntityEtag(resource: RevisionResource, id: RevisionEntityId): Promise<string | undefined> {
  const path = REVISION_RESOURCES[resource].entityPath?.(id);
  if (!path) return undefined;
  return withEtag(await axiosInstance.get(path)).etag;
}

type RestoreIssue =
  | { kind: "incompatible" }
  | { kind: "trashed" }
  | { kind: "refs"; errors: ApiFieldError[] }
  | { kind: "duplicate"; errors: ApiFieldError[] }
  | { kind: "missingEtag" }
  | { kind: "other"; message: string };

// SCR-37 (doc/07 section 3.23, doc/05 section 11.7): the history of one save-live entity. `resource` + `id` pick
// the endpoint (`GET /{e}/{id}/revisions`); rows are "the state before an edit" (who/when = the edit that replaced
// it). A row opens a read-only view of the snapshot - as fields, never raw JSON - with a comparison against the
// current state or another version; "Restore" asks first (it is live at once), sends `If-Match`, reports the
// result and hands the new entity to `onRestored`. Reusable by every editor:
//
//   <RevisionsTab resource="menus" id={menu.key} canRestore={canUpdate} etag={etag}
//                 onRestored={({ data, etag }) => queryClient.setQueryData(menuKey, ...)} onRefresh={refetch} />
export function RevisionsTab({
  resource,
  id,
  canRestore,
  onRestored,
  etag,
  resolveEtag,
  onRefresh,
  currentSnapshot,
  restoreEffect = "immediate",
  pageSize = 20,
  className,
}: RevisionsTabProps) {
  const t = useTranslations("revisions");
  const format = useFormatter();
  const switchId = useId();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showPreview, setShowPreview] = useState(false);
  const [viewing, setViewing] = useState<RevisionSummary | null>(null);
  const [restoring, setRestoring] = useState<RevisionSummary | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  const query = useMemo(
    () => ({ page, limit: pageSize, ...(showPreview ? { include_preview: true } : {}), sort: "-version" as const }),
    [page, pageSize, showPreview]
  );
  const { data, isLoading, isFetching, error, refetch } = useRevisions(resource, id, query);
  // Preview rows are hidden by default (Q-07-9): the API leaves them out already; filter here too so a backend that
  // ignores `include_preview` (save-live has no previews) still behaves the same.
  const rows = useMemo(() => (data?.data ?? []).filter((r) => showPreview || !r.is_preview), [data, showPreview]);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const kindLabel = (kind: string) => (t.has(`kind.${kind}`) ? t(`kind.${kind}`) : kind);

  const reload = async () => {
    setIsReloading(true);
    try {
      await onRefresh?.();
      await refetch();
    } finally {
      setIsReloading(false);
    }
  };

  if (error && isNoPermissionError(error)) return <NoPermission />;
  if (error && !data) return <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} />;

  return (
    <div className={className} data-testid="revisions-tab">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("explain")}</p>
        <div className="flex items-center gap-2">
          <Switch
            id={switchId}
            checked={showPreview}
            onCheckedChange={(checked) => {
              setShowPreview(checked);
              setPage(1);
            }}
          />
          <Label htmlFor={switchId} className="text-sm font-normal">
            {t("showPreview")}
          </Label>
        </div>
      </div>

      <FetchingBar active={isFetching && !isLoading} />
      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyMuted title={t("empty")} description={t("emptyHint")} />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.version")}</TableHead>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.replacedAt")}</TableHead>
                <TableHead>{t("columns.by")}</TableHead>
                <TableHead>{t("columns.note")}</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((revision) => (
                <TableRow key={revision.id}>
                  <TableCell className="font-mono">v{revision.version}</TableCell>
                  <TableCell>
                    <Badge variant={revision.kind === "restore" ? "secondary" : "outline"}>{kindLabel(revision.kind)}</Badge>
                    {revision.is_preview ? <Badge variant="outline" className="ml-1">{t("previewBadge")}</Badge> : null}
                  </TableCell>
                  <TableCell>
                    <time dateTime={revision.created_at}>{when(revision.created_at)}</time>
                  </TableCell>
                  <TableCell>{revision.created_by?.name ?? t("system")}</TableCell>
                  <TableCell className="max-w-64 truncate" title={revision.change_note ?? undefined}>
                    {revision.change_note ?? "—"}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t("viewVersion", { version: revision.version })}
                      onClick={() => setViewing(revision)}
                    >
                      <EyeIcon />
                      {t("viewButton")}
                    </Button>
                    {canRestore ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={t("restoreVersion", { version: revision.version })}
                        onClick={() => setRestoring(revision)}
                      >
                        <RotateCcwIcon />
                        {t("restore.button")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data?.meta ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t("total", { total: data.meta.total })}
          </p>
          <CustomPagination
            metaData={data.meta}
            onPageChange={setPage}
            isLoading={isFetching}
            rowLimit={pageSize}
            setRowLimit={() => undefined}
          />
        </div>
      ) : null}

      {viewing ? (
        <RevisionViewDialog
          resource={resource}
          id={id}
          revision={viewing}
          rows={rows}
          currentSnapshot={currentSnapshot}
          canRestore={canRestore}
          onClose={() => setViewing(null)}
          onRestore={() => {
            setRestoring(viewing);
            setViewing(null);
          }}
        />
      ) : null}

      {restoring ? (
        <RestoreDialog
          resource={resource}
          id={id}
          revision={restoring}
          etag={etag}
          resolveEtag={resolveEtag}
          effect={restoreEffect}
          onClose={() => setRestoring(null)}
          onConflict={() => {
            setRestoring(null);
            setConflictOpen(true);
          }}
          onDone={async (result) => {
            setRestoring(null);
            toast.success(t("restore.success", { version: restoring.version }));
            void queryClient.invalidateQueries({ queryKey: revisionsQueryKey(resource, id) });
            await onRestored(result);
          }}
        />
      ) : null}

      <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} onReload={reload} isReloading={isReloading} />
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------
// One version, read-only: "Fields" (the snapshot) and "Changes" (a comparison).
// -------------------------------------------------------------------------------------------------------------
const NONE = "none";
const CURRENT = "current";

function RevisionViewDialog({
  resource,
  id,
  revision,
  rows,
  currentSnapshot,
  canRestore,
  onClose,
  onRestore,
}: {
  resource: RevisionResource;
  id: RevisionEntityId;
  revision: RevisionSummary;
  rows: RevisionSummary[];
  currentSnapshot?: Record<string, unknown>;
  canRestore: boolean;
  onClose: () => void;
  onRestore: () => void;
}) {
  const t = useTranslations("revisions");
  const format = useFormatter();
  const selectId = useId();
  const others = rows.filter((r) => r.id !== revision.id);
  const previous = rows.find((r) => r.version === revision.version - 1);
  const defaultCompare = currentSnapshot ? CURRENT : previous ? `rev:${previous.id}` : NONE;
  const [compare, setCompare] = useState<string>(defaultCompare);

  const { data, isLoading, error, refetch } = useRevision(resource, id, revision.id);
  const compareRevId = compare.startsWith("rev:") ? Number(compare.slice(4)) : undefined;
  const compareQuery = useRevision(resource, id, compareRevId);
  const compareVersion = others.find((r) => r.id === compareRevId)?.version;

  const snapshot = data?.data.snapshot;
  const compareSnapshot = compare === CURRENT ? currentSnapshot : compareQuery.data?.data.snapshot;
  const when = format.dateTime(new Date(revision.created_at), { dateStyle: "medium", timeStyle: "short" });

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[90vh] flex-col md:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HistoryIcon className="size-5" aria-hidden />
            {t("view.title", { version: revision.version })}
          </DialogTitle>
          <DialogDescription>
            {t("view.description", { when, by: revision.created_by?.name ?? t("system") })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && isNoPermissionError(error) ? (
            <NoPermission />
          ) : error ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : isLoading || !snapshot ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <Tabs defaultValue={compare === NONE ? "fields" : "changes"}>
              <TabsList>
                <TabsTrigger value="fields">{t("view.fields")}</TabsTrigger>
                <TabsTrigger value="changes">{t("view.changes")}</TabsTrigger>
              </TabsList>
              <TabsContent value="fields" className="pt-3">
                <SnapshotView snapshot={snapshot} />
              </TabsContent>
              <TabsContent value="changes" className="space-y-3 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={selectId} className="text-sm">
                    {t("compare.label")}
                  </Label>
                  <Select value={compare} onValueChange={setCompare}>
                    <SelectTrigger id={selectId} size="sm" className="w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("compare.none")}</SelectItem>
                      {currentSnapshot ? <SelectItem value={CURRENT}>{t("compare.current")}</SelectItem> : null}
                      {others.map((r) => (
                        <SelectItem key={r.id} value={`rev:${r.id}`}>
                          {t("compare.version", { version: r.version })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {compare === NONE ? (
                  <p className="text-sm text-muted-foreground">{t("compare.pick")}</p>
                ) : compareSnapshot ? (
                  <>
                    <p className="text-sm font-medium">
                      {compare === CURRENT
                        ? t("compare.restorePreview", { version: revision.version })
                        : t("compare.fromTo", { from: compareVersion ?? "?", to: revision.version })}
                    </p>
                    <DiffView before={compareSnapshot} after={snapshot} />
                  </>
                ) : compareQuery.error ? (
                  <ErrorState error={compareQuery.error} onRetry={() => void compareQuery.refetch()} />
                ) : (
                  <Skeleton className="h-16 w-full" />
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
          {canRestore ? (
            <Button type="button" onClick={onRestore}>
              <RotateCcwIcon />
              {t("restore.button")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------------------------------------------------
// Restore: confirm -> POST with If-Match -> result.
// -------------------------------------------------------------------------------------------------------------
function RestoreDialog({
  resource,
  id,
  revision,
  etag,
  resolveEtag,
  effect,
  onClose,
  onConflict,
  onDone,
}: {
  resource: RevisionResource;
  id: RevisionEntityId;
  revision: RevisionSummary;
  etag?: string;
  resolveEtag?: () => Promise<string | undefined>;
  effect: "immediate" | "draft";
  onClose: () => void;
  onConflict: () => void;
  onDone: (result: RestoredRevision) => void | Promise<void>;
}) {
  const t = useTranslations("revisions.restore");
  const tRev = useTranslations("revisions");
  const tErr = useTranslations("errors");
  const format = useFormatter();
  const noteId = useId();
  const mutation = useMutationRestoreRevision(resource, id);
  const [note, setNote] = useState("");
  const [issue, setIssue] = useState<RestoreIssue | null>(null);
  const [running, setRunning] = useState(false);
  const busy = running || mutation.isPending;

  const submit = async () => {
    setIssue(null);
    setRunning(true);
    try {
      // The editor's own ETag is what the user was looking at; without one, ask for the current one.
      const current = etag ?? (await (resolveEtag?.() ?? fetchEntityEtag(resource, id)));
      if (!current) {
        setIssue({ kind: "missingEtag" });
        return;
      }
      const result = await mutation.mutateAsync({ revId: revision.id, etag: current, changeNote: note.trim() || undefined });
      await onDone({
        data: result.data.data,
        etag: result.etag,
        restoredFrom: result.data.data.restored_from,
      });
    } catch (error) {
      if (isConflictError(error)) {
        onConflict();
        return;
      }
      const parsed = parseApiError(error);
      if (parsed.status === 409 && parsed.code === API_ERROR_CODES.CONFLICT_DUPLICATE) {
        setIssue({ kind: "duplicate", errors: parsed.fieldErrors });
      } else if (parsed.status === 409 && parsed.code === "INVALID_STATE") {
        const reason = parsed.details?.reason;
        if (reason === "snapshot_incompatible") setIssue({ kind: "incompatible" });
        else if (reason === "trashed") setIssue({ kind: "trashed" });
        else setIssue({ kind: "other", message: translateApiError(tErr, parsed) });
      } else if (parsed.status === 422) {
        setIssue({ kind: "refs", errors: parsed.fieldErrors });
      } else if (!isGloballyToasted(parsed)) {
        setIssue({ kind: "other", message: translateApiError(tErr, parsed) });
      }
    } finally {
      setRunning(false);
    }
  };

  const when = format.dateTime(new Date(revision.created_at), { dateStyle: "medium", timeStyle: "short" });
  const pathLabel = (fe: ApiFieldError) =>
    pointerToSegments(fe.path)
      .map((s) => (/^\d+$/.test(s) ? `#${Number(s) + 1}` : tRev.has(`fields.${s}`) ? tRev(`fields.${s}`) : humanizeSegment(s)))
      .join(" › ");

  return (
    <Dialog open onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title", { version: revision.version })}</DialogTitle>
          <DialogDescription>{t("description", { version: revision.version, when })}</DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertTitle>{effect === "immediate" ? t("liveTitle") : t("draftTitle")}</AlertTitle>
          <AlertDescription>{effect === "immediate" ? t("liveBody") : t("draftBody")}</AlertDescription>
        </Alert>

        <div className="space-y-1.5">
          <Label htmlFor={noteId}>{t("note")}</Label>
          <Input id={noteId} maxLength={200} value={note} disabled={busy} placeholder={t("notePlaceholder", { version: revision.version })} onChange={(e) => setNote(e.target.value)} />
        </div>

        {issue ? (
          <Alert variant="destructive" role="alert" data-testid="restore-issue">
            <AlertTitle>{t(`issue.${issue.kind}.title`)}</AlertTitle>
            <AlertDescription>
              {issue.kind === "other" ? (
                issue.message
              ) : (
                <>
                  <span>{t(`issue.${issue.kind}.body`)}</span>
                  {issue.kind === "refs" || issue.kind === "duplicate" ? (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5">
                      {issue.errors.map((fe, i) => (
                        <li key={`${fe.path}-${i}`}>
                          <span className="font-medium">{pathLabel(fe) || t("issue.whole")}</span>: {translateFieldError(tErr, fe)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={busy || issue?.kind === "incompatible" || issue?.kind === "trashed"} onClick={() => void submit()}>
            {busy ? <Spinner /> : <RotateCcwIcon />}
            {t("confirm", { version: revision.version })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
