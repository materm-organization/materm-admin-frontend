"use client";

import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// One field of the post forms: a label row of the SAME height for every field (so inputs side by side in the two-column
// grid sit on one line, as in the settings editor), the control, a hint line, the counter and the error.
export function PostField({
  id,
  label,
  badge,
  hint,
  warning,
  error,
  counter,
  wide = false,
  required = false,
  children,
}: {
  id: string;
  label: ReactNode;
  badge?: ReactNode;
  hint?: ReactNode;
  // Amber, not blocking (a label that is too long for the blog strip).
  warning?: ReactNode;
  error?: string;
  counter?: { length: number; max: number };
  // Takes both columns of the grid.
  wide?: boolean;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", wide && "lg:col-span-2")} data-field={id}>
      <div className="flex min-h-6 flex-wrap items-center gap-2">
        <Label htmlFor={id}>
          {label}
          {required ? <span aria-hidden className="ml-0.5 text-destructive">*</span> : null}
        </Label>
        {badge}
      </div>
      {children}
      {hint || counter ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span id={`${id}-hint`}>{hint}</span>
          {counter ? (
            <span className={cn("tabular-nums", counter.length > counter.max && "text-destructive")}>
              {counter.length} / {counter.max}
            </span>
          ) : null}
        </div>
      ) : null}
      {warning ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {warning}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
