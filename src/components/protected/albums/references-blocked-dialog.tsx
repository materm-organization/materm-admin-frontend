"use client";

import { BanIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { UsageList } from "@/components/protected/media/usage-list";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// One row of `details.references[]` of a 409 `ENTITY_REFERENCED` (doc/05 13.4.4: `ReferenceItem` + `kind` + `in_draft`).
export type BlockingReference = {
  entity_type: string;
  id: number;
  title?: string | null;
  field?: string | null;
  kind?: string;
  in_draft?: boolean;
};

// "It can not be deleted: it is used here" (albums, pictures of an album, FAQ groups; BR-19). Unlike `ReferencedDialog` it has no "go on
// anyway": a section that names the album / picture / group must be changed first, and nothing confirms the delete. Each row links to the
// editor of the page.
export function ReferencesBlockedDialog({
  open,
  onOpenChange,
  kind,
  name,
  references,
  total,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "album" | "item" | "faqGroup";
  // The album / group name, or "picture 3".
  name: string;
  references: BlockingReference[];
  total: number;
}) {
  const t = useTranslations("albums.blocked");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg" data-testid="references-blocked-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BanIcon className="size-5 text-destructive" aria-hidden />
            {t(`title.${kind}`, { name })}
          </DialogTitle>
          <DialogDescription>{t(`description.${kind}`, { count: total })}</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto">
          <UsageList
            usages={references.map((r) => ({ entity_type: r.entity_type, id: r.id, title: r.title ?? null, field: r.field ?? "", in_draft_only: r.kind === "draft_props" }))}
            label={t("listLabel")}
          />
        </div>
        {total > references.length ? <p className="text-sm text-muted-foreground">{t("more", { count: total - references.length })}</p> : null}
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
