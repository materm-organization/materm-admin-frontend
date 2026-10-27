"use client";

import { SearchXIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

// "Empty (filtered)": the list is empty but a keyword/filter is active -> say so and offer to clear them.
// (An empty list WITHOUT a filter is `EmptyMuted` from components/global/empty.tsx, with a create CTA.)
export function EmptyFiltered({ onClear }: { onClear?: () => void }) {
  const t = useTranslations("states.emptyFiltered");

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
      <SearchXIcon className="size-5" aria-hidden />
      <p className="text-sm font-medium">{t("title")}</p>
      <p className="text-xs">{t("description")}</p>
      {onClear ? (
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          {t("clear")}
        </Button>
      ) : null}
    </div>
  );
}
