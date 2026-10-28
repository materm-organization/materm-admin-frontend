"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PublishableStatus } from "@/types/publishing";

// The lifecycle chip of a publishable entity (doc/07 section 2.5.7): draft only / published / published with a pending
// draft / archived (+ in review / scheduled, P2) / in the trash. One chip, so a list row and the PublishBar say the
// same thing. The colours are tokens of the theme, never the only carrier of the state (the label is text).
export type StatusBadgeState = PublishableStatus | "trashed";

const STYLES: Record<StatusBadgeState | "pending", string> = {
  draft: "border-border bg-muted text-muted-foreground",
  in_review: "border-sky-500/40 bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  scheduled: "border-violet-500/40 bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  published: "border-emerald-600/40 bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  pending: "border-amber-500/50 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  archived: "border-orange-500/40 bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  trashed: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function StatusBadge({
  status,
  hasUnpublishedChanges = false,
  trashed = false,
  className,
}: {
  status: PublishableStatus;
  // A published entity with a draft row: "published, with changes not yet published".
  hasUnpublishedChanges?: boolean;
  trashed?: boolean;
  className?: string;
}) {
  const t = useTranslations("status");
  const state: StatusBadgeState | "pending" = trashed ? "trashed" : status === "published" && hasUnpublishedChanges ? "pending" : status;
  return (
    <Badge variant="outline" data-testid="status-badge" data-state={state} className={cn("font-medium", STYLES[state], className)}>
      {t(`state.${state}`)}
    </Badge>
  );
}
