"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { SaveIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ConflictDialog } from "@/components/global/conflict-dialog";
import { useAssignableRoles } from "@/components/protected/users/use-assignable-roles";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { useLocales } from "@/hooks/use-locales";
import { useCan } from "@/hooks/use-permission";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { useMutationUpdateUser } from "@/hooks/use-users";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import type { UpdateUserPayload, User } from "@/types/iam";

function editUserSchema(t: (key: string) => string) {
  return z.object({
    name: z.string().trim().min(1, t("validation.nameRequired")).max(120, t("validation.nameTooLong")),
    // "" = no e-mail (allowed unless the account is still `invited`, checked on submit).
    email: z.union([
      z.literal(""),
      z.string().trim().email(t("validation.emailInvalid")).max(254, t("validation.emailTooLong")),
    ]),
    role_id: z.string().min(1, t("validation.roleRequired")),
    allowed_locales: z.array(z.string()),
  });
}
type EditUserValues = z.infer<ReturnType<typeof editUserSchema>>;

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

// SCR-08 "Profile" card: name, e-mail, role, allowed languages (PATCH /users/{id}). The ETag of the loaded user
// is sent as `If-Match`; a lock conflict opens the ConflictDialog (no force overwrite). The parent keys this form
// by the user's ETag, so a saved / reloaded user remounts it with fresh default values.
// `username` is immutable. The role cannot be changed on your own account (BR-21) nor on a super admin by
// someone who is not one.
export function UserEditForm({
  user,
  etag,
  onReload,
}: {
  user: User;
  etag: string | undefined;
  onReload: () => Promise<unknown>;
}) {
  const t = useTranslations("users.detail");
  const tEdit = useTranslations("users.edit");
  const { handleFormError } = useApiErrorHandler();
  const mutation = useMutationUpdateUser(user.id);
  const roles = useAssignableRoles();
  // The language list needs `cms.locales:read` (the seeded admin role has none): without it nothing is requested
  // (a 403 would be written to the audit log) and the codes are shown as plain text.
  const canReadLocales = useCan(PERMISSION_KEYS.CMS_LOCALES, PERMISSION_ACTIONS.READ);
  const locales = useLocales(canReadLocales);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  const isSelf = roles.meId === user.id;
  const targetIsSuper = roles.roles.find((r) => r.id === user.role_id)?.is_super === true;
  const protectedTarget = targetIsSuper && !roles.meIsSuper;

  const form = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema(tEdit)),
    defaultValues: {
      name: user.name,
      email: user.email ?? "",
      role_id: String(user.role_id),
      allowed_locales: user.allowed_locales,
    },
  });

  const buildPayload = (values: EditUserValues): UpdateUserPayload => {
    const payload: UpdateUserPayload = {};
    if (values.name !== user.name) payload.name = values.name;
    if (values.email !== (user.email ?? "")) payload.email = values.email === "" ? null : values.email;
    if (Number(values.role_id) !== user.role_id) payload.role_id = Number(values.role_id);
    if (!sameSet(values.allowed_locales, user.allowed_locales)) payload.allowed_locales = values.allowed_locales;
    return payload;
  };

  const doSave = async (values: EditUserValues): Promise<boolean> => {
    if (user.state === "invited" && values.email === "") {
      form.setError("email", { type: "validate", message: tEdit("validation.emailRequiredInvited") });
      return false;
    }
    const payload = buildPayload(values);
    if (Object.keys(payload).length === 0) return true;
    try {
      await mutation.mutateAsync({ payload, etag });
      toast.success(tEdit("toast.success"));
      return true;
    } catch (error) {
      handleFormError(form, error, { fallback: tEdit("toast.error"), onConflict: () => setConflictOpen(true) });
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

  const values = useWatch({ control: form.control }) as EditUserValues;
  const payloadNow = buildPayload(values);
  const myChanges = [
    ...(payloadNow.name !== undefined ? [{ label: t("fields.name"), value: values.name }] : []),
    ...(payloadNow.email !== undefined ? [{ label: t("fields.email"), value: values.email || "—" }] : []),
    ...(payloadNow.role_id !== undefined
      ? [{ label: t("fields.role"), value: roles.roles.find((r) => String(r.id) === values.role_id)?.name ?? values.role_id }]
      : []),
    ...(payloadNow.allowed_locales !== undefined
      ? [{ label: t("fields.allowedLocales"), value: values.allowed_locales.join(", ") || t("fields.allLocales") }]
      : []),
  ];

  const roleLocked = isSelf || protectedTarget;
  const formLocked = protectedTarget;
  const busy = mutation.isPending;

  // The target's current role may be missing from the assignable list (a super role for a non-super editor).
  const roleChoices = roles.assignable.some((r) => r.id === user.role_id)
    ? roles.assignable
    : [...roles.roles.filter((r) => r.id === user.role_id), ...roles.assignable];

  return (
    <>
      <Form {...form}>
        <form onSubmit={(e) => void onSubmit(e)} className="max-w-xl space-y-4" noValidate>
          {protectedTarget ? (
            <p role="note" className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              {t("superProtected")}
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="user-username">{t("fields.username")}</Label>
            <Input id="user-username" value={user.username} readOnly disabled className="font-mono" />
            <p className="text-xs text-muted-foreground">{t("fields.usernameHint")}</p>
          </div>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t("fields.name")} <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input autoComplete="off" disabled={busy || formLocked} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.email")}</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="off" disabled={busy || formLocked} {...field} />
                </FormControl>
                {user.state === "invited" ? <FormDescription>{t("fields.emailInvitedHint")}</FormDescription> : null}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="role_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.role")}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={busy || formLocked || roleLocked}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {roleChoices.map((role) => (
                      <SelectItem key={role.id} value={String(role.id)}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isSelf ? <FormDescription>{t("fields.roleSelfHint")}</FormDescription> : null}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="allowed_locales"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.allowedLocales")}</FormLabel>
                {!canReadLocales || locales.isError ? (
                  <p className="text-sm">{field.value.length ? field.value.join(", ") : t("fields.allLocales")}</p>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-2" role="group" aria-label={t("fields.allowedLocales")}>
                    {(locales.data?.data ?? []).map((locale) => (
                      <Label key={locale.code} className="flex items-center gap-2 font-normal">
                        <Checkbox
                          checked={field.value.includes(locale.code)}
                          disabled={busy || formLocked}
                          onCheckedChange={(checked) =>
                            field.onChange(
                              checked ? [...field.value, locale.code] : field.value.filter((c) => c !== locale.code)
                            )
                          }
                        />
                        {locale.name} <span className="font-mono text-xs text-muted-foreground">{locale.code}</span>
                      </Label>
                    ))}
                  </div>
                )}
                <FormDescription>{t("fields.allowedLocalesHint")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || formLocked || !form.formState.isDirty}>
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
