"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { EditorLocaleSwitcher, type LocaleBadge } from "@/components/global/locale/editor-locale-switcher";
import { textDraftFrom, type MessageRow, type TextDraft } from "@/components/protected/forms/form-draft";
import { shortLabel, type FormTabProps } from "@/components/protected/forms/form-tab-props";
import { PostField } from "@/components/protected/posts/post-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MAX_FORM_DESCRIPTION, MAX_FORM_TITLE, MAX_MESSAGES, MAX_MESSAGE_TEXT, MAX_SENDING_LABEL, MAX_SUBMIT_LABEL, MAX_SUCCESS_AGAIN, MAX_SUCCESS_DESCRIPTION, MAX_SUCCESS_TITLE } from "@/lib/forms";

// The message codes of the website's form (doc/05 13.6.1 `messages`); an empty one falls back to the website's own wording.
export const SUGGESTED_MESSAGE_CODES = ["required", "email", "messageShort", "phone", "generic", "summary"] as const;

const chars = (v: string) => [...v.trim()].length;

// How complete a language is, for the switch: the two texts a publish asks for.
export function textCompleteness(draft: FormTabProps["draft"], locales: FormTabProps["locales"]): Record<string, LocaleBadge> {
  return Object.fromEntries(
    locales.map((l) => {
      const d = draft.texts[l.code];
      const filled = d ? [d.title, d.submit_label].filter((v) => v.trim() !== "").length : 0;
      return [l.code, { missing: 2 - filled, total: 2, status: filled === 2 ? ("complete" as const) : filled === 0 ? ("missing" as const) : ("partial" as const) }];
    })
  );
}

const TEXT_FIELDS: Array<{ key: Exclude<keyof TextDraft, "messages">; max: number; area?: boolean; required?: boolean }> = [
  { key: "title", max: MAX_FORM_TITLE, required: true },
  { key: "submit_label", max: MAX_SUBMIT_LABEL, required: true },
  { key: "description", max: MAX_FORM_DESCRIPTION, area: true },
  { key: "sending_label", max: MAX_SENDING_LABEL },
  { key: "success_title", max: MAX_SUCCESS_TITLE },
  { key: "success_description", max: MAX_SUCCESS_DESCRIPTION, area: true },
  { key: "success_again_label", max: MAX_SUCCESS_AGAIN },
];

let rows = 0;
const newRow = (code = ""): MessageRow => ({ id: `new-${(rows += 1)}`, code, text: "" });

// The Texts tab (doc/07 3.19 "Texts (L)"): per language the title, description, button labels, the thank-you texts and the error
// messages of the form on the website. A language that has no row yet is added with a button; the default language cannot be removed.
export function FormTextsTab({ draft, onChange, problems, locales, defaultLocale, mode, locale, onLocaleChange }: FormTabProps & { locale: string; onLocaleChange: (code: string) => void }) {
  const t = useTranslations("forms.texts");
  const [removing, setRemoving] = useState(false);
  const current = locales.some((l) => l.code === locale) ? locale : defaultLocale;
  const d = draft.texts[current];
  const fallback = draft.texts[defaultLocale];
  const isDefault = current === defaultLocale;
  const editable = mode !== "none";
  const localeName = locales.find((l) => l.code === current)?.native_name ?? shortLabel(locales, current);

  const setText = (patch: Partial<TextDraft>) => onChange({ ...draft, texts: { ...draft.texts, [current]: { ...d, ...patch } } });
  const setRow = (id: string, patch: Partial<MessageRow>) => setText({ messages: d.messages.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const problemCount = (code: string) => Object.keys(problems).filter((k) => k.startsWith(`texts.${code}.`)).length;

  return (
    <div className="space-y-6" data-testid="form-texts">
      {locales.length > 1 ? (
        <EditorLocaleSwitcher
          locales={locales}
          value={current}
          onChange={onLocaleChange}
          completeness={textCompleteness(draft, locales)}
          issueCounts={Object.fromEntries(locales.map((l) => [l.code, problemCount(l.code)]))}
        />
      ) : null}

      {!d ? (
        <div className="space-y-3 rounded-md border border-dashed p-4" data-testid="form-text-missing">
          <p className="text-sm">{t("missingTitle", { locale: localeName })}</p>
          <p className="text-sm text-muted-foreground">{t("missingBody")}</p>
          {editable ? (
            <Button type="button" variant="outline" onClick={() => onChange({ ...draft, texts: { ...draft.texts, [current]: textDraftFrom(undefined) } })}>
              <PlusIcon />
              {t("addLanguage", { locale: localeName })}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-2">
            {TEXT_FIELDS.map(({ key, max, area, required }) => {
              const id = `form-text-${key}-${current}`;
              const error = problems[`texts.${current}.${key}`];
              const Control = area ? Textarea : Input;
              return (
                <PostField
                  key={key}
                  id={id}
                  label={t(`fields.${key}`)}
                  required={required}
                  badge={isDefault && (key === "title" || key === "submit_label") ? <Badge variant="secondary">{t("default")}</Badge> : null}
                  wide={Boolean(area)}
                  hint={t(`hints.${key}`)}
                  counter={{ length: chars(d[key]), max }}
                  error={error}
                >
                  <Control
                    id={id}
                    value={d[key]}
                    disabled={!editable}
                    placeholder={!isDefault ? fallback?.[key] : undefined}
                    autoComplete="off"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                    onChange={(e) => setText({ [key]: e.target.value })}
                  />
                </PostField>
              );
            })}
          </div>

          <section className="space-y-3" aria-labelledby="form-messages-heading">
            <div>
              <h2 id="form-messages-heading" className="text-sm font-semibold">
                {t("messages.title")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("messages.description")}</p>
            </div>
            {problems[`texts.${current}.messages`] ? (
              <p role="alert" className="text-sm text-destructive">
                {problems[`texts.${current}.messages`]}
              </p>
            ) : null}
            <ul className="space-y-2" data-testid="form-messages">
              {d.messages.map((row, i) => {
                const codeError = problems[`texts.${current}.messages.${i}.code`];
                const textError = problems[`texts.${current}.messages.${i}.text`];
                return (
                  <li key={row.id} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
                    <div>
                      <Input
                        value={row.code}
                        disabled={!editable}
                        aria-label={t("messages.code", { n: i + 1 })}
                        aria-invalid={codeError ? true : undefined}
                        placeholder={t("messages.codePlaceholder")}
                        className="font-mono"
                        autoComplete="off"
                        onChange={(e) => setRow(row.id, { code: e.target.value })}
                      />
                      {codeError ? <p role="alert" className="mt-1 text-sm text-destructive">{codeError}</p> : null}
                    </div>
                    <div>
                      <Input
                        value={row.text}
                        disabled={!editable}
                        aria-label={t("messages.text", { n: i + 1 })}
                        aria-invalid={textError ? true : undefined}
                        placeholder={fallback?.messages.find((m) => m.code === row.code)?.text ?? ""}
                        autoComplete="off"
                        onChange={(e) => setRow(row.id, { text: e.target.value })}
                      />
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">{t("messages.counter", { length: [...row.text].length, max: MAX_MESSAGE_TEXT })}</p>
                      {textError ? <p role="alert" className="text-sm text-destructive">{textError}</p> : null}
                    </div>
                    {editable ? (
                      <Button type="button" variant="ghost" size="icon" aria-label={t("messages.remove", { code: row.code || String(i + 1) })} onClick={() => setText({ messages: d.messages.filter((r) => r.id !== row.id) })}>
                        <Trash2Icon />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {editable ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={d.messages.length >= MAX_MESSAGES} onClick={() => setText({ messages: [...d.messages, newRow()] })}>
                  <PlusIcon />
                  {t("messages.add")}
                </Button>
                {SUGGESTED_MESSAGE_CODES.filter((c) => !d.messages.some((m) => m.code === c)).map((code) => (
                  <Button key={code} type="button" variant="ghost" size="sm" className="font-mono" disabled={d.messages.length >= MAX_MESSAGES} onClick={() => setText({ messages: [...d.messages, newRow(code)] })}>
                    + {code}
                  </Button>
                ))}
              </div>
            ) : null}
          </section>

          {!isDefault && editable ? (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setRemoving(true)}>
                <Trash2Icon />
                {t("removeLanguage", { locale: localeName })}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("remove.title", { locale: localeName })}
        description={t("remove.description")}
        confirmLabel={t("remove.confirm")}
        destructive
        onConfirm={() => {
          const { [current]: _removed, ...rest } = draft.texts;
          void _removed;
          onChange({ ...draft, texts: rest });
          setRemoving(false);
        }}
      />
    </div>
  );
}
