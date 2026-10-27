"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { useFieldLabel, useIssuesUnder } from "../context";
import { checkLinkUrl, type LinkUrlKind } from "../link-rules";
import { isPlainObject } from "../schema-walker";
import type { FieldNode } from "../types";
import { EntityPicker, useEntityWarning } from "./entity-picker";
import { GroupShell, IssueMessages, useControlA11y } from "./field-shell";

// A link `{type: "page" | "url", ...}` (doc/04 section 3.1, doc/07 section 4.2): a segmented choice between an
// internal page (page picker + optional anchor) and a URL (`https://`, `/path`, `mailto:`, `tel:`, `#anchor`)
// with "open in a new tab" and `rel`. Changing the type CLEARS the other type's fields (the schema forbids
// mixing them). A URL is checked at once with the same rule the validator applies (R-016: `//host` and `/\host`
// are refused although they start with `/`).
const URL_PREFIX: Record<LinkUrlKind, string> = { https: "https://", path: "/", mailto: "mailto:", tel: "tel:", anchor: "#" };
const URL_KINDS = Object.keys(URL_PREFIX) as LinkUrlKind[];
const REL_VALUES = ["nofollow", "sponsored", "ugc"] as const;

function stripPrefix(url: string): string {
  return url.replace(/^(https:\/\/|mailto:|tel:|#|\/)/, "");
}

export function LinkField({
  node,
  pointer,
  value,
  onChange,
  editable,
}: {
  node: FieldNode;
  pointer: string;
  value: unknown;
  onChange: (next: unknown) => void;
  editable: boolean;
}) {
  const t = useTranslations("schemaForm.link");
  const label = useFieldLabel(node);
  const issues = useIssuesUnder(pointer);
  const link = isPlainObject(value) ? value : undefined;
  const type = link?.type === "page" || link?.type === "url" ? link.type : undefined;
  const url = typeof link?.url === "string" ? link.url : "";
  const check = url ? checkLinkUrl(url) : undefined;
  const urlKind: LinkUrlKind | undefined = check?.ok ? check.kind : undefined;
  // The specific message ("leaves the site") wins over the schema's generic `pattern_mismatch` at the same path.
  const localProblem = check && !check.ok ? check.reason : null;
  const urlIssues = issues.filter((i) => i.path === `${pointer}/url` && !(localProblem && i.code === "pattern_mismatch"));
  const urlId = useControlA11y(`${pointer}/url`, urlIssues.length > 0 || localProblem !== null, false);
  const pageId = useControlA11y(`${pointer}/page_id`, issues.some((i) => i.path === `${pointer}/page_id`), false);
  const anchorId = useControlA11y(`${pointer}/anchor`, issues.some((i) => i.path === `${pointer}/anchor`), false);
  const newTabId = useId();
  const kindId = useId();

  const rel = Array.isArray(link?.rel) ? (link.rel as string[]) : [];
  const pageValue = typeof link?.page_id === "number" ? link.page_id : undefined;
  const pageWarning = useEntityWarning("page", pageValue);

  const set = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...link };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === false || (Array.isArray(v) && v.length === 0) || v === "") delete next[k];
      else next[k] = v;
    }
    onChange(next);
  };

  const otherIssues = issues.filter((i) => !["url", "page_id", "anchor"].some((f) => i.path === `${pointer}/${f}`));

  return (
    <GroupShell
      pointer={pointer}
      label={label}
      required={node.required}
      description={node.description}
      issues={otherIssues}
      actions={
        link && editable ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange(undefined)}>
            {t("clear")}
          </Button>
        ) : null
      }
    >
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={type ?? ""}
        disabled={!editable}
        aria-label={t("type")}
        onValueChange={(next) => {
          if (next === "page" || next === "url") onChange({ type: next });
        }}
        className="w-fit"
        data-field-pointer={`${pointer}/type`}
      >
        <ToggleGroupItem value="page" className="px-4">
          {t("page")}
        </ToggleGroupItem>
        <ToggleGroupItem value="url" className="px-4">
          {t("url")}
        </ToggleGroupItem>
      </ToggleGroup>

      {type === "page" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={pageId.id}>{t("pickPage")}</Label>
            <EntityPicker
              kind="page"
              {...pageId}
              aria-label={t("pickPage")}
              value={pageValue}
              disabled={!editable}
              onChange={(next) => set({ page_id: typeof next === "number" ? next : undefined })}
            />
            <IssueMessages id={pageId.id} issues={issues.filter((i) => i.path === `${pointer}/page_id`)} />
            {pageWarning && (
              <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                {pageWarning}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={anchorId.id}>{t("anchor")}</Label>
            <Input
              {...anchorId}
              value={typeof link?.anchor === "string" ? link.anchor : ""}
              disabled={!editable}
              placeholder="section-id"
              onChange={(e) => set({ anchor: e.target.value })}
            />
            <IssueMessages id={anchorId.id} issues={issues.filter((i) => i.path === `${pointer}/anchor`)} />
          </div>
        </div>
      )}

      {type === "url" && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor={kindId}>{t("urlKind")}</Label>
              <Select
                value={urlKind ?? ""}
                disabled={!editable}
                onValueChange={(next) => set({ url: URL_PREFIX[next as LinkUrlKind] + stripPrefix(url) })}
              >
                <SelectTrigger id={kindId} className="w-full">
                  <SelectValue placeholder={t("urlKindOther")} />
                </SelectTrigger>
                <SelectContent>
                  {URL_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {t(`kind.${kind}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={urlId.id}>{t("urlLabel")}</Label>
              <Input
                {...urlId}
                aria-describedby={[urlId["aria-describedby"], localProblem ? `${urlId.id}-local` : null].filter(Boolean).join(" ") || undefined}
                value={url}
                disabled={!editable}
                placeholder="https://example.com"
                inputMode="url"
                onChange={(e) => set({ url: e.target.value })}
              />
              {localProblem && (
                <p id={`${urlId.id}-local`} className="text-xs text-destructive" data-slot="field-issue">
                  {t(`problem.${localProblem}`)}
                </p>
              )}
              <IssueMessages id={urlId.id} issues={urlIssues} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id={newTabId}
              checked={link?.open_in_new_tab === true}
              disabled={!editable}
              onCheckedChange={(checked) => set({ open_in_new_tab: checked ? true : undefined })}
            />
            <Label htmlFor={newTabId} className="font-normal">
              {t("newTab")}
            </Label>
          </div>
          <fieldset className="space-y-1.5" disabled={!editable}>
            <legend className="text-sm font-medium">{t("rel")}</legend>
            <div className="flex flex-wrap gap-4">
              {REL_VALUES.map((value) => {
                const id = `${urlId.id}-rel-${value}`;
                return (
                  <div key={value} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={rel.includes(value)}
                      onCheckedChange={(checked) =>
                        set({ rel: REL_VALUES.filter((v) => (v === value ? checked === true : rel.includes(v))) })
                      }
                    />
                    <Label htmlFor={id} className="font-normal">
                      {value}
                    </Label>
                  </div>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}
    </GroupShell>
  );
}
