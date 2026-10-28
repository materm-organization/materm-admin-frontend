"use client";

import { FolderIcon, FolderOpenIcon, FolderPlusIcon, ImagesIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
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
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import {
  useMutationCreateMediaFolder,
  useMutationDeleteMediaFolder,
  useMutationUpdateMediaFolder,
} from "@/hooks/use-media";
import { parseApiError } from "@/lib/api-error";
import { translateFieldError } from "@/lib/api-error-messages";
import { cn } from "@/lib/utils";
import type { MediaFolder } from "@/types/media";

export const ALL_FILES = "all";
export const NO_FOLDER = "root";
const NO_PARENT = "__none__";
const MAX_DEPTH = 4;

// The folder tree of the library (doc/07 section 3.22: up to 4 levels): "All files", "No folder", then the folders
// in path order, indented by depth, each with the number of files directly in it. `selected` is the `folder_id`
// filter of the list: `undefined` = all, `"root"` = no folder, or an id (the list then includes sub-folders).
// Folder commands are shown to those who may use them; the API enforces the same (`media.library:create` /
// `update` / `delete`).
export function MediaFolderTree({
  folders,
  isLoading,
  selected,
  onSelect,
  canCreate,
  canUpdate,
  canDelete,
}: {
  folders: MediaFolder[];
  isLoading: boolean;
  selected: string | undefined;
  onSelect: (value: string | undefined) => void;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("media.folders");
  const { toastError } = useApiErrorHandler();
  const remove = useMutationDeleteMediaFolder();
  const [dialog, setDialog] = useState<{ mode: "create"; parent: MediaFolder | null } | { mode: "rename"; folder: MediaFolder } | null>(null);
  const [deleting, setDeleting] = useState<MediaFolder | null>(null);

  const active = selected && selected !== NO_FOLDER ? folders.find((f) => String(f.id) === selected) : undefined;

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync({ id: deleting.id, etag: deleting.etag });
      toast.success(t("toast.deleted", { name: deleting.name }));
      if (selected === String(deleting.id)) onSelect(undefined);
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.status === 409 && parsed.details?.reason === "folder_not_empty") {
        toast.error(t("deleteNotEmpty", { assets: Number(parsed.details.asset_count ?? 0), folders: Number(parsed.details.child_count ?? 0) }));
      } else {
        toastError(error, t("toast.deleteError"));
      }
      throw error;
    }
  };

  return (
    <nav aria-label={t("title")} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        {canCreate ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDialog({ mode: "create", parent: active ?? null })}>
            <FolderPlusIcon />
            {t("new")}
          </Button>
        ) : null}
      </div>
      <ul className="space-y-0.5 text-sm">
        <TreeRow icon={<ImagesIcon className="size-4" aria-hidden />} label={t("all")} active={selected === undefined} onClick={() => onSelect(undefined)} />
        <TreeRow icon={<FolderIcon className="size-4" aria-hidden />} label={t("none")} active={selected === NO_FOLDER} onClick={() => onSelect(NO_FOLDER)} />
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => <li key={i} className="h-7 animate-pulse rounded bg-muted" aria-hidden />)
          : folders.map((f) => (
              <TreeRow
                key={f.id}
                icon={selected === String(f.id) ? <FolderOpenIcon className="size-4" aria-hidden /> : <FolderIcon className="size-4" aria-hidden />}
                label={f.name}
                count={f.asset_count}
                depth={f.depth - 1}
                active={selected === String(f.id)}
                onClick={() => onSelect(String(f.id))}
              />
            ))}
      </ul>
      {active && (canUpdate || canDelete || (canCreate && active.depth < MAX_DEPTH)) ? (
        <div className="flex flex-wrap gap-1 border-t pt-2" role="group" aria-label={t("actionsFor", { name: active.name })}>
          {canUpdate ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setDialog({ mode: "rename", folder: active })}>
              <PencilIcon />
              {t("rename")}
            </Button>
          ) : null}
          {canDelete ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setDeleting(active)}>
              <Trash2Icon />
              {t("delete")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {dialog ? (
        <FolderDialog
          key={dialog.mode === "rename" ? `rename-${dialog.folder.id}` : "create"}
          dialog={dialog}
          folders={folders}
          onClose={() => setDialog(null)}
          onCreated={(folder) => onSelect(String(folder.id))}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (!open ? setDeleting(null) : undefined)}
        title={t("deleteTitle", { name: deleting?.name ?? "" })}
        description={t("deleteDescription")}
        confirmLabel={t("delete")}
        destructive
        isPending={remove.isPending}
        onConfirm={doDelete}
      />
    </nav>
  );
}

function TreeRow({
  icon,
  label,
  count,
  depth = 0,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  depth?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onClick}
        style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
        className={cn(
          "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
          active && "bg-accent font-medium"
        )}
      >
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined ? <span className="text-xs text-muted-foreground">{count}</span> : null}
      </button>
    </li>
  );
}

// Create (name + parent) / rename + move. The parent list leaves out the folder itself, its sub-folders and the
// folders that would make the tree deeper than 4 levels; the API checks the same (`cycle_detected`,
// `max_depth_exceeded`, duplicates -> 409 on `/name`).
function FolderDialog({
  dialog,
  folders,
  onClose,
  onCreated,
}: {
  dialog: { mode: "create"; parent: MediaFolder | null } | { mode: "rename"; folder: MediaFolder };
  folders: MediaFolder[];
  onClose: () => void;
  onCreated: (folder: MediaFolder) => void;
}) {
  const t = useTranslations("media.folders.dialog");
  const tErr = useTranslations("errors");
  const nameId = useId();
  const parentId = useId();
  const { toastError } = useApiErrorHandler();
  const create = useMutationCreateMediaFolder();
  const update = useMutationUpdateMediaFolder();
  const idempotencyKey = useIdempotencyKey(true);
  const editing = dialog.mode === "rename" ? dialog.folder : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [parent, setParent] = useState<string>(
    editing ? (editing.parent_id === null ? NO_PARENT : String(editing.parent_id)) : dialog.mode === "create" && dialog.parent ? String(dialog.parent.id) : NO_PARENT
  );
  const [errors, setErrors] = useState<{ name?: string; parent?: string }>({});
  const busy = create.isPending || update.isPending;

  // Folders that may become the parent: not itself, not below itself, not at the deepest level.
  const descendantsOf = (id: number): Set<number> => {
    const out = new Set<number>([id]);
    for (let i = 0; i < 10; i++) for (const f of folders) if (f.parent_id !== null && out.has(f.parent_id)) out.add(f.id);
    return out;
  };
  const excluded = editing ? descendantsOf(editing.id) : new Set<number>();
  const parents = folders.filter((f) => !excluded.has(f.id) && f.depth < MAX_DEPTH);

  const submit = async () => {
    setErrors({});
    const trimmed = name.trim();
    if (!trimmed) {
      setErrors({ name: t("nameRequired") });
      return;
    }
    const parent_id = parent === NO_PARENT ? null : Number(parent);
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          payload: { ...(trimmed !== editing.name ? { name: trimmed } : {}), ...(parent_id !== editing.parent_id ? { parent_id } : {}) },
          etag: editing.etag,
        });
        toast.success(t("renamed", { name: trimmed }));
      } else {
        const result = await create.mutateAsync({ payload: { name: trimmed, parent_id }, idempotencyKey });
        toast.success(t("created", { name: trimmed }));
        onCreated(result.data.data);
      }
      onClose();
    } catch (error) {
      const parsed = parseApiError(error);
      const next: { name?: string; parent?: string } = {};
      for (const fe of parsed.fieldErrors) {
        if (fe.path === "/name") next.name = translateFieldError(tErr, fe);
        else if (fe.path === "/parent_id") next.parent = translateFieldError(tErr, fe);
      }
      if (next.name || next.parent) setErrors(next);
      else toastError(error, t("error"));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t("renameTitle", { name: editing.name }) : t("createTitle")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor={nameId}>{t("name")}</Label>
            <Input id={nameId} value={name} maxLength={120} autoFocus aria-invalid={errors.name ? true : undefined} disabled={busy} onChange={(e) => setName(e.target.value)} />
            {errors.name ? <p role="alert" className="text-sm text-destructive">{errors.name}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={parentId}>{t("parent")}</Label>
            <Select value={parent} onValueChange={setParent} disabled={busy}>
              <SelectTrigger id={parentId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>{t("topLevel")}</SelectItem>
                {parents.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    {f.path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.parent ? <p role="alert" className="text-sm text-destructive">{errors.parent}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              {editing ? t("save") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
