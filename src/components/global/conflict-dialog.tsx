"use client";

import { GitCompareArrowsIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

export type ConflictChange = { label: string; value: string };

// Shown on 409 `CONFLICT_LOCK_VERSION` (or 412) for a write with `If-Match` (doc/07 section 2.5.6; detect it
// with `isConflictError`). There is NO "force overwrite". Choices:
//  - "Load the latest version": discard my edits and reload (`onReload` refetches the resource + its new ETag);
//  - "Keep my changes to review": with `myChanges` a read-only list of what I edited opens so it can be copied
//    by hand, then "Load the latest version"; without `myChanges`, `onKeepMine` is called and the dialog
//    closes (the form stays as it is; the next save will conflict again until the page reloads).
// Closing the dialog (X / Esc) counts as "keep my changes". A revision diff (P2) is not part of this dialog.
export function ConflictDialog({
  open,
  onOpenChange,
  onReload,
  isReloading = false,
  myChanges,
  onKeepMine,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReload: () => void | Promise<void>;
  isReloading?: boolean;
  myChanges?: ConflictChange[];
  onKeepMine?: () => void;
}) {
  const t = useTranslations("dialogs.conflict");
  const [view, setView] = useState<"choose" | "mine">("choose");

  const finish = () => {
    setView("choose");
    onOpenChange(false);
  };

  const keepMine = () => {
    if (myChanges && myChanges.length > 0) {
      setView("mine");
      return;
    }
    onKeepMine?.();
    finish();
  };

  const reload = async () => {
    await onReload();
    finish();
  };

  const handleOpenChange = (next: boolean) => {
    if (next || isReloading) return;
    onKeepMine?.();
    finish();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrowsIcon className="size-5" aria-hidden />
            {view === "mine" ? t("mineTitle") : t("title")}
          </DialogTitle>
          <DialogDescription>
            {view === "mine" ? t("mineDescription") : t("description")}
          </DialogDescription>
        </DialogHeader>

        {view === "mine" && myChanges ? (
          <dl className="max-h-64 space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
            {myChanges.map((change) => (
              <div key={change.label}>
                <dt className="text-xs font-medium text-muted-foreground">{change.label}</dt>
                <dd className="whitespace-pre-wrap break-words select-text">{change.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {view === "choose" ? (
            <Button type="button" variant="outline" onClick={keepMine} disabled={isReloading}>
              {t("keepMine")}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => setView("choose")}>
              {t("back")}
            </Button>
          )}
          <Button type="button" onClick={() => void reload()} disabled={isReloading}>
            {isReloading ? <Spinner /> : null}
            {t("reload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
