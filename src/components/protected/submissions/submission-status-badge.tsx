"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SubmissionStatus } from "@/types/submissions";

const STYLES: Record<SubmissionStatus, string> = {
  new: "border-sky-500/50 bg-sky-100 font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  read: "border-border bg-muted text-muted-foreground",
  replied: "border-emerald-600/40 bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  archived: "border-orange-500/40 bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  spam: "border-destructive/40 bg-destructive/10 text-destructive",
};

// The status of a message. The colour never carries it alone: the label is text.
export function SubmissionStatusBadge({ status, className }: { status: SubmissionStatus; className?: string }) {
  const t = useTranslations("submissions.status");
  return (
    <Badge variant="outline" data-testid="submission-status" data-state={status} className={cn("font-medium", STYLES[status], className)}>
      {t(status)}
    </Badge>
  );
}
