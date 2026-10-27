"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { fieldDomId, useIssueTranslator, useSchemaFormContext } from "../context";
import type { Issue } from "../types";

// Label + help text + error messages around one control, with the ids wired for assistive technology
// (doc/07 section 5.6): `htmlFor`, `aria-describedby` (help + errors), `aria-invalid`. The control receives the
// props to spread in a render function so every widget gets them the same way.
export type ControlA11y = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
  "data-field-pointer": string;
};

export function useControlA11y(pointer: string, hasIssues: boolean, hasDescription: boolean, suffix = ""): ControlA11y {
  const { formId } = useSchemaFormContext();
  const id = fieldDomId(formId, pointer) + suffix;
  const described = [hasDescription ? `${id}-desc` : null, hasIssues ? `${id}-err` : null].filter(Boolean).join(" ");
  return {
    id,
    "aria-invalid": hasIssues ? true : undefined,
    "aria-describedby": described || undefined,
    "data-field-pointer": pointer,
  };
}

export function IssueMessages({ id, issues }: { id: string; issues: Issue[] }) {
  const translate = useIssueTranslator();
  return (
    <div id={`${id}-err`} aria-live="polite" className={cn(issues.length === 0 && "hidden")}>
      {issues.map((issue, i) => (
        <p key={`${issue.path}-${issue.code}-${i}`} className="text-xs text-destructive" data-slot="field-issue">
          {translate(issue)}
        </p>
      ))}
    </div>
  );
}

export function FieldShell({
  pointer,
  label,
  required,
  description,
  issues,
  actions,
  badges,
  suffix = "",
  children,
}: {
  pointer: string;
  label: string;
  required: boolean;
  description?: string;
  issues: Issue[];
  // Buttons on the label row (copy from default language, ...).
  actions?: ReactNode;
  // Small status next to the label ("not translated").
  badges?: ReactNode;
  suffix?: string;
  children: (a11y: ControlA11y) => ReactNode;
}) {
  const t = useTranslations("schemaForm");
  const a11y = useControlA11y(pointer, issues.length > 0, Boolean(description), suffix);
  return (
    <div className="space-y-1.5" data-slot="field">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={a11y.id}>
            {label}
            {required && (
              <>
                <span aria-hidden="true" className="text-destructive">
                  *
                </span>
                <span className="sr-only">{t("requiredBeforePublish")}</span>
              </>
            )}
          </Label>
          {badges}
        </div>
        {actions}
      </div>
      {children(a11y)}
      {description && (
        <p id={`${a11y.id}-desc`} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      <IssueMessages id={a11y.id} issues={issues} />
    </div>
  );
}

// A group of controls (object, array, link, image): a fieldset with a legend and the group's own messages.
export function GroupShell({
  pointer,
  label,
  required,
  description,
  issues,
  actions,
  className,
  children,
}: {
  pointer: string;
  label: string;
  required?: boolean;
  description?: string;
  issues: Issue[];
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("schemaForm");
  const a11y = useControlA11y(pointer, issues.length > 0, Boolean(description));
  return (
    <fieldset
      className={cn("min-w-0 space-y-3 rounded-lg border p-3", className)}
      aria-describedby={a11y["aria-describedby"]}
      data-field-pointer={pointer}
      data-slot="group"
    >
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap items-center justify-between gap-2" aria-hidden={undefined}>
        <p className="text-sm font-medium" aria-hidden="true">
          {label}
          {required && (
            <>
              <span aria-hidden="true" className="text-destructive">
                {" "}
                *
              </span>
              <span className="sr-only">{t("requiredBeforePublish")}</span>
            </>
          )}
        </p>
        {actions}
      </div>
      {description && (
        <p id={`${a11y.id}-desc`} className="-mt-2 text-xs text-muted-foreground">
          {description}
        </p>
      )}
      <IssueMessages id={a11y.id} issues={issues} />
      {children}
    </fieldset>
  );
}
