"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

// Shown while at least one row is selected (doc/07 section 2.5.1): "n selected", the bulk commands and a
// cancel button. Only for lists whose endpoint has a REAL bulk command (never loop single requests).
export function BulkBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations("common");
  const tList = useTranslations("list");
  if (count <= 0) return null;

  return (
    <div
      role="region"
      aria-label={tList("bulkActions")}
      className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
    >
      <span className="font-medium" aria-live="polite">
        {t("selectedCount", { count })}
      </span>
      {children}
      <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        {tList("clearSelection")}
      </Button>
    </div>
  );
}
