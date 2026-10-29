"use client";

import { useTranslations } from "next-intl";

import type { SettingsDraft } from "@/components/protected/forms/form-draft";
import type { FormTabProps } from "@/components/protected/forms/form-tab-props";
import { PostField } from "@/components/protected/posts/post-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { MAX_FORM_NAME, MAX_REDIRECT_URL, SETTING_RANGES } from "@/lib/forms";

const NUMBERS = ["retention_days", "rate_limit_max", "rate_limit_window_s", "rate_limit_daily_max", "min_fill_seconds"] as const;

// The Settings tab (doc/07 3.19 "General"): the name, whether the submissions are kept, the retention, the spam guards and the
// redirect. Only `update` can write them; a translator sees them read-only. Anything that is not here (the field schema, the slug,
// the retention mode, the size limit) is a system value that P1 does not edit.
export function FormSettingsTab({ form, draft, onChange, problems, mode }: FormTabProps) {
  const t = useTranslations("forms.settings");
  const s = draft.settings;
  const editable = mode === "full";
  const set = (patch: Partial<SettingsDraft>) => onChange({ ...draft, settings: { ...s, ...patch } });
  const describedBy = (key: string) => (problems[key] ? `form-setting-${key}-error` : undefined);

  return (
    <div className="space-y-6" data-testid="form-settings">
      {!editable ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{t("readOnly")}</p> : null}
      <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-2">
        <PostField id="form-setting-name" label={t("name")} required counter={{ length: [...s.name.trim()].length, max: MAX_FORM_NAME }} hint={t("nameHint")} error={problems.name} wide>
          <Input id="form-setting-name" value={s.name} disabled={!editable} autoComplete="off" aria-invalid={problems.name ? true : undefined} aria-describedby={describedBy("name")} onChange={(e) => set({ name: e.target.value })} />
        </PostField>

        {NUMBERS.map((key) => {
          const [min, max] = SETTING_RANGES[key];
          return (
            <PostField key={key} id={`form-setting-${key}`} label={t(`${key}.label`)} hint={t(`${key}.hint`, { min, max })} error={problems[key]}>
              <Input
                id={`form-setting-${key}`}
                inputMode="numeric"
                value={s[key]}
                disabled={!editable}
                autoComplete="off"
                aria-invalid={problems[key] ? true : undefined}
                aria-describedby={describedBy(key)}
                onChange={(e) => set({ [key]: e.target.value.replace(/[^\d]/g, "") })}
              />
            </PostField>
          );
        })}

        <PostField id="form-setting-honeypot_field" label={t("honeypot_field.label")} hint={t("honeypot_field.hint")} error={problems.honeypot_field}>
          <Input
            id="form-setting-honeypot_field"
            value={s.honeypot_field}
            disabled={!editable}
            autoComplete="off"
            className="font-mono"
            aria-invalid={problems.honeypot_field ? true : undefined}
            aria-describedby={describedBy("honeypot_field")}
            onChange={(e) => set({ honeypot_field: e.target.value })}
          />
        </PostField>

        <PostField id="form-setting-success_redirect_url" label={t("success_redirect_url.label")} hint={t("success_redirect_url.hint")} counter={{ length: [...s.success_redirect_url.trim()].length, max: MAX_REDIRECT_URL }} error={problems.success_redirect_url} wide>
          <Input
            id="form-setting-success_redirect_url"
            value={s.success_redirect_url}
            disabled={!editable}
            autoComplete="off"
            placeholder="/thank-you"
            aria-invalid={problems.success_redirect_url ? true : undefined}
            aria-describedby={describedBy("success_redirect_url")}
            onChange={(e) => set({ success_redirect_url: e.target.value })}
          />
        </PostField>
      </div>

      <div className="space-y-4">
        {(["store_submissions", "notify_enabled"] as const).map((key) => (
          <div key={key} className="flex items-start gap-3" data-field={key}>
            <Switch id={`form-setting-${key}`} checked={s[key]} disabled={!editable} onCheckedChange={(v) => set({ [key]: v })} aria-describedby={`form-setting-${key}-hint`} />
            <div className="space-y-0.5">
              <label htmlFor={`form-setting-${key}`} className="text-sm font-medium">
                {t(`${key}.label`)}
              </label>
              <p id={`form-setting-${key}-hint`} className="text-sm text-muted-foreground">
                {t(`${key}.hint`)}
              </p>
              {problems[key] ? (
                <p id={`form-setting-${key}-error`} role="alert" className="text-sm text-destructive">
                  {problems[key]}
                </p>
              ) : null}
            </div>
          </div>
        ))}
        {!s.store_submissions && form.recipient_count === 0 ? <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{t("store_submissions.needsRecipient")}</p> : null}
      </div>

      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2" aria-label={t("system.title")}>
        <div>
          <dt className="text-muted-foreground">{t("system.slug")}</dt>
          <dd className="font-mono">{form.slug}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("system.retention_mode")}</dt>
          <dd>{form.settings.retention_mode}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("system.max_payload_bytes")}</dt>
          <dd className="tabular-nums">{form.settings.max_payload_bytes.toLocaleString("en-US")}</dd>
        </div>
      </dl>
    </div>
  );
}
