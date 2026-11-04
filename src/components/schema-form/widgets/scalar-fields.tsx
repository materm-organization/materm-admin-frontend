"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DateTimeField } from "@/components/global/date-time-field";
import { cn } from "@/lib/utils";

import { useFieldLabel, useIssuesAt } from "../context";
import type { FieldNode } from "../types";
import { codePointLength, humanize } from "../value-ops";
import { FieldShell, GroupShell, IssueMessages, useControlA11y } from "./field-shell";

type ScalarProps = {
  node: FieldNode;
  pointer: string;
  value: unknown;
  onChange: (next: unknown) => void;
  editable: boolean;
};

// Plain (non-localized) text: machine strings such as an anchor id or a slug. A cleared input removes the key.
export function StringField({ node, pointer, value, onChange, editable }: ScalarProps) {
  const label = useFieldLabel(node);
  const issues = useIssuesAt([pointer]);
  const text = typeof value === "string" ? value : "";
  const length = codePointLength(text);
  return (
    <FieldShell pointer={pointer} label={label} required={node.required} description={node.description} issues={issues}>
      {(a11y) => (
        <>
          {node.multiline || node.textarea ? (
            <Textarea {...a11y} rows={node.options.rows ?? 4} className="leading-snug" value={text} disabled={!editable} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />
          ) : (
            <Input {...a11y} value={text} disabled={!editable} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />
          )}
          {node.maxLength !== undefined && (
            <p className={cn("text-right text-xs text-muted-foreground", length > node.maxLength && "text-destructive")}>
              {length}/{node.maxLength}
            </p>
          )}
        </>
      )}
    </FieldShell>
  );
}

export function NumberField({ node, pointer, value, onChange, editable }: ScalarProps) {
  const label = useFieldLabel(node);
  const issues = useIssuesAt([pointer]);
  return (
    <FieldShell pointer={pointer} label={label} required={node.required} description={node.description} issues={issues}>
      {(a11y) => (
        <Input
          {...a11y}
          type="number"
          inputMode={node.integer ? "numeric" : "decimal"}
          step={node.integer ? 1 : "any"}
          min={node.minimum}
          max={node.maximum}
          value={typeof value === "number" && Number.isFinite(value) ? value : ""}
          placeholder={typeof node.defaultValue === "number" ? String(node.defaultValue) : undefined}
          disabled={!editable}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" || Number.isNaN(Number(raw)) ? undefined : Number(raw));
          }}
        />
      )}
    </FieldShell>
  );
}

// A switch. When the prop is absent it shows the schema `default` but writes nothing until the user touches it
// (doc/07 section 4.1: props do not grow by accident).
export function BooleanField({ node, pointer, value, onChange, editable }: ScalarProps) {
  const label = useFieldLabel(node);
  const issues = useIssuesAt([pointer]);
  const a11y = useControlA11y(pointer, issues.length > 0, Boolean(node.description));
  const checked = typeof value === "boolean" ? value : node.defaultValue === true;
  return (
    <div className="space-y-1.5" data-slot="field">
      <div className="flex items-center gap-3">
        <Switch
          id={a11y.id}
          checked={checked}
          disabled={!editable}
          aria-invalid={a11y["aria-invalid"]}
          aria-describedby={a11y["aria-describedby"]}
          data-field-pointer={pointer}
          onCheckedChange={onChange}
        />
        <Label htmlFor={a11y.id} className="font-normal">
          {label}
        </Label>
      </div>
      {node.description && (
        <p id={`${a11y.id}-desc`} className="text-xs text-muted-foreground">
          {node.description}
        </p>
      )}
      <IssueMessages id={a11y.id} issues={issues} />
    </div>
  );
}

export function EnumField({ node, pointer, value, onChange, editable }: ScalarProps) {
  const t = useTranslations("schemaForm");
  const label = useFieldLabel(node);
  const issues = useIssuesAt([pointer]);
  const options = node.enumValues ?? [];
  const labelOf = (v: unknown) => humanize(String(v));
  const shown = value !== undefined ? value : node.defaultValue;
  const selectedIndex = options.findIndex((o) => o === shown);
  const clear =
    !node.required && value !== undefined && editable ? (
      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange(undefined)}>
        {t("clearChoice")}
      </Button>
    ) : null;

  if (node.radio || options.length <= 6) {
    return (
      <GroupShell pointer={pointer} label={label} required={node.required} description={node.description} issues={issues} actions={clear}>
        <RadioGroup
          value={selectedIndex >= 0 ? String(selectedIndex) : ""}
          disabled={!editable}
          aria-label={label}
          className="flex flex-wrap gap-x-5 gap-y-2"
          onValueChange={(next) => onChange(options[Number(next)])}
        >
          {options.map((option, index) => (
            <RadioOption key={String(option)} id={`${pointer}-${index}`} value={String(index)} label={labelOf(option)} />
          ))}
        </RadioGroup>
      </GroupShell>
    );
  }
  return (
    <FieldShell pointer={pointer} label={label} required={node.required} description={node.description} issues={issues} actions={clear}>
      {(a11y) => (
        <Select
          value={selectedIndex >= 0 ? String(selectedIndex) : ""}
          disabled={!editable}
          onValueChange={(next) => onChange(options[Number(next)])}
        >
          <SelectTrigger {...a11y} className="w-full">
            <SelectValue placeholder={t("choose")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option, index) => (
              <SelectItem key={String(option)} value={String(index)}>
                {labelOf(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FieldShell>
  );
}

function RadioOption({ id, value, label }: { id: string; value: string; label: string }) {
  const auto = useId();
  const domId = `${auto}${id.replace(/[^A-Za-z0-9]/g, "_")}`;
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={domId} value={value} />
      <Label htmlFor={domId} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

// An array of enum values (a checkbox group), e.g. a `rel` list outside the link widget.
export function EnumArrayField({ node, pointer, value, onChange, editable }: ScalarProps) {
  const label = useFieldLabel(node);
  const issues = useIssuesAt([pointer]);
  const selected = Array.isArray(value) ? value : [];
  const options = node.enumValues ?? [];
  const auto = useId();
  return (
    <GroupShell pointer={pointer} label={label} required={node.required} description={node.description} issues={issues}>
      <div className="flex flex-wrap gap-4">
        {options.map((option, index) => {
          const id = `${auto}-${index}`;
          return (
            <div key={String(option)} className="flex items-center gap-2">
              <Checkbox
                id={id}
                disabled={!editable}
                checked={selected.includes(option)}
                onCheckedChange={(checked) => {
                  const next = options.filter((o) => (o === option ? checked === true : selected.includes(o)));
                  onChange(next.length === 0 ? undefined : next);
                }}
              />
              <Label htmlFor={id} className="font-normal">
                {humanize(String(option))}
              </Label>
            </div>
          );
        })}
      </div>
    </GroupShell>
  );
}

// `format: date` (a collection field the builder wrote with `ui:widget: "date"`): the value is `YYYY-MM-DD`.
export function DateField({ node, pointer, value, onChange, editable }: ScalarProps) {
  const label = useFieldLabel(node);
  const issues = useIssuesAt([pointer]);
  return (
    <FieldShell pointer={pointer} label={label} required={node.required} description={node.description} issues={issues}>
      {(a11y) => (
        <Input {...a11y} type="date" className="max-w-48" value={typeof value === "string" ? value : ""} disabled={!editable} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />
      )}
    </FieldShell>
  );
}

// `format: date-time`: an RFC 3339 instant (UTC), picked as wall-clock time in Asia/Vientiane.
export function DateTimeSchemaField({ node, pointer, value, onChange, editable }: ScalarProps) {
  const label = useFieldLabel(node);
  const issues = useIssuesAt([pointer]);
  return (
    <FieldShell pointer={pointer} label={label} required={node.required} description={node.description} issues={issues}>
      {(a11y) => <DateTimeField id={a11y.id} aria-label={label} value={typeof value === "string" ? value : null} disabled={!editable} onChange={(next) => onChange(next ?? undefined)} />}
    </FieldShell>
  );
}
