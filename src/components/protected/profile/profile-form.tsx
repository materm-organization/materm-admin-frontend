"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Cookies from "js-cookie";
import { SaveIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ConflictDialog } from "@/components/global/conflict-dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useMutationUpdateProfile } from "@/hooks/use-profile";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { LOCALE_COOKIE_NAME, LOCALES, isSupportedLocale } from "@/lib/constants/locales";
import type { UpdateProfilePayload, UserProfile } from "@/types/user";

// "No preference" cannot be an empty Select item value.
const NO_PREFERENCE = "__none__";

function createSchema(t: (key: string) => string) {
  return z.object({
    name: z
      .string()
      .trim()
      .refine((v) => [...v].length >= 1, t("validation.nameRequired"))
      .refine((v) => [...v].length <= 120, t("validation.nameTooLong")),
    preferred_locale: z.string(),
  });
}
type Values = z.infer<ReturnType<typeof createSchema>>;

// PATCH /auth/profile: only the fields that changed, `If-Match` = the ETag of the loaded profile. A lock
// conflict opens the ConflictDialog (no force overwrite). Saving a different `preferred_locale` also switches
// the admin UI to it: the `locale` cookie is set and the server components re-render (`router.refresh()`).
// The parent keys this form by the ETag, so a saved / reloaded profile remounts it with fresh defaults.
export function ProfileForm({
  profile,
  etag,
  onReload,
}: {
  profile: UserProfile;
  etag: string | undefined;
  onReload: () => Promise<unknown>;
}) {
  const t = useTranslations("profile.form");
  const router = useRouter();
  const currentLocale = useLocale();
  const { handleFormError } = useApiErrorHandler();
  const mutation = useMutationUpdateProfile();
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(createSchema(t)),
    defaultValues: { name: profile.name, preferred_locale: profile.preferred_locale ?? NO_PREFERENCE },
  });

  const buildPayload = (values: Values): UpdateProfilePayload => {
    const payload: UpdateProfilePayload = {};
    if (values.name !== profile.name) payload.name = values.name;
    const next = values.preferred_locale === NO_PREFERENCE ? null : values.preferred_locale;
    if (next !== profile.preferred_locale) payload.preferred_locale = next;
    return payload;
  };

  const doSave = async (values: Values): Promise<boolean> => {
    const payload = buildPayload(values);
    if (Object.keys(payload).length === 0) return true;
    try {
      await mutation.mutateAsync({ payload, etag });
      toast.success(t("toast.success"));
      const locale = payload.preferred_locale;
      if (locale && isSupportedLocale(locale) && locale !== currentLocale) {
        Cookies.set(LOCALE_COOKIE_NAME, locale, { path: "/" });
        router.refresh();
      }
      return true;
    } catch (error) {
      handleFormError(form, error, { fallback: t("toast.error"), onConflict: () => setConflictOpen(true) });
      return false;
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    await doSave(values);
  });

  useUnsavedChangesGuard(form.formState.isDirty, {
    onSave: async () => {
      let ok = false;
      await form.handleSubmit(async (values) => {
        ok = await doSave(values);
      })();
      return ok;
    },
  });

  const reload = async () => {
    setIsReloading(true);
    try {
      await onReload();
    } finally {
      setIsReloading(false);
    }
  };

  const values = useWatch({ control: form.control }) as Values;
  const payloadNow = buildPayload(values);
  const localeLabel = (code: string) =>
    code === NO_PREFERENCE ? t("fields.noPreference") : (LOCALES.find((l) => l.code === code)?.name ?? code);
  const myChanges = [
    ...(payloadNow.name !== undefined ? [{ label: t("fields.name"), value: values.name }] : []),
    ...(payloadNow.preferred_locale !== undefined
      ? [{ label: t("fields.preferredLocale"), value: localeLabel(values.preferred_locale) }]
      : []),
  ];

  const busy = mutation.isPending;
  return (
    <>
      <Form {...form}>
        <form onSubmit={(e) => void onSubmit(e)} className="max-w-md space-y-4" noValidate>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("fields.name")} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input autoComplete="name" disabled={busy} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="preferred_locale"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.preferredLocale")}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={busy}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NO_PREFERENCE}>{t("fields.noPreference")}</SelectItem>
                    {LOCALES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>{t("fields.preferredLocaleHint")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !form.formState.isDirty}>
              {busy ? <Spinner /> : <SaveIcon />}
              {t("save")}
            </Button>
            <Button type="button" variant="outline" disabled={busy || !form.formState.isDirty} onClick={() => form.reset()}>
              {t("discard")}
            </Button>
          </div>
        </form>
      </Form>
      <ConflictDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        onReload={reload}
        isReloading={isReloading}
        myChanges={myChanges}
      />
    </>
  );
}
