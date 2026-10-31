"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LockIcon, SaveIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  fallbackCandidates,
  formatDateExample,
  isValidDateTemplate,
} from "@/components/protected/locales/locale-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ConflictDialog } from "@/components/global/conflict-dialog";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { API_ENDPOINTS } from "@/lib/constants/api-endpoints";
import { useMutationUpdateLocale } from "@/hooks/use-locales";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import type { Locale, UpdateLocalePayload } from "@/types/locales";

const NO_FALLBACK = "__none__";
const MONTHS = 12;

function localeSchema(t: (key: string) => string) {
  return z.object({
    name: z.string().trim().min(1, t("validation.nameRequired")).max(80, t("validation.nameTooLong")),
    native_name: z.string().trim().min(1, t("validation.nameRequired")).max(80, t("validation.nameTooLong")),
    short_label: z.string().trim().min(1, t("validation.shortLabelRequired")).max(12, t("validation.shortLabelTooLong")),
    flag: z.string().trim().max(16, t("validation.flagTooLong")),
    sort_order: z
      .string()
      .trim()
      .regex(/^\d{1,4}$/, t("validation.sortOrderInvalid"))
      .refine((v) => Number(v) >= 0 && Number(v) <= 1000, t("validation.sortOrderInvalid")),
    fallback_code: z.string(),
    short: z
      .string()
      .trim()
      .min(1, t("validation.templateRequired"))
      .max(40, t("validation.templateTooLong"))
      .refine(isValidDateTemplate, t("validation.templateInvalid")),
    long: z
      .string()
      .trim()
      .max(60, t("validation.templateTooLong"))
      .refine((v) => v === "" || isValidDateTemplate(v), t("validation.templateInvalid")),
    months: z.array(z.string().trim().min(1, t("validation.monthRequired")).max(20, t("validation.monthTooLong"))).length(MONTHS),
  });
}
type LocaleValues = z.infer<ReturnType<typeof localeSchema>>;

// SCR-12 edit sheet (doc/07 section 3.7; PATCH rules: doc/05 section 10.7). Read-only: code, direction, default
// flag, search config. The fallback picker offers only locales that keep a valid chain (never itself, no loop,
// ending at the default); the default locale has no fallback. Date formats: `short` / `long` templates with
// {day} {month} {year} and the 12 month names, with a live example. Every PATCH sends the row's `etag` as `If-Match` (409 -> ConflictDialog).
// Mount while open, keyed by the locale's `etag`.
export function LocaleEditSheet({
  locale,
  locales,
  onClose,
  canEdit,
}: {
  locale: Locale;
  locales: readonly Locale[];
  onClose: () => void;
  canEdit: boolean;
}) {
  const t = useTranslations("locales.edit");
  const mutation = useMutationUpdateLocale();
  const { handleFormError } = useApiErrorHandler();
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);

  const formats = locale.date_formats ?? {};
  const form = useForm<LocaleValues>({
    resolver: zodResolver(localeSchema(t)),
    defaultValues: {
      name: locale.name,
      native_name: locale.native_name,
      short_label: locale.short_label,
      flag: locale.flag ?? "",
      sort_order: String(locale.sort_order),
      fallback_code: locale.fallback_code ?? NO_FALLBACK,
      short: formats.short ?? "",
      long: formats.long ?? "",
      months: Array.from({ length: MONTHS }, (_, i) => formats.months?.[i] ?? ""),
    },
  });
  const candidates = fallbackCandidates(locales, locale.code);
  const readOnly = !canEdit || mutation.isPending;
  const values = useWatch({ control: form.control }) as LocaleValues;

  const buildPayload = (v: LocaleValues): UpdateLocalePayload => {
    const payload: UpdateLocalePayload = {};
    if (v.name !== locale.name) payload.name = v.name;
    if (v.native_name !== locale.native_name) payload.native_name = v.native_name;
    if (v.short_label !== locale.short_label) payload.short_label = v.short_label;
    if (v.flag !== (locale.flag ?? "")) payload.flag = v.flag === "" ? null : v.flag;
    if (Number(v.sort_order) !== locale.sort_order) payload.sort_order = Number(v.sort_order);
    if (!locale.is_default && v.fallback_code !== (locale.fallback_code ?? NO_FALLBACK) && v.fallback_code !== NO_FALLBACK) {
      payload.fallback_code = v.fallback_code;
    }
    const sameMonths = v.months.every((m, i) => m === (formats.months?.[i] ?? ""));
    if (v.short !== (formats.short ?? "") || v.long !== (formats.long ?? "") || !sameMonths) {
      payload.date_formats = { short: v.short, ...(v.long ? { long: v.long } : {}), months: v.months };
    }
    return payload;
  };

  const doSave = async (v: LocaleValues): Promise<boolean> => {
    const payload = buildPayload(v);
    if (Object.keys(payload).length === 0) return true;
    try {
      await mutation.mutateAsync({ code: locale.code, payload, etag: locale.etag });
      toast.success(t("toast.success", { name: locale.name }));
      return true;
    } catch (error) {
      // 422 errors land on the matching input (`/fallback_code`, `/date_formats/short` -> `short`).
      handleFormError(form, error, {
        // 409 CONFLICT_LOCK_VERSION: somebody else changed this language; offer to load the latest row.
        onConflict: () => setConflict(true),
        fallback: t("toast.error"),
        fieldMap: { "date_formats/short": "short", date_formats: "short" },
      });
      return false;
    }
  };

  const onSubmit = form.handleSubmit(async (v) => {
    if (await doSave(v)) onClose();
  });

  useUnsavedChangesGuard(form.formState.isDirty, {
    onSave: async () => {
      let ok = false;
      await form.handleSubmit(async (v) => {
        ok = await doSave(v);
      })();
      return ok;
    },
  });

  return (
    <>
    <Sheet open onOpenChange={(open) => (!open && !mutation.isPending ? onClose() : undefined)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {locale.name}
            <span className="font-mono text-sm font-normal text-muted-foreground">{locale.code}</span>
            {locale.is_default ? <Badge>{t("defaultBadge")}</Badge> : null}
          </SheetTitle>
          <SheetDescription>{canEdit ? t("description") : t("readOnly")}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4 px-4 pb-4" noValidate>
            <dl className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 p-3 text-xs">
              <div>
                <dt className="text-muted-foreground">{t("direction")}</dt>
                <dd className="font-mono">{locale.text_direction}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("searchConfig")}</dt>
                <dd className="font-mono">{locale.search_config}</dd>
              </div>
              <div className="flex items-start gap-1">
                <LockIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span>{t("immutable")}</span>
              </div>
            </dl>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.name")}</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" disabled={readOnly} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="native_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.nativeName")}</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" disabled={readOnly} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="short_label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.shortLabel")}</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" disabled={readOnly} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="flag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.flag")}</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" disabled={readOnly} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sort_order"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.sortOrder")}</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" disabled={readOnly} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fallback_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.fallback")}</FormLabel>
                    <Select
                      value={locale.is_default ? NO_FALLBACK : field.value}
                      onValueChange={field.onChange}
                      disabled={readOnly || locale.is_default}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_FALLBACK} disabled>
                          {t("fields.fallbackNone")}
                        </SelectItem>
                        {candidates.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.name} ({c.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {locale.is_default ? t("fields.fallbackDefault") : t("fields.fallbackHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">{t("dates.title")}</legend>
              <FormField
                control={form.control}
                name="short"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("dates.short")}</FormLabel>
                    <FormControl>
                      <Input className="font-mono" spellCheck={false} disabled={readOnly} {...field} />
                    </FormControl>
                    <FormDescription>
                      {t("dates.example")}{" "}
                      <span className="font-medium" data-testid="short-example">
                        {formatDateExample(values.short, values.months)}
                      </span>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="long"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("dates.long")}</FormLabel>
                    <FormControl>
                      <Input className="font-mono" spellCheck={false} disabled={readOnly} {...field} />
                    </FormControl>
                    <FormDescription>
                      {t("dates.placeholders")}
                      {values.long ? ` — ${formatDateExample(values.long, values.months)}` : ""}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-1">
                <p className="text-sm font-medium">{t("dates.months")}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {Array.from({ length: MONTHS }, (_, i) => (
                    <FormField
                      key={i}
                      control={form.control}
                      name={`months.${i}` as const}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              aria-label={t("dates.month", { n: i + 1 })}
                              placeholder={String(i + 1)}
                              disabled={readOnly}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
              </div>
            </fieldset>

            <SheetFooter className="flex-row justify-end gap-2 p-0">
              <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
                {t("buttons.close")}
              </Button>
              {canEdit ? (
                <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
                  {mutation.isPending ? <Spinner /> : <SaveIcon />}
                  {t("buttons.save")}
                </Button>
              ) : null}
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
    <ConflictDialog
      open={conflict}
      onOpenChange={setConflict}
      isReloading={reloading}
      onReload={async () => {
        setReloading(true);
        try {
          // The list answers the row's new etag; the sheet is keyed by it and opens again with the latest values.
          await queryClient.refetchQueries({ queryKey: [API_ENDPOINTS.LOCALES.LIST] });
        } finally {
          setReloading(false);
        }
      }}
    />
    </>
  );
}
