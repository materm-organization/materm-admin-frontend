"use client";

import { LinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

// One row of `details.references[]` of a 409 `ENTITY_REFERENCED` (doc/05 12.3.5: `PageReference`).
export type ReferencedItem = {
  entity_type: string;
  id: number;
  title?: string | null;
  field?: string | null;
  kind?: "menu_item" | "section_props" | "draft_props" | string;
  in_draft?: boolean;
  menu_key?: string | null;
};

// "This page is linked from ..." (doc/07 section 3.11, PG-13): shown when a delete / unpublish was answered with
// `ENTITY_REFERENCED`. Continuing repeats the SAME request with `confirm_references=true` (the first request never carries
// it): the menu items that point at the page are hidden on the website and so are the links in sections.
export function ReferencedDialog({
  open,
  onOpenChange,
  noun,
  items,
  total,
  action = "unpublish",
  variant = "link",
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noun: string;
  items: ReferencedItem[];
  total: number;
  action?: "unpublish" | "delete";
  // "used": an album / FAQ group a section shows (T1.5.6) - the consequence is another one than for a link to a page.
  variant?: "link" | "used";
  isPending: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const t = useTranslations("publishing.referenced");
  return (
    <Dialog open={open} onOpenChange={(next) => (!isPending ? onOpenChange(next) : undefined)}>
      <DialogContent className="md:max-w-lg" data-testid="referenced-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="size-5" aria-hidden />
            {t("title", { noun })}
          </DialogTitle>
          <DialogDescription>{t(variant === "used" ? `description.used.${action}` : `description.${action}`, { noun, count: total })}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-60 list-disc space-y-1 overflow-y-auto ps-5 text-sm">
          {items.map((r, i) => (
            <li key={`${r.entity_type}-${r.id}-${r.field ?? i}`}>
              {r.kind === "menu_item"
                ? t("menuItem", { title: r.title ?? `#${r.id}`, menu: r.menu_key ?? "" })
                : r.kind === "draft_props"
                  ? t("draftProps", { title: r.title ?? `#${r.id}` })
                  : t("sectionProps", { title: r.title ?? `#${r.id}` })}
            </li>
          ))}
        </ul>
        {total > items.length ? <p className="text-sm text-muted-foreground">{t("more", { count: total - items.length })}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={isPending} onClick={() => void onConfirm()}>
            {isPending ? <Spinner /> : null}
            {t(`confirm.${action}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
