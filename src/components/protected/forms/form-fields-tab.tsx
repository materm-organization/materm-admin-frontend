"use client";

import { useTranslations } from "next-intl";

import { EditorLocaleSwitcher, type LocaleBadge } from "@/components/global/locale/editor-locale-switcher";
import type { FieldTextDraft } from "@/components/protected/forms/form-draft";
import { shortLabel, type FormTabProps } from "@/components/protected/forms/form-tab-props";
import { PostField } from "@/components/protected/posts/post-field";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MAX_FIELD_LABEL, MAX_HELP, MAX_OPTION_LABEL, MAX_PLACEHOLDER } from "@/lib/forms";
import type { FormFieldDef } from "@/types/forms";

const chars = (v: string) => [...v.trim()].length;
const blank = (f: FieldTextDraft | undefined) => !f || (f.label.trim() === "" && f.placeholder.trim() === "" && f.help.trim() === "" && Object.values(f.option_labels).every((v) => v.trim() === ""));

function limits(f: FormFieldDef, t: (key: string, values?: Record<string, string | number>) => string): string {
  const parts: string[] = [];
  if (f.min_length !== null || f.max_length !== null) parts.push(t("limits.length", { min: f.min_length ?? 0, max: f.max_length ?? "-" }));
  if (f.pattern) parts.push(t("limits.pattern"));
  return parts.join(", ");
}

// How complete a language is for the fields: a label per field (and a label per option of a select / radio).
function completeness(tab: FormTabProps, localeCodes: string[]): Record<string, LocaleBadge> {
  const out: Record<string, LocaleBadge> = {};
  for (const code of localeCodes) {
    let total = 0;
    let filled = 0;
    for (const f of tab.form.fields) {
      total += 1;
      if ((tab.draft.fields[f.key]?.[code]?.label ?? "").trim() !== "") filled += 1;
      if (f.type === "select" || f.type === "radio") {
        for (const o of f.options ?? []) {
          total += 1;
          if ((tab.draft.fields[f.key]?.[code]?.option_labels[o] ?? "").trim() !== "") filled += 1;
        }
      }
    }
    out[code] = { missing: total - filled, total, status: filled === total ? "complete" : filled === 0 ? "missing" : "partial" };
  }
  return out;
}

// The Fields tab (doc/07 3.19 "Fields" and "Topics", P1): the fields of the form as a READ-ONLY table (the builder is P2) and, per
// language, the label, placeholder, help text and the label of every option - the labels of the topics are the options of the
// `topic` field. The addresses that belong to a topic are on the Recipients tab.
export function FormFieldsTab(props: FormTabProps & { locale: string; onLocaleChange: (code: string) => void }) {
  const { form, draft, onChange, problems, locales, defaultLocale, mode, locale, onLocaleChange } = props;
  const t = useTranslations("forms.fields");
  const current = locales.some((l) => l.code === locale) ? locale : defaultLocale;
  const isDefault = current === defaultLocale;
  const editable = mode !== "none";
  const localeName = locales.find((l) => l.code === current)?.native_name ?? shortLabel(locales, current);
  const setField = (key: string, patch: Partial<FieldTextDraft>) =>
    onChange({ ...draft, fields: { ...draft.fields, [key]: { ...draft.fields[key], [current]: { ...draft.fields[key][current], ...patch } } } });
  const problemCount = (code: string) => Object.keys(problems).filter((k) => k.startsWith("fields.") && k.split(".")[2] === code).length;

  return (
    <div className="space-y-8" data-testid="form-fields">
      <section className="space-y-3" aria-labelledby="form-fields-schema">
        <div>
          <h2 id="form-fields-schema" className="text-sm font-semibold">
            {t("schema.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("schema.description", { version: form.schema_version })}</p>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("schema.key")}</TableHead>
                <TableHead>{t("schema.type")}</TableHead>
                <TableHead>{t("schema.required")}</TableHead>
                <TableHead>{t("schema.limits")}</TableHead>
                <TableHead>{t("schema.options")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {form.fields.map((f) => (
                <TableRow key={f.key}>
                  <TableCell className="font-mono text-xs">
                    {f.key}
                    {f.pii ? (
                      <Badge variant="outline" className="ms-2">
                        {t("schema.pii")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{t(`types.${f.type}`)}</TableCell>
                  <TableCell>{f.required ? t("schema.yes") : t("schema.no")}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{limits(f, t as never) || "-"}</TableCell>
                  <TableCell className="font-mono text-xs">{f.options?.join(", ") || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="form-fields-texts">
        <div>
          <h2 id="form-fields-texts" className="text-sm font-semibold">
            {t("texts.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("texts.description")}</p>
        </div>
        {locales.length > 1 ? (
          <EditorLocaleSwitcher
            locales={locales}
            value={current}
            onChange={onLocaleChange}
            completeness={completeness(props, locales.map((l) => l.code))}
            issueCounts={Object.fromEntries(locales.map((l) => [l.code, problemCount(l.code)]))}
          />
        ) : null}
        <div className="space-y-6">
          {form.fields.map((f) => {
            const row = draft.fields[f.key]?.[current] ?? { label: "", placeholder: "", help: "", option_labels: {} };
            const base = `fields.${f.key}.${current}`;
            const hasOptions = (f.type === "select" || f.type === "radio") && (f.options?.length ?? 0) > 0;
            return (
              <fieldset key={f.key} className="space-y-3 rounded-md border p-4" data-testid={`form-field-${f.key}`}>
                <legend className="flex items-center gap-2 px-1 text-sm font-medium">
                  <span className="font-mono">{f.key}</span>
                  <Badge variant="secondary">{t(`types.${f.type}`)}</Badge>
                  {f.required ? <Badge variant="outline">{t("schema.requiredBadge")}</Badge> : null}
                </legend>
                <div className="grid items-start gap-x-8 gap-y-4 lg:grid-cols-2">
                  <PostField id={`form-field-${f.key}-label-${current}`} label={t("texts.label")} required={isDefault} counter={{ length: chars(row.label), max: MAX_FIELD_LABEL }} error={problems[`${base}.label`]}>
                    <Input
                      id={`form-field-${f.key}-label-${current}`}
                      value={row.label}
                      disabled={!editable}
                      placeholder={!isDefault ? draft.fields[f.key]?.[defaultLocale]?.label : undefined}
                      autoComplete="off"
                      aria-invalid={problems[`${base}.label`] ? true : undefined}
                      aria-describedby={problems[`${base}.label`] ? `form-field-${f.key}-label-${current}-error` : undefined}
                      onChange={(e) => setField(f.key, { label: e.target.value })}
                    />
                  </PostField>
                  {f.type !== "checkbox" && f.type !== "consent" ? (
                    <PostField id={`form-field-${f.key}-placeholder-${current}`} label={t("texts.placeholder")} counter={{ length: chars(row.placeholder), max: MAX_PLACEHOLDER }} error={problems[`${base}.placeholder`]}>
                      <Input id={`form-field-${f.key}-placeholder-${current}`} value={row.placeholder} disabled={!editable} autoComplete="off" onChange={(e) => setField(f.key, { placeholder: e.target.value })} />
                    </PostField>
                  ) : null}
                  <PostField id={`form-field-${f.key}-help-${current}`} label={t("texts.help")} wide counter={{ length: chars(row.help), max: MAX_HELP }} error={problems[`${base}.help`]}>
                    <Input id={`form-field-${f.key}-help-${current}`} value={row.help} disabled={!editable} autoComplete="off" onChange={(e) => setField(f.key, { help: e.target.value })} />
                  </PostField>
                </div>
                {hasOptions ? (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">{t("texts.options")}</h3>
                    <div className="grid items-start gap-x-8 gap-y-3 lg:grid-cols-2">
                      {f.options!.map((option) => {
                        const id = `form-field-${f.key}-option-${option}-${current}`;
                        const error = problems[`${base}.option_labels.${option}`];
                        return (
                          <PostField key={option} id={id} label={<span className="font-mono text-xs">{option}</span>} counter={{ length: chars(row.option_labels[option] ?? ""), max: MAX_OPTION_LABEL }} error={error}>
                            <Input
                              id={id}
                              value={row.option_labels[option] ?? ""}
                              disabled={!editable}
                              placeholder={!isDefault ? draft.fields[f.key]?.[defaultLocale]?.option_labels[option] : undefined}
                              autoComplete="off"
                              aria-label={t("texts.optionLabel", { option, locale: localeName })}
                              onChange={(e) => setField(f.key, { option_labels: { ...row.option_labels, [option]: e.target.value } })}
                            />
                          </PostField>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {blank(row) && !isDefault ? <p className="text-xs text-muted-foreground">{t("texts.fallback", { locale: localeName })}</p> : null}
              </fieldset>
            );
          })}
        </div>
      </section>
    </div>
  );
}
