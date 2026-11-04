"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SchemaBreaksEntriesDetails } from "@/types/collections";

// 409 `INVALID_STATE` of a schema change (05 17.5): `schema_breaks_entries` says how many entries were checked, how many would no longer pass and
// lists up to 20 of them (id, the place, the code). Nothing was written. `too_many_entries_to_verify` (more than 5,000) is the other refusal.
export type SchemaChangeRefusal =
  | { reason: "schema_breaks_entries"; details: SchemaBreaksEntriesDetails }
  | { reason: "too_many_entries_to_verify"; checked: number | null };

export function SchemaBreaksDialog({ refusal, collectionKey, onClose }: { refusal: SchemaChangeRefusal | null; collectionKey: string; onClose: () => void }) {
  const t = useTranslations("collections.breaks");
  const tCodes = useTranslations("errors");
  const open = refusal !== null;
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-xl" data-testid="schema-breaks-dialog">
        {refusal?.reason === "schema_breaks_entries" ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription className="leading-snug">{t("description")}</DialogDescription>
            </DialogHeader>
            <Alert variant="destructive">
              <AlertTitle>{t("summary", { checked: refusal.details.checked, invalid: refusal.details.invalid_count })}</AlertTitle>
              <AlertDescription className="leading-snug">{t("nothingSaved")}</AlertDescription>
            </Alert>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("which")}</p>
              <ul className="divide-y rounded-md border text-sm" data-testid="breaks-list">
                {refusal.details.invalid_entries.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>
                      <Link href={`/admin/collections/${encodeURIComponent(collectionKey)}/${entry.id}`} className="font-medium underline-offset-4 hover:underline">
                        {t("entry", { id: entry.id })}
                      </Link>
                      <span className="ml-2 break-all font-mono text-xs text-muted-foreground">{entry.path || "/"}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{tCodes.has(`fields.${entry.code}`) ? tCodes(`fields.${entry.code}`) : entry.code}</span>
                  </li>
                ))}
              </ul>
              {refusal.details.invalid_count > refusal.details.invalid_entries.length ? (
                <p className="text-xs text-muted-foreground">{t("more", { shown: refusal.details.invalid_entries.length, total: refusal.details.invalid_count })}</p>
              ) : null}
            </div>
            <p className="text-sm leading-snug text-muted-foreground">{t("fix")}</p>
          </>
        ) : refusal ? (
          <DialogHeader>
            <DialogTitle>{t("tooManyTitle")}</DialogTitle>
            <DialogDescription className="leading-snug">{t("tooManyBody")}</DialogDescription>
          </DialogHeader>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
