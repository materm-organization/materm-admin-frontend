"use client";

import { useQueryClient } from "@tanstack/react-query";
import { MinusIcon, PlusIcon, RotateCcwIcon, SaveIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ConflictDialog, type ConflictChange } from "@/components/global/conflict-dialog";
import {
  DEFAULT_ACTION_ORDER,
  type Matrix,
  copyPreset,
  diffMatrix,
  fullPreset,
  grantPointerToKey,
  matrixFromPermissions,
  nonePreset,
  readOnlyPreset,
  summarizeDiff,
  toGrants,
} from "@/components/protected/roles/matrix-model";
import { PermissionMatrix } from "@/components/protected/roles/permission-matrix";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { roleDetailKey, useMutationUpdateRolePermissions, useRoles } from "@/hooks/use-roles";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { parseApiError, isConflictError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { RolesAPI } from "@/services/roles.api";
import type { ActionDef, RoleDetail } from "@/types/iam";

const ACTIONS_FALLBACK: ActionDef[] = DEFAULT_ACTION_ORDER.map((action) => ({ action, description: "" }));

// SCR-10 editor: the matrix plus presets, the diff summary, the review-and-save dialog (PUT with the
// MANDATORY `If-Match`), the 409/412 ConflictDialog and the unsaved-changes guard.
//
// The draft is initialised from the role ONCE: the parent keys this component by the role's ETag, so a saved
// role (new ETag in the cache) or a reload from the ConflictDialog remounts it with a fresh draft — no
// effect-driven state sync.
export function RoleMatrixEditor({
  role,
  etag,
  actions,
  readOnly,
  onReload,
}: {
  role: RoleDetail;
  etag: string | undefined;
  actions: readonly ActionDef[] | undefined;
  // The super role, or no `iam.roles:update`.
  readOnly: boolean;
  // Refetch the role (and its new ETag) — the ConflictDialog's "load the latest version".
  onReload: () => Promise<unknown>;
}) {
  const t = useTranslations("roles.matrix");
  const tCat = useTranslations("roles.categories");
  const tAct = useTranslations("roles.actionLabels");
  const tErr = useTranslations("errors");
  const queryClient = useQueryClient();
  const { toastError } = useApiErrorHandler();
  const mutation = useMutationUpdateRolePermissions(role.id);
  const roles = useRoles(!readOnly);

  const columns = actions && actions.length > 0 ? actions : ACTIONS_FALLBACK;
  const order = useMemo(() => columns.map((a) => a.action), [columns]);
  const base = useMemo(() => matrixFromPermissions(role.permissions, order), [role.permissions, order]);

  const [draft, setDraft] = useState<Matrix>(base);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [copyKey, setCopyKey] = useState(0);

  const changes = useMemo(() => diffMatrix(base, draft, role.permissions), [base, draft, role.permissions]);
  const summary = useMemo(() => summarizeDiff(changes, role.permissions), [changes, role.permissions]);
  const dirty = changes.length > 0;

  const label = (action: string) => (tAct.has(action) ? tAct(action) : action);
  const nameOf = useCallback(
    (key: string) => role.permissions.find((p) => p.permission_key === key)?.name ?? key,
    [role.permissions]
  );

  const edit = (next: Matrix) => {
    setRowErrors({});
    setDraft(next);
  };

  const applyCopy = async (sourceId: string) => {
    try {
      const res = await queryClient.fetchQuery({
        queryKey: roleDetailKey(sourceId),
        queryFn: () => RolesAPI.Get(sourceId),
        staleTime: 0,
      });
      const source = res.data.data;
      edit(copyPreset(source.permissions, role.permissions, order));
      toast.success(t("toast.copied", { name: source.name }));
    } catch (error) {
      toastError(error);
    } finally {
      // Back to the placeholder so the same role can be picked again.
      setCopyKey((k) => k + 1);
    }
  };

  // Resolves true when saved. Server errors: a lock conflict opens the dialog; 422 `/grants/{n}/…` is mapped back
  // to the row of the grant at index n of the body that was sent; anything else is a toast.
  const save = useCallback(async (): Promise<boolean> => {
    const grants = toGrants(draft, role.permissions, order);
    try {
      const result = await mutation.mutateAsync({ grants, etag });
      setReviewOpen(false);
      setRowErrors({});
      toast.success(t("toast.saved", { count: result.data.data.affected_users }));
      return true;
    } catch (error) {
      if (isConflictError(error)) {
        setReviewOpen(false);
        setConflictOpen(true);
        return false;
      }
      const parsed = parseApiError(error);
      const placed: Record<string, string> = {};
      for (const fe of parsed.fieldErrors) {
        if (fe.in !== "body") continue;
        const key = grantPointerToKey(fe.path, grants);
        if (key && !placed[key]) placed[key] = translateFieldError(tErr, fe);
      }
      if (Object.keys(placed).length > 0) {
        setRowErrors(placed);
        setReviewOpen(false);
      } else {
        toastError(error, t("toast.error"));
      }
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, role.permissions, order, etag, mutation.mutateAsync, t, tErr, toastError]);

  useUnsavedChangesGuard(dirty && !readOnly, { onSave: save });

  const myChanges: ConflictChange[] = changes.map((c) => ({
    label: nameOf(c.permission_key),
    value: c.after.length > 0 ? c.after.map(label).join(", ") : t("noAccess"),
  }));

  const reload = async () => {
    setIsReloading(true);
    try {
      await onReload();
    } finally {
      setIsReloading(false);
    }
  };

  return (
    <div className="space-y-3">
      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("presets")}>
          <span className="text-sm font-medium">{t("presets")}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => edit(nonePreset(role.permissions))}>
            {t("presetNone")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => edit(readOnlyPreset(role.permissions, order))}>
            {t("presetReadOnly")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => edit(fullPreset(role.permissions, order))}>
            {t("presetFull")}
          </Button>
          <Select key={copyKey} onValueChange={(v) => void applyCopy(v)} disabled={roles.isLoading}>
            <SelectTrigger size="sm" className="w-56" aria-label={t("copyFrom")}>
              <SelectValue placeholder={t("copyFrom")} />
            </SelectTrigger>
            <SelectContent>
              {(roles.data?.data ?? [])
                .filter((r) => r.id !== role.id)
                .map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <PermissionMatrix
        permissions={role.permissions}
        actions={columns}
        matrix={draft}
        onChange={edit}
        readOnly={readOnly}
        rowErrors={rowErrors}
      />

      {readOnly ? null : (
        <div
          className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background/95 px-4 py-3 backdrop-blur"
          role="region"
          aria-label={t("saveBar")}
        >
          <p className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite" data-testid="diff-summary">
            {dirty ? (
              <>
                <Badge variant="outline" className="gap-1 text-green-700 dark:text-green-400">
                  <PlusIcon /> {summary.added}
                </Badge>
                <Badge variant="outline" className="gap-1 text-red-700 dark:text-red-400">
                  <MinusIcon /> {summary.removed}
                </Badge>
                <span>{t("summary", { added: summary.added, removed: summary.removed, keys: summary.keys })}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{t("noChanges")}</span>
            )}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={!dirty || mutation.isPending} onClick={() => edit(base)}>
              <RotateCcwIcon />
              {t("discard")}
            </Button>
            <Button type="button" disabled={!dirty || mutation.isPending} onClick={() => setReviewOpen(true)}>
              <SaveIcon />
              {t("review")}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={reviewOpen} onOpenChange={(open) => (mutation.isPending ? undefined : setReviewOpen(open))}>
        <DialogContent className="md:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("reviewTitle")}</DialogTitle>
            <DialogDescription>
              {t("reviewDescription", { added: summary.added, removed: summary.removed, keys: summary.keys })}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm" aria-label={t("reviewList")}>
            {changes.map((c) => {
              const cat = role.permissions.find((p) => p.permission_key === c.permission_key)?.category ?? "";
              const added = c.after.filter((a) => !c.before.includes(a));
              const removed = c.before.filter((a) => !c.after.includes(a));
              return (
                <li key={c.permission_key} className="rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{nameOf(c.permission_key)}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {tCat.has(cat) ? tCat(cat) : cat}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {added.map((a) => (
                      <Badge key={`+${a}`} variant="outline" className="text-green-700 dark:text-green-400">
                        + {label(a)}
                      </Badge>
                    ))}
                    {removed.map((a) => (
                      <Badge key={`-${a}`} variant="outline" className="text-red-700 dark:text-red-400">
                        − {label(a)}
                      </Badge>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">{t("reviewNote")}</p>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setReviewOpen(false)}>
              {t("back")}
            </Button>
            <Button type="button" disabled={mutation.isPending} onClick={() => void save()}>
              {mutation.isPending ? <Spinner /> : <SaveIcon />}
              {t("confirmSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConflictDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        onReload={reload}
        isReloading={isReloading}
        myChanges={myChanges}
      />
    </div>
  );
}
